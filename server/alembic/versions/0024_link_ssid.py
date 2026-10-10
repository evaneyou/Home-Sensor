"""SSID joined by the remote agent's link adapter."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0024_link_ssid"
down_revision: Union[str, None] = "0023_kismet_capture"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("link_ssid", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("monitors", "link_ssid")
