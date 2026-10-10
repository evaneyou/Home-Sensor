"""Scan interval, nullable survey noise, and per-channel airtime."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0022_rf_channel_stats"
down_revision: Union[str, None] = "0021_ap_inventory"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "monitors",
        sa.Column("scan_interval_seconds", sa.Integer(), nullable=False, server_default="300"),
    )
    op.alter_column("wifi_observations", "noise_dbm", existing_type=sa.Float(), nullable=True)
    op.create_table(
        "rf_channel_stats",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "monitor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("monitors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("measured_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("band", sa.String(length=8), nullable=False),
        sa.Column("channel", sa.Integer(), nullable=False),
        sa.Column("noise_dbm", sa.Float(), nullable=True),
        sa.Column("busy_pct", sa.Float(), nullable=True),
    )
    op.create_index(
        "ix_rf_channel_stats_monitor_measured",
        "rf_channel_stats",
        ["monitor_id", "measured_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_rf_channel_stats_monitor_measured", table_name="rf_channel_stats")
    op.drop_table("rf_channel_stats")
    op.execute("UPDATE wifi_observations SET noise_dbm = -100 WHERE noise_dbm IS NULL")
    op.alter_column("wifi_observations", "noise_dbm", existing_type=sa.Float(), nullable=False)
    op.drop_column("monitors", "scan_interval_seconds")
