"""Retry Telegram delivery from a durable outbox, with recoverable leases."""
import asyncio
import logging
import random
import uuid
from datetime import datetime, timedelta
from sqlalchemy import select, update, or_, and_
from aiogram.exceptions import TelegramBadRequest, TelegramForbiddenError, TelegramRetryAfter, TelegramMigrateToChat, TelegramNetworkError, TelegramServerError
from database.db import get_db_session
from database.models import NotificationJob, User, TravelTrip, ParcelRequest, DeliveryDeal, TripStatus, ParcelStatus
from services.clock import today
from services.notifications import enqueue
from keyboards.inline import get_match_action_keyboard, get_tma_launch_inline_keyboard
from config import settings
from monitoring import report_exception

logger = logging.getLogger(__name__)


class NotificationWorker:
    def __init__(self, bot):
        self.bot = bot
        self.stopped = asyncio.Event()

    @staticmethod
    def _ready(now):
        return or_(and_(NotificationJob.status == 'pending', NotificationJob.next_attempt_at <= now),
            and_(NotificationJob.status == 'processing', NotificationJob.lease_until <= now))

    async def _claim(self):
        now = datetime.utcnow()
        async with get_db_session() as session:
            job_id = await session.scalar(select(NotificationJob.id).where(self._ready(now))
                .order_by(NotificationJob.id).limit(1))
            if job_id is None:
                return None
            token = uuid.uuid4().hex
            result = await session.execute(update(NotificationJob).where(NotificationJob.id == job_id, self._ready(now))
                .values(status='processing', lease_until=now + timedelta(seconds=120), lease_token=token,
                    attempts=NotificationJob.attempts + 1))
            if result.rowcount != 1:
                return None
            return await session.get(NotificationJob, job_id)

    async def _finish(self, job, **values):
        async with get_db_session() as session:
            await session.execute(update(NotificationJob).where(NotificationJob.id == job.id,
                NotificationJob.status == 'processing', NotificationJob.lease_token == job.lease_token)
                .values(lease_until=None, lease_token=None, **values))

    async def _match(self, session, trip, parcel):
        traveler = await session.get(User, trip.user_id)
        sender = await session.get(User, parcel.sender_id)
        if not traveler or not sender or traveler.is_banned or sender.is_banned or traveler.id == sender.id:
            return
        text = (f"🔔 Для рейса #{trip.id} найдена посылка #{parcel.id}.\n"
            f"{parcel.from_city.title()} ➔ {parcel.to_city.title()}\n"
            f"Дата рейса: {trip.departure_date:%d.%m.%Y}, доставить до {parcel.deadline_date:%d.%m.%Y}.\n"
            f"{parcel.category.value}. {parcel.description[:1800]}\n"
            f"Бюджет: {parcel.budget_amount:g} {parcel.currency}.\nПередача только в открытом виде для досмотра.")
        payload = {'chat_id': traveler.telegram_id, 'text': text,
            'reply_markup': get_match_action_keyboard(parcel.id, trip.id).model_dump(mode='json', exclude_none=True),
            'trip_id': trip.id, 'parcel_id': parcel.id}
        # Send the text separately to avoid Telegram's shorter photo-caption limit.
        await enqueue(session, f'match:{parcel.id}:{trip.id}', 'message', payload)
        if parcel.photo_file_id:
            await enqueue(session, f'match-photo:{parcel.id}:{trip.id}', 'photo',
                {'chat_id': traveler.telegram_id, 'photo': parcel.photo_file_id, 'trip_id': trip.id, 'parcel_id': parcel.id})

    async def _expand(self, job):
        async with get_db_session() as session:
            if job.kind == 'parcel_created':
                parcel = await session.get(ParcelRequest, job.payload['id'])
                if parcel and parcel.status == ParcelStatus.SEARCHING and parcel.deadline_date >= today():
                    trips = (await session.scalars(select(TravelTrip).where(TravelTrip.status == TripStatus.ACTIVE,
                        TravelTrip.from_city == parcel.from_city, TravelTrip.to_city == parcel.to_city,
                        TravelTrip.departure_date >= today(), TravelTrip.departure_date <= parcel.deadline_date))).all()
                    for trip in trips:
                        await self._match(session, trip, parcel)
            elif job.kind == 'trip_created':
                trip = await session.get(TravelTrip, job.payload['id'])
                if trip and trip.status == TripStatus.ACTIVE and trip.departure_date >= today():
                    parcels = (await session.scalars(select(ParcelRequest).where(ParcelRequest.status == ParcelStatus.SEARCHING,
                        ParcelRequest.from_city == trip.from_city, ParcelRequest.to_city == trip.to_city,
                        ParcelRequest.deadline_date >= trip.departure_date))).all()
                    for parcel in parcels:
                        await self._match(session, trip, parcel)
            elif job.kind == 'deal_changed':
                deal = await session.get(DeliveryDeal, job.payload['id'])
                if deal:
                    labels = {'matched': 'Новый отклик', 'confirmed': 'Договоренность подтверждена',
                        'in_transit': 'Посылка принята и отправлена', 'delivered': 'Доставка подтверждена'}
                    for user_id in (deal.sender_id, deal.traveler_id):
                        user = await session.get(User, user_id)
                        if user and not user.is_banned and user.telegram_id != job.payload['actor_id']:
                            payload = {'chat_id': user.telegram_id, 'text': f"📦 Сделка #{deal.id}: {labels.get(job.payload['status'], job.payload['status'])}. Подробности: /deals."}
                            if settings.WEBAPP_URL:
                                payload['reply_markup'] = get_tma_launch_inline_keyboard().model_dump(mode='json', exclude_none=True)
                            await enqueue(session, f"{job.dedup_key}:user:{user.telegram_id}", 'message', payload)
            else:
                raise ValueError('Unknown notification event')
            # Expanded messages and the completion marker are committed together.
            result = await session.execute(update(NotificationJob).where(NotificationJob.id == job.id,
                NotificationJob.status == 'processing', NotificationJob.lease_token == job.lease_token)
                .values(status='sent', sent_at=datetime.utcnow(), lease_token=None, lease_until=None, last_error=None))
            if result.rowcount != 1:
                raise RuntimeError('Notification lease lost')

    async def _deliver(self, job):
        payload = dict(job.payload)
        async with get_db_session() as session:
            user = await session.scalar(select(User).where(User.telegram_id == payload['chat_id']))
            if not user or user.is_banned:
                await self._finish(job, status='cancelled', last_error='recipient_unavailable')
                return
            # Do not deliver expired/cancelled route suggestions after a long outage.
            if 'trip_id' in payload:
                trip = await session.get(TravelTrip, payload['trip_id'])
                parcel = await session.get(ParcelRequest, payload['parcel_id'])
                if not trip or not parcel or trip.status != TripStatus.ACTIVE or parcel.status != ParcelStatus.SEARCHING or trip.departure_date < today() or parcel.deadline_date < today():
                    await self._finish(job, status='cancelled', last_error='listing_unavailable')
                    return
        payload.pop('trip_id', None)
        payload.pop('parcel_id', None)
        payload['parse_mode'] = None  # User-controlled content is sent as plain text.
        if job.kind == 'photo':
            result = await asyncio.wait_for(self.bot.send_photo(**payload), timeout=30)
        else:
            result = await asyncio.wait_for(self.bot.send_message(**payload), timeout=30)
        message_id = result.message_id if isinstance(getattr(result, 'message_id', None), int) else None
        await self._finish(job, status='sent', sent_at=datetime.utcnow(), telegram_message_id=message_id, last_error=None)

    async def process_one(self):
        job = await self._claim()
        if job is None:
            return False
        try:
            if job.kind in ('message', 'photo'):
                await self._deliver(job)
            else:
                await self._expand(job)
        except asyncio.CancelledError:
            # Recovered after the lease expires, even if shutdown interrupts this write too.
            await self._finish(job, status='pending', next_attempt_at=datetime.utcnow(), last_error='worker_stopped')
            raise
        except (TelegramForbiddenError, TelegramBadRequest) as error:
            await self._finish(job, status='failed', last_error=type(error).__name__)
            if isinstance(error, TelegramBadRequest):
                report_exception(error, 'notification_delivery')
            logger.warning('Notification %s permanently failed: %s', job.id, type(error).__name__)
        except Exception as error:
            transient = isinstance(error, (TelegramRetryAfter, TelegramNetworkError, TelegramServerError, ConnectionError, TimeoutError))
            if not transient or job.attempts == 5:
                report_exception(error, 'notification_job')
            delay = min(3600, 5 * 2 ** min(job.attempts - 1, 10)) + random.uniform(0, 1)
            if isinstance(error, TelegramRetryAfter):
                delay = max(delay, error.retry_after + 1)
            if isinstance(error, TelegramMigrateToChat):
                # Private-chat notifications should never migrate. Keep the failure visible.
                await self._finish(job, status='failed', last_error=type(error).__name__)
                return True
            await self._finish(job, status='pending', next_attempt_at=datetime.utcnow() + timedelta(seconds=delay),
                last_error=type(error).__name__)
            logger.warning('Notification %s retry scheduled in %.1fs: %s', job.id, delay, type(error).__name__)
        return True

    async def run(self):
        while not self.stopped.is_set():
            try:
                if await self.process_one():
                    await asyncio.sleep(.05)
                    continue
            except Exception as error:
                report_exception(error, 'notification_worker')
                logger.error('Notification worker error: %s', type(error).__name__)
            try:
                await asyncio.wait_for(self.stopped.wait(), timeout=1)
            except asyncio.TimeoutError:
                pass

    async def stop(self, task):
        self.stopped.set()
        try:
            await asyncio.wait_for(asyncio.shield(task), timeout=10)
        except asyncio.TimeoutError:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
