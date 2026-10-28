from services.clock import today
"""
Smart Auto-Matching Service for Crowdshipping Marketplace.
Detects matching routes between Travelers and Senders and triggers instant push notifications.
"""

from typing import List
from sqlalchemy import select, and_

from database.db import get_db_session
from database.models import (
    TravelTrip,
    ParcelRequest,
    User,
    TripStatus,
    ParcelStatus
)



def normalize_city(city: str) -> str:
    """Normalize city string for reliable comparison."""
    if not city:
        return ""
    return city.strip().lower()


async def find_matching_trips_for_parcel(parcel: ParcelRequest) -> List[TravelTrip]:
    """Find active trips that can carry this parcel."""
    async with get_db_session() as session:
        stmt = (
            select(TravelTrip)
            .join(User, TravelTrip.user_id == User.id)
            .where(
                and_(
                    TravelTrip.status == TripStatus.ACTIVE,
                    User.is_banned.is_(False),
                    TravelTrip.from_city == normalize_city(parcel.from_city),
                    TravelTrip.to_city == normalize_city(parcel.to_city),
                    # Departure should be on or before the sender's deadline
                    TravelTrip.departure_date <= parcel.deadline_date,
                    # And not in the past
                    TravelTrip.departure_date >= today(),
                    # Don't match the same user with themselves
                    TravelTrip.user_id != parcel.sender_id
                )
            )
            .order_by(TravelTrip.departure_date.asc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())


async def find_matching_parcels_for_trip(trip: TravelTrip) -> List[ParcelRequest]:
    """Find searching parcels suitable for this trip."""
    async with get_db_session() as session:
        stmt = (
            select(ParcelRequest)
            .join(User, ParcelRequest.sender_id == User.id)
            .where(
                and_(
                    ParcelRequest.status == ParcelStatus.SEARCHING,
                    User.is_banned.is_(False),
                    ParcelRequest.from_city == normalize_city(trip.from_city),
                    ParcelRequest.to_city == normalize_city(trip.to_city),
                    # Trip leaves before or on the parcel deadline
                    ParcelRequest.deadline_date >= trip.departure_date,
                    ParcelRequest.sender_id != trip.user_id
                )
            )
            .order_by(ParcelRequest.created_at.desc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())
