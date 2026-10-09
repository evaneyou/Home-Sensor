"""Add MTR and iperf3 test kinds."""

from typing import Sequence, Union

from alembic import op

revision: str = "0003_test_kinds"
down_revision: Union[str, None] = "0002_wifi_observations"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE test_kind ADD VALUE IF NOT EXISTS 'mtr'")
    op.execute("ALTER TYPE test_kind ADD VALUE IF NOT EXISTS 'iperf3'")


def downgrade() -> None:
    pass
