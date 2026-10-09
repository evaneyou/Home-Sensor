"""Store a configurable location on each sensor."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0004_sensor_location"
down_revision: Union[str, None] = "0003_test_kinds"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("sensors", sa.Column("latitude", sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("longitude", sa.Float(), nullable=True))
    op.add_column("sensors", sa.Column("location_label", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("sensors", "location_label")
    op.drop_column("sensors", "longitude")
    op.drop_column("sensors", "latitude")
