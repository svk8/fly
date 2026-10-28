"""
Background Task Scheduler using APScheduler.
Handles automated expiration of old trips and reminders.
"""

import logging
from datetime import date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import update, and_
from aiogram import Bot

from database.db import get_db_session
from database.models import TravelTrip, ParcelRequest, TripStatus, ParcelStatus

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler()


async def archive_expired_entries(bot: Bot) -> None:
    """Archive trips and parcel requests that have passed their target dates."""
    today = date.today()
    logger.info(f"Running scheduler sweep for expired records on {today}...")

    async with get_db_session() as session:
        # 1. Update expired trips
        trip_stmt = (
            update(TravelTrip)
            .where(
                and_(
                    TravelTrip.status == TripStatus.ACTIVE,
                    TravelTrip.departure_date < today
                )
            )
            .values(status=TripStatus.COMPLETED)
        )
        trip_res = await session.execute(trip_stmt)

        # 2. Update expired parcels
        parcel_stmt = (
            update(ParcelRequest)
            .where(
                and_(
                    ParcelRequest.status == ParcelStatus.SEARCHING,
                    ParcelRequest.deadline_date < today
                )
            )
            .values(status=ParcelStatus.CANCELLED)
        )
        parcel_res = await session.execute(parcel_stmt)

        logger.info(
            f"Archived {trip_res.rowcount} expired trips and "
            f"{parcel_res.rowcount} expired parcel requests."
        )


def start_scheduler(bot: Bot) -> None:
    """Configure and start the background scheduler."""
    scheduler.add_job(
        archive_expired_entries,
        trigger="cron",
        hour=2,
        minute=0,
        args=[bot],
        id="archive_expired_entries",
        replace_existing=True
    )
    scheduler.start()
    logger.info("APScheduler initialized and running.")


def stop_scheduler() -> None:
    """Graceful shutdown of scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped.")
