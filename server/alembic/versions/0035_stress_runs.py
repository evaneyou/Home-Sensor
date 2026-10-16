"""Stress tests: a group of synthetic sessions that run, change and stop together."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0035_stress_runs"
down_revision: Union[str, None] = "0034_adhoc_traces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "stress_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("links", postgresql.JSONB(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("started_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_stress_runs_monitor_id", "stress_runs", ["monitor_id"])
    op.add_column(
        "synthetic_runs",
        sa.Column("stress_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("stress_runs.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_index("ix_synthetic_runs_stress_id", "synthetic_runs", ["stress_id"])


def downgrade() -> None:
    op.drop_index("ix_synthetic_runs_stress_id", table_name="synthetic_runs")
    op.drop_column("synthetic_runs", "stress_id")
    op.drop_index("ix_stress_runs_monitor_id", table_name="stress_runs")
    op.drop_table("stress_runs")
