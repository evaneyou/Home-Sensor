"""Kismet clients, alerts, and channel airtime."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0023_kismet_capture"
down_revision: Union[str, None] = "0022_rf_channel_stats"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "wifi_observations",
        sa.Column("client_count", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column("monitor_health", sa.Column("airwave_mode", sa.String(length=16), nullable=True))
    op.add_column("rf_channel_stats", sa.Column("airtime_pct", sa.Float(), nullable=True))
    op.add_column("rf_channel_stats", sa.Column("packets", sa.Integer(), nullable=True))
    op.create_table(
        "rf_clients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "monitor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("monitors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dedupe_key", sa.String(length=128), nullable=False),
        sa.Column("mac", sa.String(length=17), nullable=False),
        sa.Column("bssid", sa.String(length=17), nullable=False),
        sa.Column("signal", sa.Float(), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("randomized", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("monitor_id", "observed_at", "dedupe_key", name="uq_rf_clients_capture"),
    )
    op.create_index("ix_rf_clients_monitor_observed", "rf_clients", ["monitor_id", "observed_at"])
    op.create_table(
        "rf_alerts",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "monitor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("monitors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("dedupe_key", sa.String(length=128), nullable=False),
        sa.Column("alert_type", sa.String(length=64), nullable=False),
        sa.Column("bssid", sa.String(length=17), nullable=False, server_default=""),
        sa.Column("text", sa.Text(), nullable=False, server_default=""),
        sa.UniqueConstraint("monitor_id", "observed_at", "dedupe_key", name="uq_rf_alerts_capture"),
    )
    op.create_index("ix_rf_alerts_monitor_observed", "rf_alerts", ["monitor_id", "observed_at"])


def downgrade() -> None:
    op.drop_index("ix_rf_alerts_monitor_observed", table_name="rf_alerts")
    op.drop_table("rf_alerts")
    op.drop_index("ix_rf_clients_monitor_observed", table_name="rf_clients")
    op.drop_table("rf_clients")
    op.drop_column("rf_channel_stats", "packets")
    op.drop_column("rf_channel_stats", "airtime_pct")
    op.drop_column("monitor_health", "airwave_mode")
    op.drop_column("wifi_observations", "client_count")
