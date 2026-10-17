"""KPI reporting: exact availability and loss from known data, per period, and kept after raw rollups."""

import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import delete, select

from app import kpi
from app.main import app
from app.models import (
    KpiHourly,
    Monitor,
    Network,
    NetworkKind,
    ResultStatus,
    SyntheticRun,
    SyntheticSample,
    Test,
    TestKind,
    TestResult,
)
from tests.conftest import login
from tests.test_guest_login import _ensure_guest
from tests.test_ingest import _make_monitor

NOW = datetime(2026, 10, 16, 12, 30, tzinfo=timezone.utc)
HOUR = NOW.replace(minute=0)


def _pi(db) -> Monitor:
    monitor, _token = _make_monitor(db, f"KPI Pi {uuid.uuid4().hex[:6]}")
    return monitor


def _link(db, monitor: Monitor, kind: NetworkKind) -> Test:
    network = db.scalar(select(Network).where(Network.group_id == db.info["group_id"], Network.kind == kind))
    if network is None:
        network = Network(group_id=db.info["group_id"], slug=f"{kind.value}-{uuid.uuid4().hex[:4]}", name=kind.value, kind=kind)
        db.add(network)
        db.flush()
    test = Test(monitor_id=monitor.id, network_id=network.id, slug="icmp-path", name="ICMP", kind=TestKind.ping, target="x")
    db.add(test)
    db.flush()
    return test


def _ping(db, test: Test, minute: int, status: ResultStatus, loss: float = 0.0, rtt: float = 20.0, when: datetime = HOUR) -> None:
    db.add(
        TestResult(
            external_id=f"kpi-{uuid.uuid4().hex}",
            test_id=test.id,
            started_at=when + timedelta(minutes=minute),
            finished_at=when + timedelta(minutes=minute, seconds=5),
            status=status,
            metrics={"rtt_ms": rtt, "loss_pct": loss, "jitter_ms": 2.0},
        )
    )


def _run(db, monitor: Monitor, slug: str, links=("wired",)) -> SyntheticRun:
    run = SyntheticRun(monitor_id=monitor.id, profile_slug=slug, mode="continuous", links=list(links), options={}, status="running", finished_links=[])
    db.add(run)
    db.flush()
    return run


def _sample(db, run: SyntheticRun, minute: int, verdict: str, loss: float, link="wired", when: datetime = HOUR) -> None:
    db.add(
        SyntheticSample(
            run_id=run.id,
            link=link,
            sample_key=f"{minute}:{uuid.uuid4().hex[:6]}",
            recorded_at=when + timedelta(minutes=minute),
            rtt_ms=30.0,
            jitter_ms=3.0,
            loss_pct=loss,
            verdict=verdict,
            metrics={},
        )
    )


@pytest.fixture(autouse=True)
def _clean(db):
    db.execute(delete(KpiHourly))
    db.commit()
    yield
    db.rollback()
    db.execute(delete(KpiHourly))
    db.commit()


def test_internet_availability_outage_minutes_and_incidents(db):
    monitor = _pi(db)
    wired = _link(db, monitor, NetworkKind.wired)
    # 20 pings in the hour: 2 consecutive failures, then 1 later failure. Two incidents.
    plan = ["ok"] * 5 + ["fail", "fail"] + ["ok"] * 8 + ["fail"] + ["ok"] * 4
    for minute, state in enumerate(plan):
        _ping(db, wired, minute, ResultStatus.fail if state == "fail" else ResultStatus.ok, loss=100.0 if state == "fail" else 0.0)
    db.commit()
    assert kpi.rebuild(db, HOUR, HOUR + timedelta(hours=1)) >= 1
    db.commit()

    row = db.scalar(select(KpiHourly).where(KpiHourly.monitor_id == monitor.id, KpiHourly.kind == "internet"))
    assert (row.n, row.failed, row.incidents, row.link) == (20, 3, 2, "wired")

    result = kpi.report(db, "day", now=NOW, monitor_id=monitor.id)
    internet = result["summary"]["internet"]
    assert internet["availability"] == pytest.approx(85.0)
    assert internet["incidents"] == 2
    assert internet["outage_minutes"] == pytest.approx(9.0)  # 3 of 20 checks failed in a 60 minute hour
    assert internet["mttr_minutes"] == pytest.approx(4.5)
    assert result["links"]["internet"]["wired"]["availability"] == pytest.approx(85.0)
    assert "wireless" not in result["links"]["internet"]


def test_voice_and_video_availability_and_packet_loss(db):
    monitor = _pi(db)
    voice = _run(db, monitor, "voip-g711a", ("wired", "wireless"))
    video = _run(db, monitor, "video-conference")
    for minute in range(10):
        _sample(db, voice, minute, "fail" if minute == 0 else "pass", loss=1.0 if minute == 0 else 0.0)
        _sample(db, video, minute, "pass", loss=0.2)
    _sample(db, voice, 11, "pass", loss=0.0, link="wireless")
    db.commit()
    kpi.rebuild(db, HOUR, HOUR + timedelta(hours=1))
    db.commit()

    result = kpi.report(db, "day", now=NOW, monitor_id=monitor.id)
    assert result["summary"]["voice"]["availability"] == pytest.approx(100.0 * (1 - 1 / 11))
    assert result["summary"]["voice"]["loss_avg"] == pytest.approx(1.0 / 11)
    assert result["summary"]["voice"]["loss_max"] == 1.0
    assert result["summary"]["video"]["availability"] == pytest.approx(100.0)
    assert result["summary"]["video"]["loss_avg"] == pytest.approx(0.2)
    assert result["links"]["voice"]["wireless"]["availability"] == pytest.approx(100.0)
    assert result["app_loss_avg"] is not None and 0 < result["app_loss_avg"] < 1


