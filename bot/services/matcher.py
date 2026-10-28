"""
Smart Auto-Matching Service for Crowdshipping Marketplace.
Detects matching routes between Travelers and Senders and triggers instant push notifications.
"""

import logging
from typing import List, Optional
from datetime import date
from sqlalchemy import select, and_
from aiogram import Bot

from database.db import get_db_session
from database.models import (
    TravelTrip,
    ParcelRequest,
    User,
    TripStatus,
    ParcelStatus
)
from keyboards.inline import get_match_action_keyboard

logger = logging.getLogger(__name__)


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
                    TravelTrip.from_city == normalize_city(parcel.from_city),
                    TravelTrip.to_city == normalize_city(parcel.to_city),
                    # Departure should be on or before the sender's deadline
                    TravelTrip.departure_date <= parcel.deadline_date,
                    # And not in the past
                    TravelTrip.departure_date >= date.today(),
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


async def notify_travelers_about_new_parcel(bot: Bot, parcel: ParcelRequest) -> int:
    """
    Called immediately after a sender registers a parcel.
    Pushes instant Telegram notifications to all matching travelers.
    """
    matching_trips = await find_matching_trips_for_parcel(parcel)
    if not matching_trips:
        logger.info(f"No matching trips found yet for parcel #{parcel.id} ({parcel.from_city}->{parcel.to_city})")
        return 0

    notified_count = 0
    async with get_db_session() as session:
        for trip in matching_trips:
            # Load traveler telegram id
            user_stmt = select(User).where(User.id == trip.user_id)
            user_res = await session.execute(user_stmt)
            traveler = user_res.scalar_one_or_none()

            if not traveler:
                continue

            text = (
                f"🔔 <b>НАЙДЕНА ПОДХОДЯЩАЯ ПОСЫЛКА ДЛЯ ВАШЕГО РЕЙСА!</b>\n\n"
                f"Маршрут: <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>\n"
                f"📅 Крайний срок доставки: <b>{parcel.deadline_date.strftime('%d.%m.%Y')}</b>\n"
                f"✈️ Ваш рейс: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\n\n"
                f"📦 <b>Категория:</b> {parcel.category.value}\n"
                f"📝 <b>Описание:</b> {parcel.description}\n"
                f"💰 <b>Предлагаемый бюджет:</b> {int(parcel.budget_amount)} {parcel.currency}\n\n"
                f"<i>Нажмите «Откликнуться», чтобы отправить согласие и связаться с отправителем без раскрытия телефонного номера.</i>"
            )

            try:
                kb = get_match_action_keyboard(parcel_id=parcel.id, trip_id=trip.id)
                if parcel.photo_file_id:
                    await bot.send_photo(
                        chat_id=traveler.telegram_id,
                        photo=parcel.photo_file_id,
                        caption=text,
                        reply_markup=kb,
                        parse_mode="HTML"
                    )
                else:
                    await bot.send_message(
                        chat_id=traveler.telegram_id,
                        text=text,
                        reply_markup=kb,
                        parse_mode="HTML"
                    )
                notified_count += 1
            except Exception as e:
                logger.warning(f"Could not send match notification to user {traveler.telegram_id}: {e}")

    logger.info(f"Sent {notified_count} match notifications for parcel #{parcel.id}")
    return notified_count
