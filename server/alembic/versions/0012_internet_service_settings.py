"""Internet Service path checks, iperf3 schedule, and variance alerts."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012_internet_service_settings"
down_revision: Union[str, None] = "0011_web_service_variance"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "internet_service_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="60"),
        sa.Column("http_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("icmp_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("mtr_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("variance_pct", sa.Integer(), nullable=False, server_default="25"),
        sa.Column("iperf_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("iperf_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
    )
    op.execute(
        sa.text(
            "INSERT INTO internet_service_settings "
            "(id, interval_seconds, http_enabled, icmp_enabled, mtr_enabled, variance_pct, iperf_enabled, iperf_interval_seconds) "
            "VALUES (1, 60, true, true, true, 25, true, 900)"
        )
    )


def downgrade() -> None:
    op.drop_table("internet_service_settings")
