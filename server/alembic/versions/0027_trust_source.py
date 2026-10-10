"""Who marked an access point trusted, the associated BSSID, and a nullable client signal."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0027_trust_source"
down_revision: Union[str, None] = "0026_client_detail"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("ap_inventory", sa.Column("trust_source", sa.String(length=8), nullable=True))
    op.execute("UPDATE ap_inventory SET trust_source = 'auto' WHERE trusted IS TRUE")
    op.add_column("monitors", sa.Column("link_bssid", sa.String(length=17), nullable=True))
    op.alter_column("rf_clients", "signal", existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    op.execute("UPDATE rf_clients SET signal = 0 WHERE signal IS NULL")
    op.alter_column("rf_clients", "signal", existing_type=sa.Float(), nullable=False)
    op.drop_column("monitors", "link_bssid")
    op.drop_column("ap_inventory", "trust_source")
