"""trip_type -- disambiguates one-way sentinel rows (return_date ==
departure_date) from genuine same-day round trips in fare_observations,
so services/indicative.py's tiered lookup never lets one trip type's
price history answer the other's query.

Revision ID: 0003
Revises: 0002
Create Date: 2026-08-11
"""

from __future__ import annotations

import sqlalchemy as sa

from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "fare_observations",
        sa.Column("trip_type", sa.String(20), nullable=False, server_default="round_trip"),
    )


def downgrade() -> None:
    op.drop_column("fare_observations", "trip_type")
