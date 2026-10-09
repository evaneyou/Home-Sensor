"""Queue a restart for a remote probe."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0017_probe_restart"
down_revision: Union[str, None] = "0016_wireless_tunnel"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("restart_requested_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    op.drop_column("monitors", "restart_requested_at")
