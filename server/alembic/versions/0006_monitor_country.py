"""Store a country on each monitor."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0006_monitor_country"
down_revision: Union[str, None] = "0005_monitor_rename"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("country", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("monitors", "country")
