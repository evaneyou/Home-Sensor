"""Store why each result was marked green, amber, or red."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0013_result_status_reason"
down_revision: Union[str, None] = "0012_internet_service_settings"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("test_results", sa.Column("status_reason", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("test_results", "status_reason")
