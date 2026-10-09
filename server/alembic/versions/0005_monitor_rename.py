"""Rename sensors to monitors and store device health."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0005_monitor_rename"
down_revision: Union[str, None] = "0004_sensor_location"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("ALTER TYPE sensor_status RENAME TO monitor_status")
    op.rename_table("sensors", "monitors")
    op.alter_column("tests", "sensor_id", new_column_name="monitor_id")
    op.alter_column("issues", "sensor_id", new_column_name="monitor_id")
    op.alter_column("wifi_observations", "sensor_id", new_column_name="monitor_id")
    op.execute("ALTER TABLE monitors RENAME CONSTRAINT uq_sensor_group_slug TO uq_monitor_group_slug")
    op.execute("ALTER TABLE tests RENAME CONSTRAINT uq_test_sensor_network_slug TO uq_test_monitor_network_slug")
    op.execute("ALTER TABLE tests RENAME CONSTRAINT tests_sensor_id_fkey TO tests_monitor_id_fkey")
    op.execute("ALTER TABLE issues RENAME CONSTRAINT issues_sensor_id_fkey TO issues_monitor_id_fkey")
    op.execute(
        "ALTER TABLE wifi_observations RENAME CONSTRAINT wifi_observations_sensor_id_fkey TO wifi_observations_monitor_id_fkey"
    )
    op.execute(
        "ALTER INDEX ix_wifi_observations_sensor_scanned RENAME TO ix_wifi_observations_monitor_scanned"
    )
    op.add_column("monitors", sa.Column("lan_ip", sa.String(64), nullable=True))
    op.add_column("monitors", sa.Column("agent_version", sa.String(32), nullable=True))
    op.add_column(
        "monitors",
        sa.Column("config_version", sa.Integer(), nullable=False, server_default="1"),
    )
    op.add_column(
        "monitors",
        sa.Column("applied_config_version", sa.Integer(), nullable=False, server_default="0"),
    )
    op.add_column(
        "monitors",
        sa.Column("health_interval_seconds", sa.Integer(), nullable=False, server_default="60"),
    )
    op.create_table(
        "monitor_health",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "monitor_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("monitors.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("reported_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("hostname", sa.String(128), nullable=False),
        sa.Column("uptime_seconds", sa.Integer(), nullable=False),
        sa.Column("cpu_percent", sa.Float(), nullable=False),
        sa.Column("load_1", sa.Float(), nullable=False),
        sa.Column("mem_used_mb", sa.Integer(), nullable=False),
        sa.Column("mem_total_mb", sa.Integer(), nullable=False),
        sa.Column("disk_used_mb", sa.Integer(), nullable=False),
        sa.Column("disk_total_mb", sa.Integer(), nullable=False),
        sa.Column("temp_c", sa.Float(), nullable=True),
        sa.Column("lan_ip", sa.String(64), nullable=True),
        sa.Column("config_version", sa.Integer(), nullable=False),
    )
    op.create_index(
        "ix_monitor_health_monitor_reported",
        "monitor_health",
        ["monitor_id", "reported_at"],
    )


def downgrade() -> None:
    op.drop_index("ix_monitor_health_monitor_reported", table_name="monitor_health")
    op.drop_table("monitor_health")
    op.drop_column("monitors", "health_interval_seconds")
    op.drop_column("monitors", "applied_config_version")
    op.drop_column("monitors", "config_version")
    op.drop_column("monitors", "agent_version")
    op.drop_column("monitors", "lan_ip")
    op.execute(
        "ALTER INDEX ix_wifi_observations_monitor_scanned RENAME TO ix_wifi_observations_sensor_scanned"
    )
    op.execute(
        "ALTER TABLE wifi_observations RENAME CONSTRAINT wifi_observations_monitor_id_fkey TO wifi_observations_sensor_id_fkey"
    )
    op.execute("ALTER TABLE issues RENAME CONSTRAINT issues_monitor_id_fkey TO issues_sensor_id_fkey")
    op.execute("ALTER TABLE tests RENAME CONSTRAINT tests_monitor_id_fkey TO tests_sensor_id_fkey")
    op.execute("ALTER TABLE tests RENAME CONSTRAINT uq_test_monitor_network_slug TO uq_test_sensor_network_slug")
    op.execute("ALTER TABLE monitors RENAME CONSTRAINT uq_monitor_group_slug TO uq_sensor_group_slug")
    op.alter_column("wifi_observations", "monitor_id", new_column_name="sensor_id")
    op.alter_column("issues", "monitor_id", new_column_name="sensor_id")
    op.alter_column("tests", "monitor_id", new_column_name="sensor_id")
    op.rename_table("monitors", "sensors")
    op.execute("ALTER TYPE monitor_status RENAME TO sensor_status")
