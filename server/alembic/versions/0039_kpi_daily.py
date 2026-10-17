"""A permanent daily KPI record, and the minutes offline kept on each hour."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0039_kpi_daily"
down_revision: Union[str, None] = "0038_kpi_hourly"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COUNTS = (
    "n", "failed", "degraded", "incidents", "loss_n", "rtt_n", "jitter_n", "down_n", "up_n",
)
_SUMS = ("loss_sum", "rtt_sum", "jitter_sum", "down_sum", "up_sum")


def upgrade() -> None:
    op.add_column("kpi_hourly", sa.Column("outage_min", sa.Float(), nullable=False, server_default="0"))
    op.execute("UPDATE kpi_hourly SET outage_min = CASE WHEN kind = 'internet' AND n > 0 THEN failed * 60.0 / n ELSE 0 END")
    columns = [
        sa.Column("day", sa.Date(), primary_key=True),
        sa.Column("monitor_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("monitors.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("link", sa.String(length=16), primary_key=True),
        sa.Column("kind", sa.String(length=16), primary_key=True),
    ]
    columns += [sa.Column(name, sa.Integer(), nullable=False, server_default="0") for name in _COUNTS]
    columns += [sa.Column(name, sa.Float(), nullable=False, server_default="0") for name in _SUMS]
    columns += [sa.Column("loss_max", sa.Float(), nullable=True), sa.Column("outage_min", sa.Float(), nullable=False, server_default="0")]
    op.create_table("kpi_daily", *columns)
    op.create_index("ix_kpi_daily_monitor_day", "kpi_daily", ["monitor_id", "day"])
    # The days already stored hour by hour become daily rows now.
    sums = ", ".join(f"SUM({name})" for name in (*_COUNTS, *_SUMS))
    names = ", ".join((*_COUNTS, *_SUMS))
    op.execute(
        f"INSERT INTO kpi_daily (day, monitor_id, link, kind, {names}, loss_max, outage_min) "
        f"SELECT (bucket_start AT TIME ZONE 'UTC')::date, monitor_id, link, kind, {sums}, MAX(loss_max), SUM(outage_min) "
        f"FROM kpi_hourly GROUP BY 1, monitor_id, link, kind"
    )


def downgrade() -> None:
    op.drop_index("ix_kpi_daily_monitor_day", table_name="kpi_daily")
    op.drop_table("kpi_daily")
    op.drop_column("kpi_hourly", "outage_min")
