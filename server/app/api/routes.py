from __future__ import annotations

import re
import urllib.parse
from datetime import datetime, timedelta, timezone
from typing import Annotated, Optional
from uuid import UUID

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Query, Response, status
from sqlalchemy import Select, and_, delete, desc, func, select
from sqlalchemy.orm import Session, joinedload

from app.auth import (
    clear_session_cookie,
    create_session_token,
    csrf_token_for,
    get_current_user,
    require_admin,
    require_admin_csrf,
    set_session_cookie,
    verify_password,
)
from app.config import Settings, get_settings
from app.db import get_db
from app.enrollment import CONNECTED_WITHIN, is_token_hash, token_hash
from app.internet_tests import (
    ensure_internet_tests,
    explain_result,
    is_web_check,
    load_internet_service,
    load_web_services,
    load_web_stability,
    log_slug_filter,
    matrix_column,
    save_internet_service,
    save_web_services,
    save_web_stability,
    scheduled_tests,
    stability_config,
)
from app.path_view import build_trace
from app.services.stability import cell_quorum, preset_name, service_status
from app.regions import REGIONS_BY_COUNTRY
from app.models import (
    AuditEvent,
    Group,
    Issue,
    IssueStatus,
    Monitor,
    MonitorHealth,
    MonitorStatus,
    Network,
    ResultStatus,
    Test,
    TestResult,
    User,
    WifiObservation,
)
from app.schemas import (
    DeviceConfigOut,
    ProbeCommandOut,
    TunnelIssueOut,
    DeviceHealthIn,
    ScheduledTestOut,
    MonitorAdminOut,
    HealthCell,
    HopMetric,
    IngestRequest,
    IngestResponse,
    IssueOut,
    IssueSummary,
    LoginRequest,
    MetricsPoint,
    MetricsResponse,
    MonitorLocationIn,
    InternetServiceSettingIn,
    InternetServiceSettingOut,
    WebServiceSettingOut,
    WebServiceSettingsIn,
    WebStabilityIn,
    WebStabilityOut,
    ResultOut,
    ResultPage,
    SummaryResponse,
    ThroughputMbps,
    UserOut,
    WifiObservationOut,
)
from app.services.ingest import ingest_results
from app.wireguard_tunnel import (
    TunnelNotReady,
    allocate_address,
    client_config,
    endpoint,
    new_keypair,
    new_preshared_key,
    refresh_handshakes,
    remove_preshared_key,
    rewrite_peers,
    server_public_key,
)

router = APIRouter(prefix="/api/v1")


@router.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}


def _web_service_out(row) -> WebServiceSettingOut:
    return WebServiceSettingOut(
        key=row.key,
        label=row.label,
        interval_seconds=row.interval_seconds,
        http_enabled=row.http_enabled,
        icmp_enabled=row.icmp_enabled,
        jitter_enabled=row.jitter_enabled,
        http_variance_pct=row.http_variance_pct,
        icmp_variance_pct=row.icmp_variance_pct,
        jitter_variance_pct=row.jitter_variance_pct,
    )


