"""Nearby Wi-Fi scan observations."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_wifi_observations"
down_revision: Union[str, None] = "0001_initial"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "wifi_observations",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "sensor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("sensors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("scanned_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ssid", sa.String(64), nullable=False),
        sa.Column("bssid", sa.String(17), nullable=False),
        sa.Column("vendor", sa.String(64), nullable=False),
        sa.Column("band", sa.String(8), nullable=False),
        sa.Column("channel", sa.Integer(), nullable=False),
        sa.Column("channel_width", sa.Integer(), nullable=False),
        sa.Column("rssi_dbm", sa.Float(), nullable=False),
        sa.Column("noise_dbm", sa.Float(), nullable=False),
        sa.Column("security", sa.String(32), nullable=False),
        sa.Column("phy", sa.String(8), nullable=False),
        sa.Column("max_link_rate_mbps", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_wifi_observations_sensor_scanned",
        "wifi_observations",
        ["sensor_id", "scanned_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_wifi_observations_sensor_scanned", table_name="wifi_observations")
    op.drop_table("wifi_observations")
