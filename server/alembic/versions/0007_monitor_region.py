"""Store a state or province on each monitor."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0007_monitor_region"
down_revision: Union[str, None] = "0006_monitor_country"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitors", sa.Column("region", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("monitors", "region")
