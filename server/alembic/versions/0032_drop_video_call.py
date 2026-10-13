"""Drop the Video call check: its tests, results and settings."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0032_drop_video_call"
down_revision: Union[str, None] = "0031_guest_role"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        "DELETE FROM test_results WHERE test_id IN (SELECT id FROM tests WHERE kind = 'webrtc')"
    )
    op.execute("DELETE FROM tests WHERE kind = 'webrtc'")
    op.drop_column("internet_service_settings", "webrtc_variance_pct")
    op.drop_column("internet_service_settings", "webrtc_enabled")
    op.drop_column("internet_service_settings", "webrtc_interval_seconds")


def downgrade() -> None:
    # The settings come back with their defaults; the measurements do not come back.
    op.add_column(
        "internet_service_settings",
        sa.Column("webrtc_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("webrtc_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("webrtc_variance_pct", sa.Integer(), nullable=False, server_default="5"),
    )
