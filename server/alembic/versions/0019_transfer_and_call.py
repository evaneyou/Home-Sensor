"""Separate File Transfer and Video call schedules from Bandwidth."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0019_transfer_and_call"
down_revision: Union[str, None] = "0018_synthetic_tests"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "internet_service_settings",
        sa.Column("librespeed_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("librespeed_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("librespeed_variance_pct", sa.Integer(), nullable=False, server_default="25"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("webrtc_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("webrtc_interval_seconds", sa.Integer(), nullable=False, server_default="900"),
    )
    op.add_column(
        "internet_service_settings",
        sa.Column("webrtc_variance_pct", sa.Integer(), nullable=False, server_default="5"),
    )
    op.execute(
        "UPDATE internet_service_settings SET "
        "librespeed_enabled = iperf_enabled, "
        "librespeed_interval_seconds = iperf_interval_seconds, "
        "librespeed_variance_pct = iperf_variance_pct, "
        "webrtc_enabled = iperf_enabled, "
        "webrtc_interval_seconds = iperf_interval_seconds"
    )


def downgrade() -> None:
    op.drop_column("internet_service_settings", "webrtc_variance_pct")
    op.drop_column("internet_service_settings", "webrtc_interval_seconds")
    op.drop_column("internet_service_settings", "webrtc_enabled")
    op.drop_column("internet_service_settings", "librespeed_variance_pct")
    op.drop_column("internet_service_settings", "librespeed_interval_seconds")
    op.drop_column("internet_service_settings", "librespeed_enabled")
