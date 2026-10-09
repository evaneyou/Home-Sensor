from __future__ import annotations

from sqlalchemy.orm import Session, joinedload

from app.internet_tests import (
    classify_iperf,
    classify_web_service,
    load_internet_service,
    load_web_services,
    path_variance,
    service_variance,
)
from app.models import ResultStatus, Monitor, Test, TestResult
from app.schemas import IngestResult


def ingest_results(
    db: Session, monitor: Monitor, results: list[IngestResult]
) -> tuple[int, int, list[str]]:
    accepted = 0
    duplicates = 0
    ids: list[str] = []

    tests = (
        db.query(Test)
        .options(joinedload(Test.network))
        .filter(Test.monitor_id == monitor.id)
        .all()
    )
    test_map: dict[tuple[str, str], Test] = {(t.network.slug, t.slug): t for t in tests}
    settings = {row.key: row for row in load_web_services(db)}
    internet = load_internet_service(db)

    for item in results:
        existing = db.query(TestResult).filter(TestResult.external_id == item.id).first()
        if existing:
            duplicates += 1
            ids.append(item.id)
            continue

        test = test_map.get((item.network_slug, item.test_slug))
        if test is None:
            continue

        try:
            status = ResultStatus(item.status)
        except ValueError:
            continue

        stages = [s.model_dump() for s in item.stages]
        variance = service_variance(settings, test.slug)
        if variance is None:
            variance = path_variance(internet, test.slug)
        if variance is not None and test.slug == "iperf3":
            status, reason = classify_iperf(db, test, item.metrics, variance[0])
        elif variance is not None:
            status, reason = classify_web_service(
                db, test, item.metrics, item.message, variance[0], variance[1]
            )
        else:
            reason = None

        row = TestResult(
            external_id=item.id,
            test_id=test.id,
            started_at=item.started_at,
            finished_at=item.finished_at,
            status=status,
            stages=stages,
            metrics=item.metrics,
            message=item.message,
            status_reason=reason,
        )
        db.add(row)
        accepted += 1
        ids.append(item.id)

    db.flush()
    return accepted, duplicates, ids
