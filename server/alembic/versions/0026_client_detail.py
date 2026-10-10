"""Channel, traffic, and probed names for each Wi-Fi client."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0026_client_detail"
down_revision: Union[str, None] = "0025_client_vendor"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("rf_clients", sa.Column("signal_min", sa.Float(), nullable=True))
    op.add_column("rf_clients", sa.Column("signal_max", sa.Float(), nullable=True))
    op.add_column("rf_clients", sa.Column("first_seen", sa.DateTime(timezone=True), nullable=True))
    op.add_column("rf_clients", sa.Column("band", sa.String(length=8), nullable=False, server_default=""))
    op.add_column("rf_clients", sa.Column("channel", sa.Integer(), nullable=True))
    op.add_column("rf_clients", sa.Column("packets", sa.Integer(), nullable=True))
    op.add_column("rf_clients", sa.Column("data_bytes", sa.Integer(), nullable=True))
    op.add_column("rf_clients", sa.Column("retries", sa.Integer(), nullable=True))
    op.add_column("rf_clients", sa.Column("disconnects", sa.Integer(), nullable=True))
    op.add_column("rf_clients", sa.Column("probed_ssids", sa.Text(), nullable=False, server_default="[]"))


def downgrade() -> None:
    for name in (
        "probed_ssids",
        "disconnects",
        "retries",
        "data_bytes",
        "packets",
        "channel",
        "band",
        "first_seen",
        "signal_max",
        "signal_min",
    ):
        op.drop_column("rf_clients", name)
