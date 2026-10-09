"""Replace fixed amber times with a percentage variance."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0011_web_service_variance"
down_revision: Union[str, None] = "0010_web_service_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "web_service_settings",
        sa.Column("variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.drop_column("web_service_settings", "http_threshold_ms")
    op.drop_column("web_service_settings", "icmp_threshold_ms")
    op.drop_column("web_service_settings", "mtr_threshold_ms")


def downgrade() -> None:
    op.add_column(
        "web_service_settings",
        sa.Column("http_threshold_ms", sa.Integer(), nullable=False, server_default="3000"),
    )
    op.add_column(
        "web_service_settings",
        sa.Column("icmp_threshold_ms", sa.Integer(), nullable=False, server_default="150"),
    )
    op.add_column(
        "web_service_settings",
        sa.Column("mtr_threshold_ms", sa.Integer(), nullable=False, server_default="150"),
    )
    op.drop_column("web_service_settings", "variance_pct")
