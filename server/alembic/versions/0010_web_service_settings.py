"""Web service polling, which checks run, and amber thresholds."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0010_web_service_settings"
down_revision: Union[str, None] = "0009_monitor_public_ip"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SERVICES = [
    ("youtube", "YouTube", "https://www.youtube.com/generate_204", "www.youtube.com", 0),
    ("google", "Google", "https://www.google.com/generate_204", "www.google.com", 1),
    ("microsoft", "Microsoft", "http://www.msftconnecttest.com/connecttest.txt", "www.msftconnecttest.com", 2),
    ("hulu", "Hulu", "https://www.hulu.com", "www.hulu.com", 3),
    ("zoom", "Zoom", "https://zoom.us", "zoom.us", 4),
    ("netflix", "Netflix", "https://www.netflix.com", "www.netflix.com", 5),
    ("teams", "Microsoft Teams", "https://teams.microsoft.com", "teams.microsoft.com", 6),
    ("facebook", "Facebook", "https://www.facebook.com", "www.facebook.com", 7),
]


def upgrade() -> None:
    op.create_table(
        "web_service_settings",
        sa.Column("key", sa.String(length=32), primary_key=True),
        sa.Column("label", sa.String(length=64), nullable=False),
        sa.Column("http_url", sa.String(length=255), nullable=False),
        sa.Column("host", sa.String(length=255), nullable=False),
        sa.Column("position", sa.Integer(), nullable=False),
        sa.Column("interval_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("http_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("icmp_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("mtr_enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("http_threshold_ms", sa.Integer(), nullable=False, server_default="3000"),
        sa.Column("icmp_threshold_ms", sa.Integer(), nullable=False, server_default="150"),
        sa.Column("mtr_threshold_ms", sa.Integer(), nullable=False, server_default="150"),
    )
    table = sa.table(
        "web_service_settings",
        sa.column("key", sa.String),
        sa.column("label", sa.String),
        sa.column("http_url", sa.String),
        sa.column("host", sa.String),
        sa.column("position", sa.Integer),
        sa.column("interval_seconds", sa.Integer),
        sa.column("http_enabled", sa.Boolean),
        sa.column("icmp_enabled", sa.Boolean),
        sa.column("mtr_enabled", sa.Boolean),
        sa.column("http_threshold_ms", sa.Integer),
        sa.column("icmp_threshold_ms", sa.Integer),
        sa.column("mtr_threshold_ms", sa.Integer),
    )
    op.bulk_insert(
        table,
        [
            {
                "key": key,
                "label": label,
                "http_url": url,
                "host": host,
                "position": position,
                "interval_seconds": 300,
                "http_enabled": True,
                "icmp_enabled": True,
                "mtr_enabled": True,
                "http_threshold_ms": 3000,
                "icmp_threshold_ms": 150,
                "mtr_threshold_ms": 150,
            }
            for key, label, url, host, position in _SERVICES
        ],
    )


def downgrade() -> None:
    op.drop_table("web_service_settings")
