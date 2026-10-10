"""Manufacturer name reported for a Wi-Fi client."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0025_client_vendor"
down_revision: Union[str, None] = "0024_link_ssid"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rf_clients", sa.Column("vendor", sa.String(length=64), nullable=False, server_default=""))


def downgrade() -> None:
    op.drop_column("rf_clients", "vendor")
