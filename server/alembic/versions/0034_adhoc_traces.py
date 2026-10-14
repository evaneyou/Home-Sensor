"""On-demand traces to a host typed into Path View."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0034_adhoc_traces"
down_revision: Union[str, None] = "0033_link_interfaces"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "adhoc_traces",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("link", sa.String(length=16), nullable=False),
        sa.Column("target", sa.String(length=255), nullable=False),
        sa.Column("state", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("requested_by", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("requested_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("hops", postgresql.JSONB(), nullable=True),
        sa.Column("error", sa.Text(), nullable=False, server_default=""),
    )
    op.create_index("ix_adhoc_traces_monitor_id", "adhoc_traces", ["monitor_id"])


def downgrade() -> None:
    op.drop_index("ix_adhoc_traces_monitor_id", table_name="adhoc_traces")
    op.drop_table("adhoc_traces")
