"""Trusted access-point inventory and a queued Wi-Fi scan."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0021_ap_inventory"
down_revision: Union[str, None] = "0020_web_stability"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("scan_requested_at", sa.DateTime(timezone=True), nullable=True))
    op.create_table(
        "ap_inventory",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("bssid", sa.String(length=17), nullable=False),
        sa.Column("trusted", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("label", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("first_seen", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("monitor_id", "bssid", name="uq_ap_inventory_monitor_bssid"),
    )


def downgrade() -> None:
    op.drop_table("ap_inventory")
    op.drop_column("monitors", "scan_requested_at")
