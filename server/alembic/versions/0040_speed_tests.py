"""Live speed tests and their readings."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0040_speed_tests"
down_revision: Union[str, None] = "0039_kpi_daily"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "speed_tests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link", sa.String(length=16), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("down_seconds", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("up_seconds", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("phase", sa.String(length=16), nullable=False, server_default=""),
        sa.Column("down_mbps", sa.Float(), nullable=True),
        sa.Column("up_mbps", sa.Float(), nullable=True),
        sa.Column("ping_ms", sa.Float(), nullable=True),
        sa.Column("jitter_ms", sa.Float(), nullable=True),
        sa.Column("error", sa.String(length=300), nullable=False, server_default=""),
    )
    op.create_index("ix_speed_tests_monitor_requested", "speed_tests", ["monitor_id", "requested_at"])
    op.create_table(
        "speed_samples",
        sa.Column("test_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("speed_tests.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("seq", sa.Integer(), primary_key=True),
        sa.Column("phase", sa.String(length=16), nullable=False),
        sa.Column("t_ms", sa.Integer(), nullable=False),
        sa.Column("mbps", sa.Float(), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("speed_samples")
    op.drop_index("ix_speed_tests_monitor_requested", table_name="speed_tests")
    op.drop_table("speed_tests")
