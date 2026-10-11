"""Store the remote agent's last capture error on each health report."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0028_health_last_error"
down_revision: Union[str, None] = "0027_trust_source"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("monitor_health", sa.Column("last_error", sa.String(length=600), nullable=True))


def downgrade() -> None:
    op.drop_column("monitor_health", "last_error")
