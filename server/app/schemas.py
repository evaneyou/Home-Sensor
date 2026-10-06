from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import UUID

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class UserOut(BaseModel):
    id: UUID
    username: str
    role: str

    model_config = {"from_attributes": True}


class StageIn(BaseModel):
    name: str
    duration_ms: float
    status: Optional[str] = None


class IngestResult(BaseModel):
    id: str = Field(..., description="Client-side unique result id for idempotency")
    test_slug: str
    network_slug: str
    started_at: datetime
    finished_at: datetime
    status: str
    stages: list[StageIn] = Field(default_factory=list)
    metrics: dict[str, Any] = Field(default_factory=dict)
    message: Optional[str] = None


class IngestRequest(BaseModel):
    results: list[IngestResult]


class IngestResponse(BaseModel):
    accepted: int
    duplicates: int
    ids: list[str]


class HealthCell(BaseModel):
    sensor_id: UUID
    sensor_slug: str
    sensor_name: str
    network_id: UUID
    network_slug: str
    network_name: str
    status: str  # ok | degraded | fail | unknown
    last_test_at: Optional[datetime] = None
    failing_tests: int = 0


class IssueSummary(BaseModel):
    id: UUID
    title: str
    severity: str
    status: str
    opened_at: datetime
    root_cause_stage: Optional[str] = None
    sensor_slug: Optional[str] = None
    network_slug: Optional[str] = None


class SummaryResponse(BaseModel):
    generated_at: datetime
    matrix: list[HealthCell]
    open_issues: list[IssueSummary]
    sensors: list[dict[str, Any]]
    networks: list[dict[str, Any]]


class ResultOut(BaseModel):
    id: UUID
    external_id: str
    test_id: UUID
    test_slug: str
    test_name: str
    test_kind: str
    sensor_id: UUID
    sensor_slug: str
    network_id: UUID
    network_slug: str
    started_at: datetime
    finished_at: datetime
    status: str
    stages: list[dict[str, Any]]
    metrics: dict[str, Any]
    message: Optional[str] = None


class MetricsPoint(BaseModel):
    t: datetime
    status: str
    rtt_ms: Optional[float] = None
    loss_pct: Optional[float] = None
    stages: list[dict[str, Any]] = Field(default_factory=list)


class MetricsResponse(BaseModel):
    test_id: UUID
    test_slug: str
    points: list[MetricsPoint]


class IssueOut(BaseModel):
    id: UUID
    title: str
    summary: str
    severity: str
    status: str
    root_cause_stage: Optional[str] = None
    opened_at: datetime
    resolved_at: Optional[datetime] = None
    sensor_id: Optional[UUID] = None
    sensor_slug: Optional[str] = None
    network_id: Optional[UUID] = None
    network_slug: Optional[str] = None
    test_id: Optional[UUID] = None
    test_slug: Optional[str] = None
    recent_failures: list[ResultOut] = Field(default_factory=list)
