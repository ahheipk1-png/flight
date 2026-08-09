"""initial schema -- travel_regions, metro_areas, airports,
airport_equivalence, fare_observations, api_call_log

Revision ID: 0001
Revises:
Create Date: 2026-08-09
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        # PostGIS is not used by any column type in MVP 1 -- enabled now so a
        # later GET /api/airports/nearby (radius query) is additive, not a
        # schema rework.
        op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "travel_regions",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
    )
    op.create_index("ix_travel_regions_code", "travel_regions", ["code"], unique=True)

    op.create_table(
        "metro_areas",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("code", sa.String(40), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
    )
    op.create_index("ix_metro_areas_code", "metro_areas", ["code"], unique=True)

    op.create_table(
        "airports",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("iata", sa.String(3), nullable=False),
        sa.Column("icao", sa.String(4), nullable=True),
        sa.Column("name", sa.String(160), nullable=False),
        sa.Column("city", sa.String(120), nullable=False),
        sa.Column("country", sa.String(2), nullable=False),
        sa.Column("lat", sa.Float, nullable=False),
        sa.Column("lon", sa.Float, nullable=False),
        sa.Column("tz", sa.String(60), nullable=False),
        sa.Column("metro_area_id", sa.Integer, sa.ForeignKey("metro_areas.id"), nullable=False),
        sa.Column("travel_region_id", sa.Integer, sa.ForeignKey("travel_regions.id"), nullable=False),
        sa.Column("is_metro_primary", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_origin_candidate", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_origin_default", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("active", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    op.create_index("ix_airports_iata", "airports", ["iata"], unique=True)

    op.create_table(
        "airport_equivalence",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("airport_a_id", sa.Integer, sa.ForeignKey("airports.id"), nullable=False),
        sa.Column("airport_b_id", sa.Integer, sa.ForeignKey("airports.id"), nullable=False),
        sa.Column("ground_time_minutes", sa.Integer, nullable=False),
        sa.Column("ground_cost_estimate", sa.Float, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="CAD"),
        sa.Column("same_metro", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("same_travel_region", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("airport_a_id", "airport_b_id", name="uq_airport_equivalence_pair"),
    )

    op.create_table(
        "fare_observations",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("origin", sa.String(3), nullable=False),
        sa.Column("destination", sa.String(3), nullable=False),
        sa.Column("departure_date", sa.Date, nullable=False),
        sa.Column("return_date", sa.Date, nullable=False),
        sa.Column("trip_length", sa.Integer, nullable=False),
        sa.Column("cabin", sa.String(20), nullable=False, server_default="economy"),
        sa.Column("fare", sa.Float, nullable=False),
        sa.Column("currency", sa.String(3), nullable=False, server_default="CAD"),
        sa.Column("seller_id", sa.String(120), nullable=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("kind", sa.String(20), nullable=False),
        sa.Column("observed_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("extra", sa.JSON, nullable=True),
    )
    op.create_index("ix_fare_observations_origin", "fare_observations", ["origin"])
    op.create_index("ix_fare_observations_destination", "fare_observations", ["destination"])
    op.create_index(
        "ix_fare_obs_route_dates", "fare_observations", ["origin", "destination", "departure_date", "return_date"]
    )
    op.create_index("ix_fare_obs_route_recency", "fare_observations", ["origin", "destination", "observed_at"])

    op.create_table(
        "api_call_log",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("provider", sa.String(20), nullable=False),
        sa.Column("params_hash", sa.String(64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )


def downgrade() -> None:
    op.drop_table("api_call_log")
    op.drop_table("fare_observations")
    op.drop_table("airport_equivalence")
    op.drop_index("ix_airports_iata", table_name="airports")
    op.drop_table("airports")
    op.drop_index("ix_metro_areas_code", table_name="metro_areas")
    op.drop_table("metro_areas")
    op.drop_index("ix_travel_regions_code", table_name="travel_regions")
    op.drop_table("travel_regions")
