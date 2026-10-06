"""Initial schema for groups, sensors, networks, tests, results, users, issues."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    user_role = postgresql.ENUM("admin", "viewer", name="user_role", create_type=False)
    sensor_status = postgresql.ENUM("online", "offline", "unknown", name="sensor_status", create_type=False)
    network_kind = postgresql.ENUM("wired", "wifi", name="network_kind", create_type=False)
    test_kind = postgresql.ENUM("http", "dns", "ping", "wifi", name="test_kind", create_type=False)
    result_status = postgresql.ENUM("ok", "degraded", "fail", name="result_status", create_type=False)
    issue_severity = postgresql.ENUM("info", "warning", "critical", name="issue_severity", create_type=False)
    issue_status = postgresql.ENUM("open", "resolved", name="issue_status", create_type=False)

    bind = op.get_bind()
    for enum in (
        user_role,
        sensor_status,
        network_kind,
        test_kind,
        result_status,
        issue_severity,
        issue_status,
    ):
        enum.create(bind, checkfirst=True)

    op.create_table(
        "groups",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("slug", sa.String(64), nullable=False, unique=True),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "users",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(64), nullable=False, unique=True),
        sa.Column("password_hash", sa.String(255), nullable=False),
        sa.Column("role", user_role, nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_table(
        "sensors",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("token_hash", sa.String(255), nullable=False),
        sa.Column("status", sensor_status, nullable=False),
        sa.Column("last_seen_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("group_id", "slug", name="uq_sensor_group_slug"),
    )
    op.create_table(
        "networks",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("kind", network_kind, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("group_id", "slug", name="uq_network_group_slug"),
    )
    op.create_table(
        "tests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("sensor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sensors.id", ondelete="CASCADE"), nullable=False),
        sa.Column("network_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("networks.id", ondelete="CASCADE"), nullable=False),
        sa.Column("slug", sa.String(64), nullable=False),
        sa.Column("name", sa.String(128), nullable=False),
        sa.Column("kind", test_kind, nullable=False),
        sa.Column("target", sa.String(255), nullable=False),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("sensor_id", "network_id", "slug", name="uq_test_sensor_network_slug"),
    )
    op.create_table(
        "test_results",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("external_id", sa.String(64), nullable=False),
        sa.Column("test_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tests.id", ondelete="CASCADE"), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("status", result_status, nullable=False),
        sa.Column("stages", postgresql.JSONB(), nullable=False),
        sa.Column("metrics", postgresql.JSONB(), nullable=False),
        sa.Column("message", sa.Text()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("external_id", name="uq_test_result_external_id"),
    )
    op.create_index("ix_test_results_test_started", "test_results", ["test_id", "started_at"])
    op.create_table(
        "issues",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("group_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("groups.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sensor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("sensors.id", ondelete="SET NULL")),
        sa.Column("network_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("networks.id", ondelete="SET NULL")),
        sa.Column("test_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("tests.id", ondelete="SET NULL")),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("severity", issue_severity, nullable=False),
        sa.Column("status", issue_status, nullable=False),
        sa.Column("root_cause_stage", sa.String(64)),
        sa.Column("opened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("resolved_at", sa.DateTime(timezone=True)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )


def downgrade() -> None:
    op.drop_table("issues")
    op.drop_index("ix_test_results_test_started", table_name="test_results")
    op.drop_table("test_results")
    op.drop_table("tests")
    op.drop_table("networks")
    op.drop_table("sensors")
    op.drop_table("users")
    op.drop_table("groups")
    bind = op.get_bind()
    for name in (
        "issue_status",
        "issue_severity",
        "result_status",
        "test_kind",
        "network_kind",
        "sensor_status",
        "user_role",
    ):
        postgresql.ENUM(name=name).drop(bind, checkfirst=True)
