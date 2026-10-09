"""Per-protocol variance, plus a web-service jitter check."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0014_protocol_variance"
down_revision: Union[str, None] = "0013_result_status_reason"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "web_service_settings",
        sa.Column("jitter_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "web_service_settings",
        sa.Column("http_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "web_service_settings",
        sa.Column("icmp_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "web_service_settings",
        sa.Column("jitter_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.execute(
        "UPDATE web_service_settings SET "
        "http_variance_pct = variance_pct, "
        "icmp_variance_pct = variance_pct, "
        "jitter_variance_pct = variance_pct"
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("http_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("icmp_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("mtr_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("iperf_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.execute(
        "UPDATE internet_service_settings SET "
        "http_variance_pct = variance_pct, "
        "icmp_variance_pct = variance_pct, "
        "mtr_variance_pct = variance_pct, "
        "iperf_variance_pct = variance_pct"
    )


def downgrade() -> None:
    op.drop_column("internet_service_settings", "iperf_variance_pct")
    op.drop_column("internet_service_settings", "mtr_variance_pct")
    op.drop_column("internet_service_settings", "icmp_variance_pct")
    op.drop_column("internet_service_settings", "http_variance_pct")
    op.drop_column("web_service_settings", "jitter_variance_pct")
    op.drop_column("web_service_settings", "icmp_variance_pct")
    op.drop_column("web_service_settings", "http_variance_pct")
    op.drop_column("web_service_settings", "jitter_enabled")
