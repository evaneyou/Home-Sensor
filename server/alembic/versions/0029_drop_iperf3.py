"""Remove iperf3 checks, results, and schedule columns."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0029_drop_iperf3"
down_revision: Union[str, None] = "0028_health_last_error"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KEEP = "'http', 'dns', 'ping', 'wifi', 'mtr', 'librespeed', 'webrtc'"


def upgrade() -> None:
    op.execute(
        """
        DELETE FROM issues
        WHERE test_id IN (
            SELECT id FROM tests WHERE kind::text = 'iperf3' OR slug = 'iperf3'
        )
        """
    )
    op.execute("DELETE FROM tests WHERE kind::text = 'iperf3' OR slug = 'iperf3'")
    op.drop_column("internet_service_settings", "iperf_variance_pct")
    op.drop_column("internet_service_settings", "iperf_enabled")
    op.drop_column("internet_service_settings", "iperf_interval_seconds")
    op.execute("ALTER TYPE test_kind RENAME TO test_kind_old")
    op.execute(f"CREATE TYPE test_kind AS ENUM ({_KEEP})")
    op.execute("ALTER TABLE tests ALTER COLUMN kind TYPE test_kind USING kind::text::test_kind")
    op.execute("DROP TYPE test_kind_old")


def downgrade() -> None:
    op.execute("ALTER TYPE test_kind ADD VALUE IF NOT EXISTS 'iperf3'")
    op.add_column(
        "internet_service_settings",
        sa.Column("iperf_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("iperf_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("iperf_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
