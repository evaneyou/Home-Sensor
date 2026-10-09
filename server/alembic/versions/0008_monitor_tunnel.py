"""Give each monitor a WireGuard tunnel address."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0008_monitor_tunnel"
down_revision: Union[str, None] = "0007_monitor_region"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("wg_public_key", sa.String(length=64), nullable=True))
    op.add_column("monitors", sa.Column("wg_address", sa.String(length=32), nullable=True))
    op.create_index("uq_monitor_wg_address", "monitors", ["wg_address"], unique=True)


def downgrade() -> None:
    op.drop_index("uq_monitor_wg_address", table_name="monitors")
    op.drop_column("monitors", "wg_address")
    op.drop_column("monitors", "wg_public_key")
