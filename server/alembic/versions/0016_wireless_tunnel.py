"""A second WireGuard tunnel per remote agent, pinned to Wi-Fi."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0016_wireless_tunnel"
down_revision: Union[str, None] = "0015_enrollment"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("wg_wireless_public_key", sa.String(length=64), nullable=True))
    op.add_column("monitors", sa.Column("wg_wireless_address", sa.String(length=32), nullable=True))
    op.add_column("monitors", sa.Column("last_wireless_handshake_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("uq_monitor_wg_wireless_address", "monitors", ["wg_wireless_address"], unique=True)
    op.add_column("enrollment_checkins", sa.Column("wg_wireless_public_key", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("enrollment_checkins", "wg_wireless_public_key")
    op.drop_index("uq_monitor_wg_wireless_address", table_name="monitors")
    op.drop_column("monitors", "last_wireless_handshake_at")
    op.drop_column("monitors", "wg_wireless_address")
    op.drop_column("monitors", "wg_wireless_public_key")
