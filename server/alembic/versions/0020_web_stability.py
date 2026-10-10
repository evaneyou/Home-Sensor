"""Global web-service stability settings and a stable status on each test."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0020_web_stability"
down_revision: Union[str, None] = "0019_transfer_and_call"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_STATUS = postgresql.ENUM("ok", "degraded", "fail", name="result_status", create_type=False)


def upgrade() -> None:
    op.add_column(
        "tests",
        sa.Column("stable_status", _STATUS, nullable=False, server_default="ok"),
    )
    op.add_column("tests", sa.Column("state_since", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        """
        UPDATE tests AS t
        SET stable_status = latest.status,
            state_since = latest.started_at
        FROM (
            SELECT DISTINCT ON (test_id) test_id, status, started_at
            FROM test_results
            ORDER BY test_id, started_at DESC
        ) AS latest
        WHERE t.id = latest.test_id
        """
    )
    op.create_table(
        "web_stability_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("poll_interval_seconds", sa.Integer(), nullable=False, server_default="300"),
        sa.Column("window_size", sa.Integer(), nullable=False, server_default="5"),
        sa.Column("degraded_count", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("fail_count", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("recover_count", sa.Integer(), nullable=False, server_default="3"),
        sa.Column("pct_floor", sa.Integer(), nullable=False, server_default="50"),
        sa.Column("abs_floor_http_ms", sa.Integer(), nullable=False, server_default="40"),
        sa.Column("abs_floor_icmp_ms", sa.Integer(), nullable=False, server_default="20"),
        sa.Column("abs_floor_jitter_ms", sa.Integer(), nullable=False, server_default="15"),
        sa.Column("quorum_degraded_pct", sa.Integer(), nullable=False, server_default="25"),
        sa.Column("quorum_fail_pct", sa.Integer(), nullable=False, server_default="40"),
    )
    op.execute(
        "INSERT INTO web_stability_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING"
    )


def downgrade() -> None:
    op.drop_table("web_stability_settings")
    op.drop_column("tests", "state_since")
    op.drop_column("tests", "stable_status")
