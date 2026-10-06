from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class UserRole(str, enum.Enum):
    admin = "admin"
    viewer = "viewer"


class SensorStatus(str, enum.Enum):
    online = "online"
    offline = "offline"
    unknown = "unknown"


class NetworkKind(str, enum.Enum):
    wired = "wired"
    wifi = "wifi"


class TestKind(str, enum.Enum):
    __test__ = False
    http = "http"
    dns = "dns"
    ping = "ping"
    wifi = "wifi"


class ResultStatus(str, enum.Enum):
    ok = "ok"
    degraded = "degraded"
    fail = "fail"


class IssueSeverity(str, enum.Enum):
    info = "info"
    warning = "warning"
    critical = "critical"


class IssueStatus(str, enum.Enum):
    open = "open"
    resolved = "resolved"


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    slug: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sensors: Mapped[list[Sensor]] = relationship(back_populates="group")
    networks: Mapped[list[Network]] = relationship(back_populates="group")


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    username: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Sensor(Base):
    __tablename__ = "sensors"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[SensorStatus] = mapped_column(
        Enum(SensorStatus, name="sensor_status"), default=SensorStatus.unknown, nullable=False
    )
    last_seen_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped[Group] = relationship(back_populates="sensors")
    tests: Mapped[list[Test]] = relationship(back_populates="sensor")

    __table_args__ = (UniqueConstraint("group_id", "slug", name="uq_sensor_group_slug"),)


class Network(Base):
    __tablename__ = "networks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[NetworkKind] = mapped_column(Enum(NetworkKind, name="network_kind"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    group: Mapped[Group] = relationship(back_populates="networks")
    tests: Mapped[list[Test]] = relationship(back_populates="network")

    __table_args__ = (UniqueConstraint("group_id", "slug", name="uq_network_group_slug"),)


class Test(Base):
    __test__ = False  # not a pytest class
    __tablename__ = "tests"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    sensor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False)
    network_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("networks.id", ondelete="CASCADE"), nullable=False)
    slug: Mapped[str] = mapped_column(String(64), nullable=False)
    name: Mapped[str] = mapped_column(String(128), nullable=False)
    kind: Mapped[TestKind] = mapped_column(Enum(TestKind, name="test_kind"), nullable=False)
    target: Mapped[str] = mapped_column(String(255), nullable=False)
    interval_seconds: Mapped[int] = mapped_column(Integer, default=300, nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    sensor: Mapped[Sensor] = relationship(back_populates="tests")
    network: Mapped[Network] = relationship(back_populates="tests")
    results: Mapped[list[TestResult]] = relationship(back_populates="test")

    __table_args__ = (
        UniqueConstraint("sensor_id", "network_id", "slug", name="uq_test_sensor_network_slug"),
    )


class TestResult(Base):
    __test__ = False
    __tablename__ = "test_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    # Client-supplied idempotency key from the sensor agent
    external_id: Mapped[str] = mapped_column(String(64), nullable=False)
    test_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("tests.id", ondelete="CASCADE"), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    finished_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[ResultStatus] = mapped_column(Enum(ResultStatus, name="result_status"), nullable=False)
    # Stage waterfall: [{name, duration_ms, status?}, ...]
    stages: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, nullable=False, default=list)
    metrics: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False, default=dict)
    message: Mapped[Optional[str]] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    test: Mapped[Test] = relationship(back_populates="results")

    __table_args__ = (
        UniqueConstraint("external_id", name="uq_test_result_external_id"),
        Index("ix_test_results_test_started", "test_id", "started_at"),
    )


class Issue(Base):
    __tablename__ = "issues"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=_uuid)
    group_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("groups.id", ondelete="CASCADE"), nullable=False)
    sensor_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("sensors.id", ondelete="SET NULL"))
    network_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("networks.id", ondelete="SET NULL"))
    test_id: Mapped[Optional[uuid.UUID]] = mapped_column(ForeignKey("tests.id", ondelete="SET NULL"))
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    severity: Mapped[IssueSeverity] = mapped_column(
        Enum(IssueSeverity, name="issue_severity"), nullable=False
    )
    status: Mapped[IssueStatus] = mapped_column(
        Enum(IssueStatus, name="issue_status"), default=IssueStatus.open, nullable=False
    )
    root_cause_stage: Mapped[Optional[str]] = mapped_column(String(64))
    opened_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


# Keep Float imported for potential future metric columns
_ = Float
