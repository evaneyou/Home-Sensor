"""Hourly KPI counts for availability and application reports."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0038_kpi_hourly"
down_revision: Union[str, None] = "0037_telegram_alerts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "kpi_hourly",
        sa.Column("bucket_start", sa.DateTime(timezone=True), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("link", sa.String(length=16), primary_key=True),
        sa.Column("kind", sa.String(length=16), primary_key=True),
        sa.Column("n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("failed", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("degraded", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("incidents", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("loss_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("loss_n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("loss_max", sa.Float(), nullable=True),
        sa.Column("rtt_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("rtt_n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("jitter_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("jitter_n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("down_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("down_n", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("up_sum", sa.Float(), nullable=False, server_default="0"),
        sa.Column("up_n", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_kpi_hourly_monitor_bucket", "kpi_hourly", ["monitor_id", "bucket_start"])


def downgrade() -> None:
    op.drop_index("ix_kpi_hourly_monitor_bucket", table_name="kpi_hourly")
    op.drop_table("kpi_hourly")
