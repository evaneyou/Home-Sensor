"""Store synthetic traffic profiles, runs, and interval samples."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0030_synthetic_traffic"
down_revision: Union[str, None] = "0029_drop_iperf3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rtnp_secrets",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("key", sa.String(length=128), nullable=False),
    )
    op.create_table(
        "synthetic_profiles",
        sa.Column("slug", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=128), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
    )
    op.create_table(
        "synthetic_runs",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("profile_slug", sa.String(length=64), nullable=False),
        sa.Column("mode", sa.String(length=16), nullable=False),
        sa.Column("links", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("duration_seconds", sa.Integer(), nullable=True),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="running"),
        sa.Column("finished_links", postgresql.JSONB(astext_type=sa.Text()), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column("started_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_table(
        "synthetic_samples",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("run_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("synthetic_runs.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link", sa.String(length=16), nullable=False),
        sa.Column("sample_key", sa.String(length=64), nullable=False),
        sa.Column("interval_index", sa.Integer(), nullable=True),
        sa.Column("recorded_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("rtt_ms", sa.Float(), nullable=True),
        sa.Column("jitter_ms", sa.Float(), nullable=True),
        sa.Column("loss_pct", sa.Float(), nullable=True),
        sa.Column("verdict", sa.String(length=16), nullable=True),
        sa.Column("metrics", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.UniqueConstraint("run_id", "link", "sample_key", name="uq_synthetic_sample"),
    )
    op.create_index("ix_synthetic_sample_recorded", "synthetic_samples", ["recorded_at"])


def downgrade() -> None:
    op.drop_index("ix_synthetic_sample_recorded", table_name="synthetic_samples")
    op.drop_table("synthetic_samples")
    op.drop_table("synthetic_runs")
    op.drop_table("synthetic_profiles")
    op.drop_table("rtnp_secrets")