def test_manual_and_stress_runs_are_not_counted(db):
    monitor = _pi(db)
    run = _run(db, monitor, "stress-voice")
    run.mode = "stress"
    manual = _run(db, monitor, "voip-g711a")
    manual.mode = "manual"
    for target in (run, manual):
        _sample(db, target, 1, "fail", loss=50.0)
    db.commit()
    kpi.rebuild(db, HOUR, HOUR + timedelta(hours=1))
    db.commit()
    assert db.scalar(select(KpiHourly).where(KpiHourly.monitor_id == monitor.id)) is None


def test_rebuild_is_repeatable_and_backfill_fills_older_hours(db):
    monitor = _pi(db)
    wired = _link(db, monitor, NetworkKind.wired)
    for day in range(3):
        for minute in range(5):
            _ping(db, wired, minute, ResultStatus.ok, when=HOUR - timedelta(days=day))
    db.commit()
    kpi.rebuild(db, HOUR, HOUR + timedelta(hours=1))
    kpi.rebuild(db, HOUR, HOUR + timedelta(hours=1))
    db.commit()
    assert len(db.scalars(select(KpiHourly).where(KpiHourly.monitor_id == monitor.id)).all()) == 1

    kpi.backfill(db, now=NOW)
    db.commit()
    mine = db.scalars(select(KpiHourly).where(KpiHourly.monitor_id == monitor.id, KpiHourly.kind == "internet")).all()
    assert len(mine) == 3 and all(row.n == 5 for row in mine)
    assert kpi.backfill(db, now=NOW) == 0, "nothing left to fill"


def test_the_figures_survive_the_raw_rows_being_averaged(db):
    monitor = _pi(db)
    wired = _link(db, monitor, NetworkKind.wired)
    for minute in range(10):
        _ping(db, wired, minute, ResultStatus.fail if minute < 2 else ResultStatus.ok)
    db.commit()
    kpi.rebuild(db, HOUR, HOUR + timedelta(hours=1))
    db.commit()
    before = kpi.report(db, "day", now=NOW, monitor_id=monitor.id)["summary"]["internet"]["availability"]
    # What the six month rollup does: many results become one averaged row.
    db.execute(delete(TestResult).where(TestResult.test_id == wired.id))
    db.add(
        TestResult(
            external_id=f"rollup-{uuid.uuid4().hex}",
            test_id=wired.id,
            started_at=HOUR,
            finished_at=HOUR,
            status=ResultStatus.ok,
            metrics={"rtt_ms": 20},
            message="Hourly average",
        )
    )
    db.commit()
    assert kpi.report(db, "day", now=NOW, monitor_id=monitor.id)["summary"]["internet"]["availability"] == pytest.approx(before) == pytest.approx(80.0)


def test_periods_have_the_right_buckets_and_a_previous_period(db):
    monitor = _pi(db)
    wired = _link(db, monitor, NetworkKind.wired)
    for days_ago, fails in ((0, 0), (1, 1), (8, 2)):
        when = HOUR - timedelta(days=days_ago)
        for minute in range(10):
            _ping(db, wired, minute, ResultStatus.fail if minute < fails else ResultStatus.ok, when=when)
    db.commit()
    kpi.backfill(db, now=NOW)
    db.commit()
    shapes = {name: kpi.report(db, name, now=NOW, monitor_id=monitor.id) for name in ("day", "week", "month", "year")}
    assert [len(shapes[name]["series"]) for name in ("day", "week", "month", "year")] == [24, 7, 30, 12]
    assert [shapes[name]["bucket"] for name in ("day", "week", "month", "year")] == ["hour", "day", "day", "month"]
    week = shapes["week"]
    assert week["summary"]["internet"]["samples"] == 20
    assert week["summary"]["internet"]["availability"] == pytest.approx(95.0)
    assert week["previous"]["internet"]["samples"] == 10 and week["previous"]["internet"]["availability"] == pytest.approx(80.0)
    assert week["series"][-1]["internet"] == pytest.approx(100.0) and week["series"][-2]["internet"] == pytest.approx(90.0)
    assert week["series"][0]["internet"] is None, "a day with no data is a gap, not 100%"
    assert shapes["year"]["series"][-1]["t"].month == NOW.month
    with pytest.raises(ValueError):
        kpi.report(db, "decade", now=NOW)


def test_incidents_group_consecutive_failures(db):
    monitor = _pi(db)
    wired = _link(db, monitor, NetworkKind.wired)
    for minute in (3, 4, 5, 20):
        _ping(db, wired, minute, ResultStatus.fail)
    db.commit()
    found = kpi.incidents(db, HOUR, HOUR + timedelta(hours=1), monitor.id)
    assert [(item["minutes"], item["checks"]) for item in found] == [(1, 1), (3, 3)]
    assert found[0]["start"] > found[1]["start"], "newest first"


def test_the_report_endpoint_is_for_signed_in_users_and_validates_the_period(client: TestClient, db):
    _ensure_guest(db)
    assert client.get("/api/v1/kpi").status_code in (401, 403)
    guest = TestClient(app, base_url="https://testserver")
    login(guest, "guest", "guest")
    body = guest.get("/api/v1/kpi?period=week")
    assert body.status_code == 200, body.text
    assert set(body.json()) >= {"summary", "series", "previous", "targets", "incidents", "links", "app_loss_avg"}
    assert guest.get("/api/v1/kpi?period=century").status_code == 422
    admin = login(client)
    assert admin and client.get("/api/v1/kpi?period=year").status_code == 200
