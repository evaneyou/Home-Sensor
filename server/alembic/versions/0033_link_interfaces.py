"""Store the Ethernet and Wi-Fi interface names reported with device health."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0033_link_interfaces"
down_revision: Union[str, None] = "0032_drop_video_call"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitor_health", sa.Column("wired_iface", sa.String(length=32), nullable=True))
    op.add_column("monitor_health", sa.Column("wifi_link_iface", sa.String(length=32), nullable=True))
    op.add_column("monitor_health", sa.Column("wifi_radio_iface", sa.String(length=32), nullable=True))


def downgrade() -> None:
    op.drop_column("monitor_health", "wifi_radio_iface")
    op.drop_column("monitor_health", "wifi_link_iface")
    op.drop_column("monitor_health", "wired_iface")