@router.get("/settings/web-services", response_model=list[WebServiceSettingOut])
def get_web_services(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[WebServiceSettingOut]:
    return [_web_service_out(row) for row in load_web_services(db)]


@router.put("/settings/web-services", response_model=list[WebServiceSettingOut])
def put_web_services(
    body: WebServiceSettingsIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
) -> list[WebServiceSettingOut]:
    try:
        rows = save_web_services(db, [item.model_dump() for item in body.services])
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return [_web_service_out(row) for row in rows]


def _web_stability_out(row) -> WebStabilityOut:
    cfg = stability_config(row)
    return WebStabilityOut(
        poll_interval_seconds=row.poll_interval_seconds,
        window_size=row.window_size,
        degraded_count=row.degraded_count,
        fail_count=row.fail_count,
        recover_count=row.recover_count,
        pct_floor=row.pct_floor,
        abs_floor_http_ms=row.abs_floor_http_ms,
        abs_floor_icmp_ms=row.abs_floor_icmp_ms,
        abs_floor_jitter_ms=row.abs_floor_jitter_ms,
        quorum_degraded_pct=row.quorum_degraded_pct,
        quorum_fail_pct=row.quorum_fail_pct,
        preset=preset_name(cfg),
    )


@router.get("/settings/web-stability", response_model=WebStabilityOut)
def get_web_stability(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> WebStabilityOut:
    return _web_stability_out(load_web_stability(db))


@router.put("/settings/web-stability", response_model=WebStabilityOut)
def put_web_stability(
    body: WebStabilityIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
) -> WebStabilityOut:
    try:
        row = save_web_stability(db, body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return _web_stability_out(row)


def _internet_service_out(row) -> InternetServiceSettingOut:
    return InternetServiceSettingOut(
        interval_seconds=row.interval_seconds,
        http_enabled=row.http_enabled,
        icmp_enabled=row.icmp_enabled,
        mtr_enabled=row.mtr_enabled,
        http_variance_pct=row.http_variance_pct,
        icmp_variance_pct=row.icmp_variance_pct,
        mtr_variance_pct=row.mtr_variance_pct,
        iperf_enabled=row.iperf_enabled,
        iperf_interval_seconds=row.iperf_interval_seconds,
        iperf_variance_pct=row.iperf_variance_pct,
        librespeed_enabled=row.librespeed_enabled,
        librespeed_interval_seconds=row.librespeed_interval_seconds,
        librespeed_variance_pct=row.librespeed_variance_pct,
        webrtc_enabled=row.webrtc_enabled,
        webrtc_interval_seconds=row.webrtc_interval_seconds,
        webrtc_variance_pct=row.webrtc_variance_pct,
    )


@router.get("/settings/internet-service", response_model=InternetServiceSettingOut)
def get_internet_service(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> InternetServiceSettingOut:
    return _internet_service_out(load_internet_service(db))


@router.put("/settings/internet-service", response_model=InternetServiceSettingOut)
def put_internet_service(
    body: InternetServiceSettingIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
) -> InternetServiceSettingOut:
    row = save_internet_service(db, body.model_dump())
    db.commit()
    return _internet_service_out(row)


def _user_out(user: User, session_token: str, settings: Settings) -> UserOut:
    return UserOut(
        id=user.id,
        username=user.username,
        role=user.role.value,
        csrf_token=csrf_token_for(session_token, settings),
    )


@router.post("/auth/login", response_model=UserOut)
def login(
    body: LoginRequest,
    response: Response,
    db: Annotated[Session, Depends(get_db)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> UserOut:
    user = db.scalar(select(User).where(User.username == body.username))
    if user is None or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    token = create_session_token(user.id, settings)
    set_session_cookie(response, token, settings)
    return _user_out(user, token, settings)


@router.post("/auth/logout")
def logout(
    response: Response,
    settings: Annotated[Settings, Depends(get_settings)],
) -> dict[str, str]:
    clear_session_cookie(response, settings)
    return {"status": "ok"}


@router.get("/auth/me", response_model=UserOut)
def me(
    user: Annotated[User, Depends(get_current_user)],
    settings: Annotated[Settings, Depends(get_settings)],
    hns_session: Annotated[Optional[str], Cookie(alias="hns_session")] = None,
) -> UserOut:
    return _user_out(user, hns_session or "", settings)


def _resolve_monitor_identity(
    db: Session,
    authorization: Optional[str],
    device_name: Optional[str],
) -> Monitor:
    """The device name and key must both match. The name comparison is case-sensitive."""
    presented = urllib.parse.unquote(device_name or "").strip()
    key = ""
    if authorization and authorization.lower().startswith("bearer "):
        key = authorization.split(" ", 1)[1].strip()
    mismatch = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Device name and key do not match",
    )
    if not key:
        raise mismatch
    issued = db.scalar(select(Monitor).where(Monitor.token_hash == token_hash(key)))
    if issued is not None:
        if presented and issued.name != presented:
            raise mismatch
        return issued
    legacy = select(Monitor).where(Monitor.token_hash.is_not(None))
    if presented:
        legacy = legacy.where(Monitor.name == presented)
    for monitor in db.scalars(legacy).all():
        if is_token_hash(monitor.token_hash):
            continue
        try:
            if verify_password(key, monitor.token_hash):
                return monitor
        except ValueError:
            continue
    raise mismatch


@router.post("/ingest", response_model=IngestResponse)
def ingest(
    body: IngestRequest,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_monitor_name: Annotated[Optional[str], Header()] = None,
) -> IngestResponse:
    monitor = _resolve_monitor_identity(db, authorization, x_monitor_name)
    accepted, duplicates, ids = ingest_results(db, monitor, body.results)
    monitor.last_seen_at = datetime.now(timezone.utc)
    monitor.status = MonitorStatus.online
    db.commit()
    return IngestResponse(accepted=accepted, duplicates=duplicates, ids=ids)


def _slugify(name: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:64]
    if not slug:
        raise HTTPException(status_code=400, detail="Name needs a letter or number")
    return slug


def _unique_slug(db: Session, group_id: UUID, name: str) -> str:
    base = _slugify(name)
    slug = base
    number = 2
    while db.scalar(select(Monitor).where(Monitor.group_id == group_id, Monitor.slug == slug)) is not None:
        suffix = f"-{number}"
        slug = f"{base[: 64 - len(suffix)]}{suffix}"
        number += 1
    return slug


def _device_name(raw: str) -> str:
    name = raw.strip()
    if not name or len(name) > 128:
        raise HTTPException(status_code=400, detail="Name must be 1 to 128 characters")
    return name


def _name_taken(db: Session, group_id: UUID, name: str, ignore_id: UUID | None = None) -> bool:
    query = select(Monitor).where(Monitor.group_id == group_id, Monitor.name == name)
    if ignore_id is not None:
        query = query.where(Monitor.id != ignore_id)
    return db.scalar(query) is not None


def _home_group(db: Session) -> Group:
    group = db.scalar(select(Group).where(Group.slug == "demo-home"))
    if group is None:
        group = db.scalar(select(Group).order_by(Group.created_at))
    if group is None:
        raise HTTPException(status_code=400, detail="No site is configured")
    return group


def _config_out(db: Session, monitor: Monitor) -> DeviceConfigOut:
    return DeviceConfigOut(
        name=monitor.name,
        health_interval_seconds=monitor.health_interval_seconds,
        config_version=monitor.config_version,
        tests=[ScheduledTestOut(**item) for item in scheduled_tests(db, monitor)],
        restart=monitor.restart_requested_at is not None,
        scan=monitor.scan_requested_at is not None,
    )


def _handshake_state(identity: str | None, handshake: datetime | None) -> str | None:
    if identity is None:
        return None
    if handshake is None:
        return "never_connected"
    if datetime.now(timezone.utc) - handshake <= CONNECTED_WITHIN:
        return "connected"
    return "disconnected"


def _tunnel_state(monitor: Monitor) -> str | None:
    return _handshake_state(monitor.identity_public_key, monitor.last_handshake_at)


def monitor_admin_out(monitor: Monitor) -> MonitorAdminOut:
    return MonitorAdminOut(
        id=monitor.id,
        slug=monitor.slug,
        name=monitor.name,
        status=monitor.status.value,
        last_seen_at=monitor.last_seen_at,
        lan_ip=monitor.lan_ip,
        public_ip=monitor.public_ip,
        isp=monitor.isp,
        agent_version=monitor.agent_version,
        location_label=monitor.location_label,
        region=monitor.region,
        country=monitor.country,
        tunnel_address=monitor.wg_address,
        wireless_tunnel_address=monitor.wg_wireless_address,
        tunnel_state=_tunnel_state(monitor),
        wireless_tunnel_state=_handshake_state(
            monitor.identity_public_key if monitor.wg_wireless_address else None,
            monitor.last_wireless_handshake_at,
        ),
        last_handshake_at=monitor.last_handshake_at,
        health_interval_seconds=monitor.health_interval_seconds,
        config_version=monitor.config_version,
        applied_config_version=monitor.applied_config_version,
        restart_requested_at=monitor.restart_requested_at,
    )


@router.get("/monitors", response_model=list[MonitorAdminOut])
def list_monitors(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> list[MonitorAdminOut]:
    monitors = db.scalars(select(Monitor).order_by(Monitor.name)).all()
    refresh_handshakes(db, list(monitors))
    db.commit()
    return [monitor_admin_out(monitor) for monitor in monitors]


@router.delete("/monitors/{monitor_id}", status_code=204)
def delete_monitor(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin_csrf)],
) -> None:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    db.add(AuditEvent(username=admin.username, action="delete", monitor_id=monitor.id, detail=monitor.name))
    test_ids = list(db.scalars(select(Test.id).where(Test.monitor_id == monitor.id)))
    if test_ids:
        db.execute(delete(TestResult).where(TestResult.test_id.in_(test_ids)))
        for issue in db.scalars(select(Issue).where(Issue.test_id.in_(test_ids))):
            issue.test_id = None
    for issue in db.scalars(select(Issue).where(Issue.monitor_id == monitor.id)):
        issue.monitor_id = None
    db.flush()
    if test_ids:
        db.execute(delete(Test).where(Test.monitor_id == monitor.id))
    db.execute(delete(MonitorHealth).where(MonitorHealth.monitor_id == monitor.id))
    db.execute(delete(WifiObservation).where(WifiObservation.monitor_id == monitor.id))
    # Installer codes cascade with the monitor, which releases them for re-registration.
    db.delete(monitor)
    db.commit()
    remove_preshared_key(monitor_id)
    rewrite_peers(db)


@router.post("/monitors/{monitor_id}/tunnel", response_model=TunnelIssueOut)
def issue_tunnels(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
) -> TunnelIssueOut:
    """Create the wired and wireless WireGuard configs. Private keys are shown once."""
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    hub_key = server_public_key()
    hub_endpoint = endpoint()
    if not hub_key or not hub_endpoint:
        raise HTTPException(status_code=503, detail="WireGuard hub is not ready")
    # A device that already has a wired tunnel keeps that tunnel. Only the
    # missing wireless peer is created, so the working wired config stays valid.
    add_wireless_only = bool(monitor.wg_address and monitor.wg_public_key and not monitor.wg_wireless_address)
    try:
        if not monitor.wg_address:
            monitor.wg_address = allocate_address(db, "wired")
        if not monitor.wg_wireless_address:
            monitor.wg_wireless_address = allocate_address(db, "wireless")
    except RuntimeError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    wired_config = ""
    try:
        if add_wireless_only:
            wireless_private, wireless_public = new_keypair()
            monitor.wg_wireless_public_key = wireless_public
            monitor.last_wireless_handshake_at = None
            db.flush()
            wireless_psk = new_preshared_key(monitor.id, "wireless")
        else:
            wired_private, wired_public = new_keypair()
            wireless_private, wireless_public = new_keypair()
            monitor.wg_public_key = wired_public
            monitor.wg_wireless_public_key = wireless_public
            monitor.last_handshake_at = None
            monitor.last_wireless_handshake_at = None
            db.flush()
            wired_psk = new_preshared_key(monitor.id, "wired")
            wireless_psk = new_preshared_key(monitor.id, "wireless")
            wired_config = client_config(
                link="wired",
                private_key=wired_private,
                address=monitor.wg_address or "",
                server_public_key=hub_key,
                endpoint_host=hub_endpoint,
                preshared_key=wired_psk,
            )
    except TunnelNotReady as exc:
        db.rollback()
        raise HTTPException(status_code=503, detail="WireGuard hub is not ready") from exc
    db.commit()
    rewrite_peers(db)
    db.refresh(monitor)
    return TunnelIssueOut(
        id=monitor.id,
        name=monitor.name,
        address=monitor.wg_address or "",
        wireless_address=monitor.wg_wireless_address or "",
        config=wired_config,
        wireless_config=client_config(
            link="wireless",
            private_key=wireless_private,
            address=monitor.wg_wireless_address or "",
            server_public_key=hub_key,
            endpoint_host=hub_endpoint,
            preshared_key=wireless_psk,
        ),
    )


@router.post("/monitors/health", response_model=DeviceConfigOut)
def post_device_health(
    body: DeviceHealthIn,
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_monitor_name: Annotated[Optional[str], Header()] = None,
) -> DeviceConfigOut:
    monitor = _resolve_monitor_identity(db, authorization, x_monitor_name)
    now = datetime.now(timezone.utc)
    monitor.last_seen_at = now
    monitor.status = MonitorStatus.online
    monitor.lan_ip = body.lan_ip
    if body.public_ip:
        monitor.public_ip = body.public_ip
    if body.isp:
        monitor.isp = body.isp
    monitor.agent_version = body.agent_version
    monitor.applied_config_version = body.config_version
    db.add(
        MonitorHealth(
            monitor_id=monitor.id,
            reported_at=now,
            hostname=body.hostname,
            uptime_seconds=body.uptime_seconds,
            cpu_percent=body.cpu_percent,
            load_1=body.load_1,
            mem_used_mb=body.mem_used_mb,
            mem_total_mb=body.mem_total_mb,
            disk_used_mb=body.disk_used_mb,
            disk_total_mb=body.disk_total_mb,
            temp_c=body.temp_c,
            lan_ip=body.lan_ip,
            public_ip=body.public_ip,
            isp=body.isp,
            config_version=body.config_version,
        )
    )
    cutoff = now - timedelta(days=7)
    db.execute(delete(MonitorHealth).where(MonitorHealth.reported_at < cutoff))
    ensure_internet_tests(db, monitor)
    db.commit()
    return _config_out(db, monitor)


@router.get("/monitors/command", response_model=ProbeCommandOut)
def probe_command(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_monitor_name: Annotated[Optional[str], Header()] = None,
) -> ProbeCommandOut:
    monitor = _resolve_monitor_identity(db, authorization, x_monitor_name)
    return ProbeCommandOut(restart=monitor.restart_requested_at is not None, scan=monitor.scan_requested_at is not None)


@router.post("/monitors/command", response_model=ProbeCommandOut)
def ack_probe_command(
    db: Annotated[Session, Depends(get_db)],
    authorization: Annotated[Optional[str], Header()] = None,
    x_monitor_name: Annotated[Optional[str], Header()] = None,
) -> ProbeCommandOut:
    """The probe calls this once it is about to replace its process."""
    monitor = _resolve_monitor_identity(db, authorization, x_monitor_name)
    monitor.restart_requested_at = None
    db.commit()
    return ProbeCommandOut(restart=False, scan=monitor.scan_requested_at is not None)


@router.post("/monitors/{monitor_id}/restart")
def request_probe_restart(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    admin: Annotated[User, Depends(require_admin)],
) -> dict:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    if monitor.restart_requested_at is None:
        monitor.restart_requested_at = datetime.now(timezone.utc)
    db.add(AuditEvent(username=admin.username, action="restart", monitor_id=monitor.id, detail=monitor.name))
    db.commit()
    return {
        "id": str(monitor.id),
        "restart_requested_at": monitor.restart_requested_at.isoformat(),
    }


def _result_to_out(r: TestResult) -> ResultOut:
    test = r.test
    return ResultOut(
        id=r.id,
        external_id=r.external_id,
        test_id=r.test_id,
        test_slug=test.slug,
        test_name=test.name,
        test_kind=test.kind.value,
        monitor_id=test.monitor_id,
        monitor_slug=test.monitor.slug,
        network_id=test.network_id,
        network_slug=test.network.slug,
        network_name=test.network.name,
        started_at=r.started_at,
        finished_at=r.finished_at,
        status=r.status.value,
        stages=r.stages or [],
        metrics=r.metrics or {},
        message=r.message,
        status_reason=r.status_reason
        or explain_result(test.kind.value, r.status.value, r.metrics, r.stages, r.message),
    )


def _fill_web_quorum(tests, latest_by_test, cell_map, cfg) -> None:
    """Web Services cell color comes from how many services are steadily bad, not one sample."""
    groups: dict[tuple, dict[str, dict[str, Test]]] = {}
    for test in tests:
        if not test.enabled:
            continue
        column = matrix_column(test.network.slug, test.slug)
        if column != "web" or not is_web_check(test.slug):
            continue
        kind, _, key = test.slug.partition("-")
        groups.setdefault((test.monitor_id, test.network_id, column), {}).setdefault(key, {})[kind] = test

    now = datetime.now(timezone.utc)
    for cell_key, services in groups.items():
        cell = cell_map.get(cell_key)
        if cell is None:
            continue
        statuses = []
        sustained_fail = False
        last_at = None
        for kinds in services.values():
            http = kinds.get("http")
            icmp = kinds.get("icmp")
            for probe in (http, icmp):
                if probe is None:
                    continue
                result = latest_by_test.get(probe.id)
                if result is not None and (last_at is None or result.started_at > last_at):
                    last_at = result.started_at
            http_status = http.stable_status if http is not None and latest_by_test.get(http.id) else None
            icmp_status = icmp.stable_status if icmp is not None and latest_by_test.get(icmp.id) else None
            stable = service_status(http_status, icmp_status)
            if stable is None:
                continue
            statuses.append(stable)
            if (
                http is not None
                and http.stable_status == ResultStatus.fail
                and http.state_since is not None
                and now - http.state_since >= timedelta(minutes=15)
            ):
                sustained_fail = True
        if not statuses:
            continue
        status, bad, total = cell_quorum(statuses, cfg, sustained_fail)
        cell.status = status
        cell.failing_tests = bad
        cell.last_test_at = last_at
        cell.quorum = {"bad": bad, "total": total}


@router.get("/summary", response_model=SummaryResponse)
def summary(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> SummaryResponse:
    monitors = db.scalars(select(Monitor).order_by(Monitor.name)).all()
    networks = db.scalars(select(Network).order_by(Network.name)).all()
    tests = db.scalars(
        select(Test).options(joinedload(Test.monitor), joinedload(Test.network))
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

    # Build matrix cells keyed by monitor × network × column.
    # The Internet network splits into Internet Service and Web Services.
    cell_map: dict[tuple[UUID, UUID, str], HealthCell] = {}
    for monitor in monitors:
        for network in networks:
            columns = ["internet", "web"] if network.slug in {"wan", "wired", "wifi"} else [network.slug]
            for column in columns:
                cell_map[(monitor.id, network.id, column)] = HealthCell(
                    monitor_id=monitor.id,
                    monitor_slug=monitor.slug,
                    monitor_name=monitor.name,
                    network_id=network.id,
                    network_slug=network.slug,
                    network_name=network.name,
                    column=column,
                    status="unknown",
                    last_test_at=None,
                    failing_tests=0,
                )

    rank = {"ok": 0, "degraded": 1, "fail": 2, "unknown": -1}
    for test in tests:
        if not test.enabled:
            continue
        column = matrix_column(test.network.slug, test.slug)
        if column is None:
            continue
        cell = cell_map.get((test.monitor_id, test.network_id, column))
        if cell is None or column == "web":
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

    _fill_web_quorum(tests, latest_by_test, cell_map, stability_config(load_web_stability(db)))

    open_issues = db.scalars(
        select(Issue)
        .where(Issue.status == IssueStatus.open)
        .order_by(desc(Issue.opened_at))
        .limit(20)
    ).all()
    monitor_by_id = {s.id: s for s in monitors}
    network_by_id = {n.id: n for n in networks}
    test_by_id = {t.id: t for t in tests}
    issue_summaries = []
    for i in open_issues:
        latest = latest_by_test.get(i.test_id) if i.test_id else None
        if latest is not None and latest.status.value == "ok":
            continue
        issue_summaries.append(
            IssueSummary(
                id=i.id,
                title=i.title,
                severity=i.severity.value,
                status=i.status.value,
                opened_at=i.opened_at,
                root_cause_stage=i.root_cause_stage,
                monitor_slug=monitor_by_id[i.monitor_id].slug if i.monitor_id and i.monitor_id in monitor_by_id else None,
                monitor_name=monitor_by_id[i.monitor_id].name if i.monitor_id and i.monitor_id in monitor_by_id else None,
                network_slug=network_by_id[i.network_id].slug
                if i.network_id and i.network_id in network_by_id
                else None,
                network_name=network_by_id[i.network_id].name
                if i.network_id and i.network_id in network_by_id
                else None,
                test_name=test_by_id[i.test_id].name if i.test_id and i.test_id in test_by_id else None,
            )
        )

    return SummaryResponse(
        generated_at=datetime.now(timezone.utc),
        matrix=list(cell_map.values()),
        open_issues=issue_summaries,
        monitors=[
            {
                "id": str(s.id),
                "slug": s.slug,
                "name": s.name,
                "status": s.status.value,
                "location_label": s.location_label,
                "region": s.region,
                "last_seen_at": s.last_seen_at.isoformat() if s.last_seen_at else None,
            }
            for s in monitors
        ],
        networks=[
            {"id": str(n.id), "slug": n.slug, "name": n.name, "kind": n.kind.value} for n in networks
        ],
    )


@router.get("/results", response_model=list[ResultOut])
def results(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    monitor_id: Optional[UUID] = None,
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
            joinedload(TestResult.test).joinedload(Test.monitor),
            joinedload(TestResult.test).joinedload(Test.network),
        )
        .order_by(desc(TestResult.started_at))
        .limit(limit)
    )
    if monitor_id:
        stmt = stmt.where(Test.monitor_id == monitor_id)
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


@router.get("/monitors/{monitor_id}/log", response_model=ResultPage)
def monitor_log(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    offset: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=200),
    probe: str = Query("all"),
) -> ResultPage:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    try:
        probe_filter = log_slug_filter(probe)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid probe filter") from exc
    count_stmt = (
        select(func.count(TestResult.id))
        .select_from(TestResult)
        .join(Test)
        .where(Test.monitor_id == monitor_id)
    )
    rows_stmt = (
        select(TestResult)
        .join(Test)
        .where(Test.monitor_id == monitor_id)
        .options(
            joinedload(TestResult.test).joinedload(Test.monitor),
            joinedload(TestResult.test).joinedload(Test.network),
        )
        .order_by(desc(TestResult.started_at), desc(TestResult.id))
    )
    if probe_filter is not None:
        count_stmt = count_stmt.where(probe_filter)
        rows_stmt = rows_stmt.where(probe_filter)
    total = db.scalar(count_stmt) or 0
    rows = db.scalars(rows_stmt.offset(offset).limit(limit)).unique().all()
    return ResultPage(total=total, offset=offset, limit=limit, items=[_result_to_out(r) for r in rows])


def _metric_float(metrics: Optional[dict], key: str) -> Optional[float]:
    value = (metrics or {}).get(key)
    if isinstance(value, (int, float)):
        return float(value)
    return None


def _metric_hops(metrics: Optional[dict]) -> list[HopMetric]:
    hops: list[HopMetric] = []
    for item in (metrics or {}).get("hops") or []:
        if not isinstance(item, dict):
            continue
        try:
            hops.append(
                HopMetric(
                    hop=int(item["hop"]),
                    host=str(item["host"]),
                    loss_pct=float(item["loss_pct"]),
                    best_ms=float(item["best_ms"]),
                    avg_ms=float(item["avg_ms"]),
                    worst_ms=float(item["worst_ms"]),
                )
            )
        except (KeyError, TypeError, ValueError):
            continue
    return hops


def _metric_throughput(metrics: Optional[dict]) -> Optional[ThroughputMbps]:
    raw = metrics or {}
    nested = raw.get("throughput_mbps") if isinstance(raw.get("throughput_mbps"), dict) else {}
    upload = nested.get("upload", raw.get("up_mbps"))
    download = nested.get("download", raw.get("down_mbps"))
    if not isinstance(upload, (int, float)) and not isinstance(download, (int, float)):
        return None
    return ThroughputMbps(
        upload=float(upload) if isinstance(upload, (int, float)) else None,
        download=float(download) if isinstance(download, (int, float)) else None,
    )


@router.get("/metrics", response_model=MetricsResponse)
def metrics(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    test_id: UUID = Query(...),
    range: str = Query("24h", pattern="^(1h|3h|6h|8h|12h|24h|7d|30d)$"),
) -> MetricsResponse:
    delta = {
        "1h": timedelta(hours=1),
        "3h": timedelta(hours=3),
        "6h": timedelta(hours=6),
        "8h": timedelta(hours=8),
        "12h": timedelta(hours=12),
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
            rtt_ms=_metric_float(r.metrics, "rtt_ms"),
            loss_pct=_metric_float(r.metrics, "loss_pct"),
            jitter_ms=_metric_float(r.metrics, "jitter_ms"),
            up_mbps=_metric_float(r.metrics, "up_mbps"),
            down_mbps=_metric_float(r.metrics, "down_mbps"),
            hops=_metric_hops(r.metrics),
            throughput_mbps=_metric_throughput(r.metrics),
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


@router.get("/wifi-scans", response_model=list[WifiObservationOut])
def wifi_scans(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    monitor_id: UUID = Query(...),
    range: str = Query("24h", pattern="^(24h|7d)$"),
) -> list[WifiObservationOut]:
    delta = {"24h": timedelta(hours=24), "7d": timedelta(days=7)}[range]
    since = datetime.now(timezone.utc) - delta
    if db.get(Monitor, monitor_id) is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    rows = db.scalars(
        select(WifiObservation)
        .where(WifiObservation.monitor_id == monitor_id, WifiObservation.scanned_at >= since)
        .order_by(WifiObservation.scanned_at)
    ).all()
    return [
        WifiObservationOut(
            scanned_at=row.scanned_at,
            ssid=row.ssid,
            bssid=row.bssid,
            vendor=row.vendor,
            band=row.band,
            channel=row.channel,
            channel_width=row.channel_width,
            rssi_dbm=row.rssi_dbm,
            noise_dbm=row.noise_dbm,
            security=row.security,
            phy=row.phy,
            max_link_rate_mbps=row.max_link_rate_mbps,
        )
        for row in rows
    ]


def _metric_number(metrics: dict, key: str) -> float | None:
    value = metrics.get(key)
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _latest_test_fields(test: Test, row: TestResult | None) -> dict:
    if row is None:
        return {
            "latest_status": "unknown",
            "latest_at": None,
            "latest_reason": None,
            "latest_rtt_ms": None,
            "latest_loss_pct": None,
        }
    metrics = row.metrics or {}
    reason = row.status_reason or explain_result(
        test.kind.value, row.status.value, metrics, row.stages, row.message
    )
    return {
        "latest_status": row.status.value,
        "latest_at": row.started_at.isoformat(),
        "latest_reason": reason,
        "latest_rtt_ms": _metric_number(metrics, "rtt_ms"),
        "latest_loss_pct": _metric_number(metrics, "loss_pct"),
    }


@router.get("/monitors/{monitor_id}")
def get_monitor(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> dict:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    tests = db.scalars(
        select(Test)
        .where(Test.monitor_id == monitor_id)
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
        "id": str(monitor.id),
        "slug": monitor.slug,
        "name": monitor.name,
        "status": monitor.status.value,
        "last_seen_at": monitor.last_seen_at.isoformat() if monitor.last_seen_at else None,
        "latitude": monitor.latitude,
        "longitude": monitor.longitude,
        "location_label": monitor.location_label,
        "public_ip": monitor.public_ip,
        "isp": monitor.isp,
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
                **_latest_test_fields(t, latest.get(t.id)),
                "enabled": t.enabled,
            }
            for t in tests
        ],
    }


@router.get("/monitors/{monitor_id}/path")
def monitor_path(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    link: str = Query(pattern="^(wired|wireless)$"),
    destination: str = Query(default="server", pattern="^[a-z0-9-]{1,32}$"),
) -> dict:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    if destination == "server":
        slug = "mtr-path"
        target_name = "HomeNetWatch server"
        target_ip = ""
    else:
        service = next((row for row in load_web_services(db) if row.key == destination), None)
        if service is None:
            raise HTTPException(status_code=404, detail="Destination not found")
        slug = f"mtr-{service.key}"
        target_name = service.label
        target_ip = service.host
    network_slug = "wired" if link == "wired" else "wifi"
    test = db.scalars(
        select(Test)
        .join(Network, Test.network_id == Network.id)
        .where(Test.monitor_id == monitor_id, Test.slug == slug, Network.slug == network_slug)
    ).first()
    rows = []
    if test is not None:
        target_ip = test.target.split("/")[0] or target_ip
        rows = list(
            db.scalars(
                select(TestResult)
                .where(TestResult.test_id == test.id)
                .order_by(desc(TestResult.started_at))
                .limit(24)
            ).all()
        )
    latest = rows[0] if rows else None
    raw_hops = (latest.metrics or {}).get("hops") if latest else []
    history: dict[str, list[float | None]] = {}
    for row in reversed(rows):
        for item in (row.metrics or {}).get("hops") or []:
            if not isinstance(item, dict):
                continue
            ttl = item.get("hop")
            if ttl is None:
                continue
            host = str(item.get("host") or "")
            loss = item.get("loss_pct")
            avg = item.get("avg_ms")
            silent = host.strip() in {"", "?", "???", "*", "***"} or (
                isinstance(loss, (int, float)) and loss >= 100 and (not isinstance(avg, (int, float)) or avg <= 0)
            )
            history.setdefault(str(int(ttl)), []).append(None if silent or not isinstance(avg, (int, float)) else float(avg))
    body = build_trace(
        raw_hops if isinstance(raw_hops, list) else [],
        isp_name=monitor.isp,
        target_name=target_name,
    )
    body["status"] = "complete" if body["hops"] else "empty"
    body["traced_at"] = latest.started_at.isoformat() if latest else None
    body["probes_per_hop"] = 5
    body["agent"] = {"name": monitor.name, "online": monitor.status == MonitorStatus.online}
    body["target"] = {"name": target_name, "ip": target_ip}
    body["history"] = history
    return body


_HEALTH_RANK = {"ok": 0, "degraded": 1, "fail": 2}


@router.get("/monitors/{monitor_id}/health")
def monitor_health(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    range: str = Query("24h", pattern="^(24h|7d|30d)$"),
) -> dict:
    if db.get(Monitor, monitor_id) is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    delta = {"24h": timedelta(hours=24), "7d": timedelta(days=7), "30d": timedelta(days=30)}[range]
    since = datetime.now(timezone.utc) - delta
    rows = db.execute(
        select(TestResult.started_at, TestResult.status)
        .join(Test, Test.id == TestResult.test_id)
        .where(Test.monitor_id == monitor_id, TestResult.started_at >= since)
        .order_by(TestResult.started_at)
    ).all()
    buckets: dict[datetime, str] = {}
    for started_at, status in rows:
        moment = started_at.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
        current = buckets.get(moment)
        value = status.value
        if current is None or _HEALTH_RANK[value] > _HEALTH_RANK[current]:
            buckets[moment] = value
    return {
        "monitor_id": str(monitor_id),
        "points": [{"t": moment.isoformat(), "status": buckets[moment]} for moment in sorted(buckets)],
    }


def _as_utc(moment: datetime) -> datetime:
    if moment.tzinfo is None:
        return moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def _sample_out(row: MonitorHealth) -> dict:
    return {
        "reported_at": _as_utc(row.reported_at).isoformat(),
        "hostname": row.hostname,
        "uptime_seconds": row.uptime_seconds,
        "cpu_percent": row.cpu_percent,
        "load_1": row.load_1,
        "mem_used_mb": row.mem_used_mb,
        "mem_total_mb": row.mem_total_mb,
        "disk_used_mb": row.disk_used_mb,
        "disk_total_mb": row.disk_total_mb,
        "temp_c": row.temp_c,
        "lan_ip": row.lan_ip,
    }


@router.get("/monitors/{monitor_id}/device")
def get_device(
    monitor_id: UUID,
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
) -> dict:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    now = datetime.now(timezone.utc)
    since = now - timedelta(hours=24)
    rows = db.scalars(
        select(MonitorHealth)
        .where(MonitorHealth.monitor_id == monitor_id, MonitorHealth.reported_at >= since)
        .order_by(MonitorHealth.reported_at)
    ).all()
    latest = rows[-1] if rows else db.scalar(
        select(MonitorHealth)
        .where(MonitorHealth.monitor_id == monitor_id)
        .order_by(desc(MonitorHealth.reported_at))
        .limit(1)
    )
    connected = False
    if latest is not None:
        interval = max(monitor.health_interval_seconds or 60, 15)
        connected = now - _as_utc(latest.reported_at) <= timedelta(seconds=interval * 2)
    return {
        "monitor_id": str(monitor.id),
        "name": monitor.name,
        "connected": connected,
        "last_seen_at": monitor.last_seen_at.isoformat() if monitor.last_seen_at else None,
        "lan_ip": monitor.lan_ip,
        "public_ip": monitor.public_ip,
        "isp": monitor.isp,
        "agent_version": monitor.agent_version,
        "hostname": latest.hostname if latest else None,
        "config_version": monitor.config_version,
        "applied_config_version": monitor.applied_config_version,
        "health_interval_seconds": monitor.health_interval_seconds,
        "restart_requested_at": monitor.restart_requested_at.isoformat() if monitor.restart_requested_at else None,
        "location_label": monitor.location_label,
        "region": monitor.region,
        "country": monitor.country,
        "latitude": monitor.latitude,
        "longitude": monitor.longitude,
        "latest": _sample_out(latest) if latest else None,
        "points": [
            {
                "t": _as_utc(row.reported_at).isoformat(),
                "cpu_percent": row.cpu_percent,
                "temp_c": row.temp_c,
                "mem_used_mb": row.mem_used_mb,
                "disk_used_mb": row.disk_used_mb,
            }
            for row in rows
        ],
    }


@router.patch("/monitors/{monitor_id}")
def update_monitor_location(
    monitor_id: UUID,
    body: MonitorLocationIn,
    db: Annotated[Session, Depends(get_db)],
    _admin: Annotated[User, Depends(require_admin)],
) -> dict:
    monitor = db.get(Monitor, monitor_id)
    if monitor is None:
        raise HTTPException(status_code=404, detail="Remote agent not found")
    sent = body.model_fields_set
    if "latitude" in sent or "longitude" in sent:
        if "latitude" not in sent or "longitude" not in sent:
            raise HTTPException(status_code=400, detail="Latitude and longitude are set together")
        if (body.latitude is None) != (body.longitude is None):
            raise HTTPException(status_code=400, detail="Latitude and longitude are set together")
        if body.latitude is not None and not -90 <= body.latitude <= 90:
            raise HTTPException(status_code=400, detail="Latitude must be between -90 and 90")
        if body.longitude is not None and not -180 <= body.longitude <= 180:
            raise HTTPException(status_code=400, detail="Longitude must be between -180 and 180")
        monitor.latitude = body.latitude
        monitor.longitude = body.longitude
    if "location_label" in sent:
        label = (body.location_label or "").strip()
        monitor.location_label = label or None
    if "country" in sent:
        country = (body.country or "").strip()
        if country and country not in {"United States", "Canada"}:
            raise HTTPException(status_code=400, detail="Country must be United States or Canada")
        monitor.country = country or None
    if "region" in sent:
        region = (body.region or "").strip()
        country_name = monitor.country or ""
        allowed = REGIONS_BY_COUNTRY.get(country_name, set())
        if region and region not in allowed:
            raise HTTPException(status_code=400, detail="State or province does not match the country")
        monitor.region = region or None
    config_changed = False
    if "name" in sent:
        name = _device_name(body.name or "")
        if name != monitor.name:
            if _name_taken(db, monitor.group_id, name, monitor.id):
                raise HTTPException(status_code=409, detail="A remote agent with this device name already exists")
            monitor.name = name
            config_changed = True
    if "health_interval_seconds" in sent:
        interval = body.health_interval_seconds
        if interval is None or not 15 <= interval <= 3600:
            raise HTTPException(status_code=400, detail="Report interval must be between 15 and 3600 seconds")
        if interval != monitor.health_interval_seconds:
            monitor.health_interval_seconds = interval
            config_changed = True
    if config_changed:
        monitor.config_version += 1
    db.commit()
    return {
        "id": str(monitor.id),
        "name": monitor.name,
        "latitude": monitor.latitude,
        "longitude": monitor.longitude,
        "location_label": monitor.location_label,
        "region": monitor.region,
        "country": monitor.country,
        "health_interval_seconds": monitor.health_interval_seconds,
        "config_version": monitor.config_version,
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
        .options(joinedload(Test.monitor), joinedload(Test.network))
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
        "monitor_id": str(test.monitor_id),
        "monitor_slug": test.monitor.slug,
        "monitor_name": test.monitor.name,
        "network_id": str(test.network_id),
        "network_slug": test.network.slug,
        "network_name": test.network.name,
    }


def _issue_to_out(db: Session, issue: Issue, include_failures: bool) -> IssueOut:
    monitor = db.get(Monitor, issue.monitor_id) if issue.monitor_id else None
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
                joinedload(TestResult.test).joinedload(Test.monitor),
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
        monitor_id=issue.monitor_id,
        monitor_slug=monitor.slug if monitor else None,
        network_id=issue.network_id,
        network_slug=network.slug if network else None,
        test_id=issue.test_id,
        test_slug=test.slug if test else None,
        recent_failures=failures,
    )
