"""Telegram settings and the alert events they announce."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0037_telegram_alerts"
down_revision: Union[str, None] = "0036_guest_visits"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "telegram_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default="false"),
        sa.Column("bot_token_enc", sa.Text(), nullable=False, server_default=""),
        sa.Column("token_hint", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("bot_username", sa.String(length=64), nullable=False, server_default=""),
        sa.Column("chat_id", sa.String(length=32), nullable=False, server_default=""),
        sa.Column("notify_network", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_pi", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_server", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_app", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("notify_recovery", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("last_ok_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.String(length=300), nullable=False, server_default=""),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "alert_events",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("key", sa.String(length=160), nullable=False),
        sa.Column("category", sa.String(length=16), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("detail", sa.Text(), nullable=False, server_default=""),
        sa.Column("status", sa.String(length=16), nullable=False, server_default="pending"),
        sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("resolved_notified_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"),
    )
    op.create_index("ix_alert_events_status", "alert_events", ["status", "first_seen_at"])
    op.create_index(
        "uq_alert_events_active_key",
        "alert_events",
        ["key"],
        unique=True,
        postgresql_where=sa.text("status in ('pending','open')"),
    )


def downgrade() -> None:
    op.drop_index("uq_alert_events_active_key", table_name="alert_events")
    op.drop_index("ix_alert_events_status", table_name="alert_events")
    op.drop_table("alert_events")
    op.drop_table("telegram_settings")
