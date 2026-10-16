"""Guest visits get their own table, kept for a year, without the Pi's own address."""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0036_guest_visits"
down_revision: Union[str, None] = "0035_stress_runs"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "guest_visits",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("visited_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("address", sa.String(length=64), nullable=False),
        sa.Column("country", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("country_code", sa.String(length=8), nullable=False, server_default=""),
        sa.Column("region", sa.String(length=128), nullable=False, server_default=""),
        sa.Column("city", sa.String(length=128), nullable=False, server_default=""),
    )
    op.create_index("ix_guest_visits_visited_at", "guest_visits", ["visited_at"])
    op.create_index("ix_guest_visits_country_visited", "guest_visits", ["country_code", "visited_at"])

    # Copy the sign-ins already on record, minus any from an address a Pi reports as its own.
    bind = op.get_bind()
    own = {
        row[0]
        for row in bind.execute(sa.text("SELECT DISTINCT public_ip FROM monitors WHERE public_ip IS NOT NULL AND public_ip <> ''"))
    }
    try:  # best effort: without the map file the places stay empty
        from app import geoip

        lookup = geoip.lookup
    except Exception:  # pragma: no cover
        lookup = lambda _address: None  # noqa: E731
    rows = bind.execute(
        sa.text("SELECT created_at, detail FROM audit_events WHERE action = 'guest_login' ORDER BY created_at")
    ).all()
    visits = sa.table(
        "guest_visits",
        sa.column("id", postgresql.UUID(as_uuid=True)),
        sa.column("visited_at", sa.DateTime(timezone=True)),
        sa.column("address", sa.String),
        sa.column("country", sa.String),
        sa.column("country_code", sa.String),
        sa.column("region", sa.String),
        sa.column("city", sa.String),
    )
    import uuid

    batch = []
    for created_at, address in rows:
        if address in own:
            continue
        place = lookup(address) or {}
        batch.append(
            {
                "id": uuid.uuid4(),
                "visited_at": created_at,
                "address": address,
                "country": place.get("country", ""),
                "country_code": place.get("country_code", ""),
                "region": place.get("region", ""),
                "city": place.get("city", ""),
            }
        )
    if batch:
        op.bulk_insert(visits, batch)


def downgrade() -> None:
    op.drop_index("ix_guest_visits_country_visited", table_name="guest_visits")
    op.drop_index("ix_guest_visits_visited_at", table_name="guest_visits")
    op.drop_table("guest_visits")
