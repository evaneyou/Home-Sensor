"""Store the public address and service provider reported by each agent."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0009_monitor_public_ip"
down_revision: Union[str, None] = "0008_monitor_tunnel"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("public_ip", sa.String(length=64), nullable=True))
    op.add_column("monitors", sa.Column("isp", sa.String(length=128), nullable=True))
    op.add_column("monitor_health", sa.Column("public_ip", sa.String(length=64), nullable=True))
    op.add_column("monitor_health", sa.Column("isp", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("monitor_health", "isp")
    op.drop_column("monitor_health", "public_ip")
    op.drop_column("monitors", "isp")
    op.drop_column("monitors", "public_ip")
