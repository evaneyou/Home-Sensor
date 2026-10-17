"""The KPI dashboard: one report for a day, week, month or year."""

from __future__ import annotations

import uuid
from typing import Annotated, Any, Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app import kpi
from app.auth import get_current_user
from app.db import get_db
from app.models import User

router = APIRouter(prefix="/api/v1/kpi")


@router.get("")
def get_report(
    db: Annotated[Session, Depends(get_db)],
    _user: Annotated[User, Depends(get_current_user)],
    period: Annotated[str, Query(pattern="^(day|week|month|year)$")] = "week",
    monitor_id: Optional[uuid.UUID] = None,
) -> dict[str, Any]:
    return kpi.report(db, period, monitor_id=monitor_id)
