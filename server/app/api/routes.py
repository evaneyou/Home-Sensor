from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import Select, and_, desc, func, select
from sqlalchemy.orm import Session, joinedload

from app.auth import (
    clear_session_cookie,
    create_session_token,
    get_current_user,
    set_session_cookie,
    verify_password,
)
from app.config import Settings, get_settings
from app.db import get_db
from app.models import (
    Issue,
    IssueStatus,
    Network,
    ResultStatus,
    Sensor,
    Test,
    TestResult,
    User,
)
from app.schemas import (
    HealthCell,
    IngestRequest,
    IngestResponse,
    IssueOut,
    IssueSummary,
    LoginRequest,
    MetricsPoint,
    MetricsResponse,
    ResultOut,
    SummaryResponse,
    UserOut,
)
from app.services.ingest import ingest_results

router = APIRouter(prefix="/api/v1")


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


@router.post("/auth/login", response_model=UserOut)
def login(
    body: LoginRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> User:
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_session_token(user.id, settings)
    set_session_cookie(response, token, settings)
    return user


@router.post("/auth/logout")
def logout(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    clear_session_cookie(response, settings)
    return {"status": "ok"}


@router.get("/auth/me", response_model=UserOut)
def me(user: Annotated[User, Depends(get_current_user)]) -> User:
    return user


def _resolve_sensor_from_bearer(
    db: Session, authorization: Optional[str]
) -> Sensor:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    token = authorization.split(" ", 1)[1].strip()
    # Seed tokens are stored as plain "sensor-<slug>" hashed via passlib — look up by verifying.
    from app.auth import verify_password

    sensors = db.scalars(select(Sensor)).all()
    for sensor in sensors:
        if verify_password(token, sensor.token_hash):
            return sensor
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid sensor token")


@router.post("/ingest", response_model=IngestResponse)
def ingest(
    body: IngestRequest,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
) -> IngestResponse:
    sensor = _resolve_sensor_from_bearer(db, authorization)
    accepted, duplicates, ids = ingest_results(db, sensor, body.results)
    sensor.last_seen_at = datetime.now(timezone.utc)
    from app.models import SensorStatus

    sensor.status = SensorStatus.online
    db.commit()
    return IngestResponse(accepted=accepted, duplicates=duplicates, ids=ids)


def _result_to_out(r: TestResult) -> ResultOut:
    test = r.test
    return ResultOut(
        id=r.id,
        external_id=r.external_id,
        test_id=r.test_id,
        test_slug=test.slug,
        test_name=test.name,
        test_kind=test.kind.value,
        sensor_id=test.sensor_id,
        sensor_slug=test.sensor.slug,
        network_id=test.network_id,
        network_slug=test.network.slug,
        started_at=r.started_at,
        finished_at=r.finished_at,
        status=r.status.value,
        stages=r.stages or [],
        metrics=r.metrics or {},
        message=r.message,
    )


@router.get("/summary", response_model=SummaryResponse)
def summary(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> SummaryResponse:
    sensors = db.scalars(select(Sensor).order_by(Sensor.name)).all()
    networks = db.scalars(select(Network).order_by(Network.name)).all()
    tests = db.scalars(
        select(Test).options(joinedload(Test.sensor), joinedload(Test.network))
    ).all()

    # Latest result per test
    latest_subq = (
        select(TestResult.test_id, func.max(TestResult.started_at).label("max_started"))
        .group_by(TestResult.test_id)
        .subquery()
    )
    latest_results = db.scalars(
        select(TestResult)
        .join(
            latest_subq,
            and_(
                TestResult.test_id == latest_subq.c.test_id,
                TestResult.started_at == latest_subq.c.max_started,
            ),
        )
    ).all()
    latest_by_test = {r.test_id: r for r in latest_results}

    # Build matrix cells keyed by sensor×network
    cell_map: dict[tuple[UUID, UUID], HealthCell] = {}
    for sensor in sensors:
        for network in networks:
            cell_map[(sensor.id, network.id)] = HealthCell(
                sensor_id=sensor.id,
                sensor_slug=sensor.slug,
                sensor_name=sensor.name,
                network_id=network.id,
                network_slug=network.slug,
                network_name=network.name,
                status="unknown",
                last_test_at=None,
                failing_tests=0,
            )

    rank = {"ok": 0, "degraded": 1, "fail": 2, "unknown": -1}
    for test in tests:
        key = (test.sensor_id, test.network_id)
        cell = cell_map.get(key)
        if cell is None:
            continue
        result = latest_by_test.get(test.id)
        if result is None:
            continue
        status_val = result.status.value
        if rank[status_val] > rank[cell.status]:
            cell.status = status_val
        if cell.last_test_at is None or result.started_at > cell.last_test_at:
            cell.last_test_at = result.started_at
        if status_val in ("fail", "degraded"):
            cell.failing_tests += 1

    open_issues = db.scalars(
        select(Issue)
        .where(Issue.status == IssueStatus.open)
        .order_by(desc(Issue.opened_at))
        .limit(20)
    ).all()
    sensor_by_id = {s.id: s for s in sensors}
    network_by_id = {n.id: n for n in networks}
    issue_summaries = [
        IssueSummary(
            id=i.id,
            title=i.title,
            severity=i.severity.value,
            status=i.status.value,
            opened_at=i.opened_at,
            root_cause_stage=i.root_cause_stage,
            sensor_slug=sensor_by_id[i.sensor_id].slug if i.sensor_id and i.sensor_id in sensor_by_id else None,
            network_slug=network_by_id[i.network_id].slug
            if i.network_id and i.network_id in network_by_id
            else None,
        )
        for i in open_issues
    ]

    return SummaryResponse(
        generated_at=datetime.now(timezone.utc),
        matrix=list(cell_map.values()),
        open_issues=issue_summaries,
        sensors=[{"id": str(s.id), "slug": s.slug, "name": s.name, "status": s.status.value} for s in sensors],
        networks=[
            {"id": str(n.id), "slug": n.slug, "name": n.name, "kind": n.kind.value} for n in networks
        ],
    )


@router.get("/results", response_model=list[ResultOut])
def results(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    sensor_id: Optional[UUID] = None,
    network_id: Optional[UUID] = None,
    test_id: Optional[UUID] = None,
    status_filter: Optional[str] = Query(None, alias="status"),
    since: Optional[datetime] = None,
    until: Optional[datetime] = None,
    limit: int = Query(100, ge=1, le=500),
) -> list[ResultOut]:
    stmt: Select[tuple[TestResult]] = (
        select(TestResult)
        .join(Test)
        .options(
            joinedload(TestResult.test).joinedload(Test.sensor),
            joinedload(TestResult.test).joinedload(Test.network),
        )
        .order_by(desc(TestResult.started_at))
        .limit(limit)
    )
    if sensor_id:
        stmt = stmt.where(Test.sensor_id == sensor_id)
    if network_id:
        stmt = stmt.where(Test.network_id == network_id)
    if test_id:
        stmt = stmt.where(TestResult.test_id == test_id)
    if status_filter:
        try:
            stmt = stmt.where(TestResult.status == ResultStatus(status_filter))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid status") from exc
    if since:
        stmt = stmt.where(TestResult.started_at >= since)
    if until:
        stmt = stmt.where(TestResult.started_at <= until)

    rows = db.scalars(stmt).unique().all()
    return [_result_to_out(r) for r in rows]


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    test_id: UUID = Query(...),
    range: str = Query("24h", pattern="^(1h|6h|24h|7d|30d)$"),
) -> MetricsResponse:
    delta = {
        "1h": timedelta(hours=1),
        "6h": timedelta(hours=6),
        "24h": timedelta(hours=24),
        "7d": timedelta(days=7),
        "30d": timedelta(days=30),
    }[range]
    since = datetime.now(timezone.utc) - delta
    test = db.get(Test, test_id)
    if test is None:
        raise HTTPException(status_code=404, detail="Test not found")

    rows = db.scalars(
        select(TestResult)
        .where(TestResult.test_id == test_id, TestResult.started_at >= since)
        .order_by(TestResult.started_at)
    ).all()

    points = [
        MetricsPoint(
            t=r.started_at,
            status=r.status.value,
            rtt_ms=(r.metrics or {}).get("rtt_ms"),
            loss_pct=(r.metrics or {}).get("loss_pct"),
            stages=r.stages or [],
        )
        for r in rows
    ]
    return MetricsResponse(test_id=test.id, test_slug=test.slug, points=points)


@router.get("/issues", response_model=list[IssueOut])
def list_issues(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    status_filter: Optional[str] = Query(None, alias="status"),
) -> list[IssueOut]:
    stmt = select(Issue).order_by(desc(Issue.opened_at))
    if status_filter:
        try:
            stmt = stmt.where(Issue.status == IssueStatus(status_filter))
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="Invalid status") from exc
    issues = db.scalars(stmt).all()
    return [_issue_to_out(db, i, include_failures=False) for i in issues]


@router.get("/issues/{issue_id}", response_model=IssueOut)
def get_issue(
    issue_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> IssueOut:
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(status_code=404, detail="Issue not found")
    return _issue_to_out(db, issue, include_failures=True)


@router.get("/sensors/{sensor_id}")
def get_sensor(
    sensor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> dict:
    sensor = db.get(Sensor, sensor_id)
    if sensor is None:
        raise HTTPException(status_code=404, detail="Sensor not found")
    tests = db.scalars(
        select(Test)
        .where(Test.sensor_id == sensor_id)
        .options(joinedload(Test.network))
    ).unique().all()

    latest_subq = (
        select(TestResult.test_id, func.max(TestResult.started_at).label("max_started"))
        .group_by(TestResult.test_id)
        .subquery()
    )
    latest = {
        r.test_id: r
        for r in db.scalars(
            select(TestResult).join(
                latest_subq,
                and_(
                    TestResult.test_id == latest_subq.c.test_id,
                    TestResult.started_at == latest_subq.c.max_started,
                ),
            )
        ).all()
        if r.test_id in {t.id for t in tests}
    }

    return {
        "id": str(sensor.id),
        "slug": sensor.slug,
        "name": sensor.name,
        "status": sensor.status.value,
        "last_seen_at": sensor.last_seen_at.isoformat() if sensor.last_seen_at else None,
        "tests": [
            {
                "id": str(t.id),
                "slug": t.slug,
                "name": t.name,
                "kind": t.kind.value,
                "target": t.target,
                "network_id": str(t.network_id),
                "network_slug": t.network.slug,
                "network_name": t.network.name,
                "latest_status": latest[t.id].status.value if t.id in latest else "unknown",
                "latest_at": latest[t.id].started_at.isoformat() if t.id in latest else None,
            }
            for t in tests
        ],
    }


@router.get("/tests/{test_id}")
def get_test(
    test_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> dict:
    test = db.scalar(
        select(Test)
        .where(Test.id == test_id)
        .options(joinedload(Test.sensor), joinedload(Test.network))
    )
    if test is None:
        raise HTTPException(status_code=404, detail="Test not found")
    return {
        "id": str(test.id),
        "slug": test.slug,
        "name": test.name,
        "kind": test.kind.value,
        "target": test.target,
        "interval_seconds": test.interval_seconds,
        "sensor_id": str(test.sensor_id),
        "sensor_slug": test.sensor.slug,
        "sensor_name": test.sensor.name,
        "network_id": str(test.network_id),
        "network_slug": test.network.slug,
        "network_name": test.network.name,
    }


def _issue_to_out(db: Session, issue: Issue, include_failures: bool) -> IssueOut:
    sensor = db.get(Sensor, issue.sensor_id) if issue.sensor_id else None
    network = db.get(Network, issue.network_id) if issue.network_id else None
    test = db.get(Test, issue.test_id) if issue.test_id else None
    failures: list[ResultOut] = []
    if include_failures and issue.test_id:
        rows = db.scalars(
            select(TestResult)
            .where(
                TestResult.test_id == issue.test_id,
                TestResult.status.in_([ResultStatus.fail, ResultStatus.degraded]),
            )
            .options(
                joinedload(TestResult.test).joinedload(Test.sensor),
                joinedload(TestResult.test).joinedload(Test.network),
            )
            .order_by(desc(TestResult.started_at))
            .limit(10)
        ).unique().all()
        failures = [_result_to_out(r) for r in rows]

    return IssueOut(
        id=issue.id,
        title=issue.title,
        summary=issue.summary,
        severity=issue.severity.value,
        status=issue.status.value,
        root_cause_stage=issue.root_cause_stage,
        opened_at=issue.opened_at,
        resolved_at=issue.resolved_at,
        sensor_id=issue.sensor_id,
        sensor_slug=sensor.slug if sensor else None,
        network_id=issue.network_id,
        network_slug=network.slug if network else None,
        test_id=issue.test_id,
        test_slug=test.slug if test else None,
        recent_failures=failures,
    )
