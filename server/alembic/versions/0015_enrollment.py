"""Installer-code enrollment, remote agent identity keys, and an audit log."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import UUID

revision: str = "0015_enrollment"
down_revision: Union[str, None] = "0014_protocol_variance"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.alter_column("monitors", "token_hash", existing_type=sa.String(length=255), nullable=True)
    op.add_column("monitors", sa.Column("identity_public_key", sa.String(length=64), nullable=True))
    op.add_column("monitors", sa.Column("last_handshake_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("uq_monitor_identity_public_key", "monitors", ["identity_public_key"], unique=True)

    op.create_table(
        "installer_codes",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("code_hash", sa.String(length=64), nullable=False, unique=True),
        sa.Column("device_name", sa.String(length=128), nullable=False),
        sa.Column("location_label", sa.String(length=128), nullable=True),
        sa.Column("registered_by", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("monitor_id", UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), nullable=True),
    )
    op.create_table(
        "enrollment_checkins",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "code_id",
            UUID(as_uuid=True),
            sa.ForeignKey("installer_codes.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("identity_public_key", sa.String(length=64), nullable=False),
        sa.Column("wg_public_key", sa.String(length=64), nullable=False),
        sa.Column("hostname", sa.String(length=253), nullable=False),
        sa.Column("lan_ip", sa.String(length=64), nullable=False),
        sa.Column("observed_ip", sa.String(length=64), nullable=True),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.UniqueConstraint("code_id", "identity_public_key", name="uq_checkin_code_identity"),
    )
    op.create_table(
        "audit_events",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("action", sa.String(length=64), nullable=False),
        sa.Column("monitor_id", UUID(as_uuid=True), nullable=True),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
    )


def downgrade() -> None:
    op.drop_table("audit_events")
    op.drop_table("enrollment_checkins")
    op.drop_table("installer_codes")
    op.drop_index("uq_monitor_identity_public_key", table_name="monitors")
    op.drop_column("monitors", "last_handshake_at")
    op.drop_column("monitors", "identity_public_key")
    op.execute("UPDATE monitors SET token_hash = '' WHERE token_hash IS NULL")
    op.alter_column("monitors", "token_hash", existing_type=sa.String(length=255), nullable=False)
