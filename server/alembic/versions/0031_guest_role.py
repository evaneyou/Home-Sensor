"""Add the guest role."""

from typing import Sequence, Union

from alembic import op

revision: str = "0031_guest_role"
down_revision: Union[str, None] = "0030_synthetic_traffic"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'guest'")


def downgrade() -> None:
    # Postgres cannot drop a single enum label without recreating the type.
    pass
