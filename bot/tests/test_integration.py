"""Exercise real chat handlers and the Mini App API against the same temporary database."""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import tempfile
import time
import unittest
from datetime import date, timedelta
from pathlib import Path
from types import SimpleNamespace
from urllib.parse import urlencode
from unittest.mock import AsyncMock

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
TEMP = tempfile.TemporaryDirectory()
os.environ['DATABASE_URL'] = f'sqlite+aiosqlite:///{TEMP.name}/test.db'
os.environ['BOT_TOKEN'] = '123456:TEST_TOKEN'
os.environ['APP_URL'] = 'https://example.com'
from aiohttp.test_utils import TestClient, TestServer
from sqlalchemy import select
from api import create_api, verify_init_data
from database.db import engine, init_db, get_db_session
from database.models import Base, User, DeliveryDeal, TravelTrip, ParcelRequest, MatchDeal, DealStatus, ParcelStatus
from handlers.common import handle_start, handle_accept_disclaimer
from handlers.traveler import commit_trip
from handlers.sender import commit_parcel
from handlers.matching import handle_traveler_response, handle_my_items, handle_my_deals, handle_deal_status
from middleware import AccountMiddleware
from services.marketplace import MarketplaceError, create_response, cancel_listing

TOKEN = os.environ['BOT_TOKEN']

def signed(user_id=1, age=0):
    data = {'auth_date': str(int(time.time()) - age), 'user': json.dumps({'id': user_id, 'first_name': f'User {user_id}', 'username': f'user{user_id}'})}
    secret = hmac.new(b'WebAppData', TOKEN.encode(), hashlib.sha256).digest()
    data['hash'] = hmac.new(secret, '\n'.join(f'{key}={value}' for key, value in sorted(data.items())).encode(), hashlib.sha256).hexdigest()
    return urlencode(data)


def message(user_id):
    return SimpleNamespace(from_user=SimpleNamespace(id=user_id, username=f'user{user_id}', full_name=f'User {user_id}', first_name=f'User {user_id}'),
        answer=AsyncMock(), delete=AsyncMock(), edit_text=AsyncMock(), text='/start')


def callback(user_id, data=''):
    return SimpleNamespace(from_user=message(user_id).from_user, data=data, message=message(user_id), answer=AsyncMock())


class IntegrationTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        async with engine.begin() as connection:
            await connection.run_sync(Base.metadata.drop_all)
        await init_db()
        self.bot = SimpleNamespace(send_message=AsyncMock(), send_photo=AsyncMock())
        self.client = TestClient(TestServer(create_api(self.bot)))
        await self.client.start_server()
        self.day = date.today() + timedelta(days=2)

    async def asyncTearDown(self):
        await self.client.close()
        await engine.dispose()

    async def call(self, path, user=1, body=None):
        response = await self.client.request('POST' if body is not None else 'GET', '/api/' + path,
            headers={'X-Telegram-Init-Data': signed(user)} if user else {}, json=body)
        return response.status, await response.json()

    async def register_bot_user(self, user_id):
        await handle_start(message(user_id), SimpleNamespace(clear=AsyncMock()))
        await handle_accept_disclaimer(callback(user_id))

    async def bot_trip(self, user_id):
        data = dict(from_city='Москва', to_city='Дубай', departure_date=self.day.isoformat(), capacity_type='small_bag',
            max_weight_kg=2.0, reward_note='2000 ₽')
        await commit_trip(callback(user_id), SimpleNamespace(get_data=AsyncMock(return_value=data), clear=AsyncMock()), self.bot)
        async with get_db_session() as session:
            return (await session.scalars(select(TravelTrip).order_by(TravelTrip.id.desc()))).first().id

    def parcel_body(self):
        return dict(fromCity='Москва', toCity='Дубай', deadlineDate=self.day.strftime('%d.%m.%Y'), category='Документы',
            weight='0.5 кг', description='Документы', budget=2000, safetyAccepted=True, senderId=999, senderName='Forged')

    async def test_signature_and_api_validation(self):
        self.assertEqual(verify_init_data(signed(), TOKEN)['id'], 1)
        for raw in [signed() + '&auth_date=1', signed(age=90000), signed(age=-100), signed().replace('User', 'Fake')]:
            with self.assertRaises(MarketplaceError):
                verify_init_data(raw, TOKEN)
        self.assertEqual((await self.call('parcels', user=None))[0], 401)
        self.assertEqual((await self.call('parcels', body={**self.parcel_body(), 'deadlineDate': '31.02.2026'}))[0], 400)
        self.assertEqual((await self.call('parcels', body={**self.parcel_body(), 'safetyAccepted': False}))[0], 400)
        for _ in range(30):
            await self.call('parcels', user=99, body={'safetyAccepted': False})
        self.assertEqual((await self.call('parcels', user=99, body=self.parcel_body()))[0], 429)

    async def test_bot_trip_web_parcel_bot_response_and_cross_channel_statuses(self):
        await self.register_bot_user(2)
        trip_id = await self.bot_trip(2)
        status, data = await self.call('trips', 2)
        self.assertEqual(status, 200)
        self.assertEqual(data['trips'][0]['id'], trip_id)
        status, data = await self.call('parcels', body=self.parcel_body())
        self.assertEqual(status, 201)
        parcel_id = data['parcel']['id']
        self.assertEqual(data['parcel']['senderId'], 1)
        self.assertEqual(data['parcel']['senderName'], 'User 1')
        # Creation from the Mini App triggers the Python bot's route matching notifications.
        from services.notification_worker import NotificationWorker
        worker = NotificationWorker(self.bot)
        while await worker.process_one():
            pass
        self.assertTrue(self.bot.send_message.called)
        own = message(1)
        await handle_my_items(own)
        self.assertTrue(any('ПОСЫЛКА #' in call.args[0] for call in own.answer.call_args_list))
        await handle_traveler_response(callback(2, f'respond_match:{parcel_id}:{trip_id}'), self.bot)
        status, data = await self.call('deals', 1)
        self.assertEqual(status, 200)
        self.assertEqual(len(data['deals']), 1)
        deal = data['deals'][0]
        self.assertEqual(deal['status'], 'matched')
        self.assertFalse(deal['inspectionDone'])
        self.assertEqual((await self.call('deals', 3))[1]['deals'], [])
        self.assertEqual((await self.call('deals', 2, {'listingType': 'parcel', 'listingId': parcel_id, 'safetyAccepted': True}))[0], 409)
        self.assertEqual((await self.call(f'deals/{deal["id"]}/status', 2, {'status': 'confirmed'}))[0], 403)
        self.assertEqual((await self.call(f'deals/{deal["id"]}/status', 1, {'status': 'confirmed'}))[0], 200)
        listing = message(2)
        await handle_my_deals(listing)
        self.assertTrue(any('confirmed' in call.args[0] for call in listing.answer.call_args_list))
        self.assertEqual((await self.call(f'deals/{deal["id"]}/status', 2, {'status': 'in_transit'}))[0], 400)
        await handle_deal_status(callback(2, f'deal_status:{deal["id"]}:in_transit'), self.bot)
        self.assertEqual((await self.call('deals', 1))[1]['deals'][0]['status'], 'in_transit')
        self.assertEqual((await self.call(f'deals/{deal["id"]}/status', 1, {'status': 'delivered'}))[0], 200)
        async with get_db_session() as session:
            self.assertEqual((await session.get(ParcelRequest, parcel_id)).status, ParcelStatus.DELIVERED)
            self.assertEqual((await session.scalar(select(User).where(User.telegram_id == 2))).completed_deliveries, 1)
        await engine.dispose()
        self.assertEqual((await self.call('deals', 1))[1]['deals'][0]['status'], 'delivered')

    async def test_bot_parcel_visible_in_web_and_shared_ban_and_ownership(self):
        await self.register_bot_user(1)
        data = dict(from_city='Москва', to_city='Дубай', deadline_date=self.day.isoformat(), category='DOCUMENTS',
            description='Из чат-бота', budget_amount=1000)
        await commit_parcel(callback(1), SimpleNamespace(get_data=AsyncMock(return_value=data), clear=AsyncMock()), self.bot)
        status, data = await self.call('parcels', 2)
        self.assertEqual(data['parcels'][0]['description'], 'Из чат-бота')
        parcel_id = data['parcels'][0]['id']
        with self.assertRaises(MarketplaceError):
            await cancel_listing(2, 'parcel', parcel_id)
        await self.register_bot_user(2)
        trip = await self.bot_trip(2)
        await self.register_bot_user(3)
        with self.assertRaises(MarketplaceError):
            await create_response(3, 'parcel', parcel_id, trip_id=trip)
        async with get_db_session() as session:
            user = await session.scalar(select(User).where(User.telegram_id == 2))
            user.is_banned = True
        self.assertEqual((await self.call('parcels', 2))[0], 403)
        handler = AsyncMock()
        await AccountMiddleware()(handler, message(2), {})
        handler.assert_not_called()
        await cancel_listing(1, 'parcel', parcel_id)
        self.assertEqual((await self.call('parcels', 1))[1]['parcels'], [])

    async def test_legacy_deals_migrate_once(self):
        await self.register_bot_user(1)
        await self.register_bot_user(2)
        trip_id = await self.bot_trip(2)
        _, data = await self.call('parcels', 1, self.parcel_body())
        async with get_db_session() as session:
            sender = await session.scalar(select(User).where(User.telegram_id == 1))
            traveler = await session.scalar(select(User).where(User.telegram_id == 2))
            session.add(MatchDeal(trip_id=trip_id, parcel_id=data['parcel']['id'], traveler_id=traveler.id,
                sender_id=sender.id, agreed_price=2000, status=DealStatus.ACCEPTED))
        await init_db()
        await init_db()
        deals = (await self.call('deals', 1))[1]['deals']
        self.assertEqual(len(deals), 1)
        self.assertEqual(deals[0]['status'], 'confirmed')


    async def test_trip_dialog_survives_new_python_process_and_continues(self):
        from aiogram.fsm.context import FSMContext
        from aiogram.fsm.storage.base import StorageKey
        from database.fsm import DatabaseStorage
        from states.traveler import TravelerStates
        from handlers.traveler import start_traveler_flow, process_from_city, process_to_city
        key = StorageKey(bot_id=123456, chat_id=1, user_id=1)
        storage = DatabaseStorage()
        context = FSMContext(storage, key)
        await start_traveler_flow(message(1), context)
        origin = message(1)
        origin.text = 'Москва'
        await process_from_city(origin, context)
        await storage.close()
        await engine.dispose()
        # A fresh interpreter has neither the dispatcher nor any in-memory draft data.
        code = """
import asyncio, json
from database.fsm import DatabaseStorage
from database.db import engine
from aiogram.fsm.storage.base import StorageKey
async def check():
    storage = DatabaseStorage()
    key = StorageKey(bot_id=123456, chat_id=1, user_id=1)
    print(json.dumps({'state': await storage.get_state(key), 'data': await storage.get_data(key)}))
    await storage.close()
    await engine.dispose()
asyncio.run(check())
"""
        child = await asyncio.create_subprocess_exec(sys.executable, '-c', code,
            cwd=str(Path(__file__).resolve().parents[1]), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        output, error = await child.communicate()
        self.assertEqual(child.returncode, 0, error.decode())
        saved = json.loads(output)
        self.assertEqual(saved['state'], TravelerStates.waiting_to_city.state)
        self.assertEqual(saved['data'], {'from_city': 'Москва'})
        resumed = FSMContext(DatabaseStorage(), key)
        destination = message(1)
        destination.text = 'Дубай'
        await process_to_city(destination, resumed)
        self.assertEqual(await resumed.get_state(), TravelerStates.waiting_date.state)
        self.assertEqual(await resumed.get_data(), {'from_city': 'Москва', 'to_city': 'Дубай'})
        from handlers.common import handle_cancel
        await handle_cancel(message(1), resumed)
        after_cancel = FSMContext(DatabaseStorage(), key)
        self.assertIsNone(await after_cancel.get_state())
        self.assertEqual(await after_cancel.get_data(), {})

    async def test_parcel_draft_retains_photo_budget_and_publishes_after_restart(self):
        from aiogram.fsm.context import FSMContext
        from aiogram.fsm.storage.base import StorageKey
        from database.fsm import DatabaseStorage
        from states.sender import SenderStates
        await self.register_bot_user(1)
        key = StorageKey(bot_id=123456, chat_id=1, user_id=1)
        storage = DatabaseStorage()
        context = FSMContext(storage, key)
        draft = dict(from_city='Москва', to_city='Дубай', deadline_date=self.day.isoformat(), category='DOCUMENTS',
            description='Черновик после перезапуска', photo_file_id='telegram-photo-file-id', budget_amount=1234.50)
        await context.set_data(draft)
        await context.set_state(SenderStates.confirm_parcel)
        await storage.close()
        await engine.dispose()
        resumed = FSMContext(DatabaseStorage(), key)
        self.assertEqual(await resumed.get_data(), draft)
        self.assertEqual(await resumed.get_state(), SenderStates.confirm_parcel.state)
        await commit_parcel(callback(1), resumed, self.bot)
        self.assertIsNone(await resumed.get_state())
        self.assertEqual(await resumed.get_data(), {})
        async with get_db_session() as session:
            parcel = await session.scalar(select(ParcelRequest))
            self.assertEqual(parcel.photo_file_id, draft['photo_file_id'])
            self.assertEqual(parcel.budget_amount, 1234.50)
        # /start remains an explicit reset and does not delete published records.
        await resumed.set_data({'from_city': 'Другой город'})
        await resumed.set_state(SenderStates.waiting_to_city)
        await handle_start(message(1), resumed)
        self.assertIsNone(await resumed.get_state())
        self.assertEqual(await resumed.get_data(), {})
        self.assertEqual(len((await self.call('parcels', 1))[1]['parcels']), 1)

    async def test_fsm_key_isolation_and_concurrent_data_updates(self):
        from aiogram.fsm.context import FSMContext
        from aiogram.fsm.storage.base import StorageKey
        from dataclasses import replace
        from database.fsm import DatabaseStorage
        key = StorageKey(bot_id=123456, chat_id=1, user_id=1)
        storage = DatabaseStorage()
        others = [replace(key, user_id=2), replace(key, chat_id=2), replace(key, bot_id=9),
            replace(key, thread_id=10), replace(key, business_connection_id='business'), replace(key, destiny='other')]
        for other in others:
            await storage.set_data(other, {'private': 'other'})
        await storage.set_state(key, 'step')
        await asyncio.gather(*(storage.update_data(key, {str(i): i}) for i in range(10)))
        self.assertEqual(await storage.get_data(key), {str(i): i for i in range(10)})
        self.assertEqual(await storage.get_state(key), 'step')
        await storage.set_state(key, None)
        self.assertEqual(len(await storage.get_data(key)), 10)
        await storage.set_data(key, {'replacement': None, 'nested': {'city': 'Москва'}})
        for other in others:
            self.assertEqual(await storage.get_data(other), {'private': 'other'})
        await FSMContext(storage, key).clear()
        self.assertEqual(await storage.get_data(key), {})
        self.assertIsNone(await storage.get_state(key))


    async def queue_test_notification(self, key='test:message', kind='message'):
        from services.notifications import enqueue
        from database.models import NotificationJob
        await self.register_bot_user(1)
        async with get_db_session() as session:
            await enqueue(session, key, kind, {'chat_id': 1, 'text': 'Проверка очереди'})
            await enqueue(session, key, kind, {'chat_id': 1, 'text': 'Повторная запись'})
        async with get_db_session() as session:
            jobs = (await session.scalars(select(NotificationJob))).all()
            self.assertEqual(len(jobs), 1)
            return jobs[0].id

    async def test_notification_network_retry_survives_restart_without_resending_success(self):
        from datetime import datetime
        from database.models import NotificationJob
        from services.notification_worker import NotificationWorker
        job_id = await self.queue_test_notification()
        self.bot.send_message.side_effect = [ConnectionError('offline'), SimpleNamespace(message_id=77)]
        worker = NotificationWorker(self.bot)
        before = datetime.utcnow()
        self.assertTrue(await worker.process_one())
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            self.assertEqual(job.status, 'pending')
            self.assertEqual(job.attempts, 1)
            self.assertGreaterEqual((job.next_attempt_at - before).total_seconds(), 5)
            self.assertEqual(job.last_error, 'ConnectionError')
        self.assertFalse(await worker.process_one())
        await engine.dispose()
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            job.next_attempt_at = datetime.utcnow() - timedelta(seconds=1)
        restarted = NotificationWorker(self.bot)
        self.assertTrue(await restarted.process_one())
        self.assertFalse(await restarted.process_one())
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            self.assertEqual(job.status, 'sent')
            self.assertEqual(job.attempts, 2)
            self.assertEqual(job.telegram_message_id, 77)
            self.assertIsNone(job.last_error)
        self.assertEqual(self.bot.send_message.call_count, 2)

    async def test_notification_rate_limit_and_permanent_failure(self):
        from datetime import datetime
        from database.models import NotificationJob
        from services.notification_worker import NotificationWorker
        from aiogram.exceptions import TelegramRetryAfter, TelegramForbiddenError, TelegramBadRequest
        from aiogram.methods import SendMessage
        job_id = await self.queue_test_notification()
        method = SendMessage(chat_id=1, text='test')
        self.bot.send_message.side_effect = TelegramRetryAfter(method, 'slow down', retry_after=90)
        before = datetime.utcnow()
        worker = NotificationWorker(self.bot)
        await worker.process_one()
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            self.assertGreaterEqual((job.next_attempt_at - before).total_seconds(), 91)
            job.next_attempt_at = before
        self.bot.send_message.side_effect = TelegramForbiddenError(method, 'bot blocked')
        await worker.process_one()
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            self.assertEqual(job.status, 'failed')
            self.assertEqual(job.last_error, 'TelegramForbiddenError')
        self.assertFalse(await worker.process_one())
        # An operator can explicitly retry after fixing a permanent failure.
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            job.status = 'pending'
        self.bot.send_message.side_effect = TelegramBadRequest(method, 'invalid request')
        await worker.process_one()
        self.assertFalse(await worker.process_one())

    async def test_notification_lease_recovers_and_is_claimed_by_only_one_worker(self):
        from datetime import datetime
        from database.models import NotificationJob
        from services.notification_worker import NotificationWorker
        job_id = await self.queue_test_notification()
        first = NotificationWorker(self.bot)
        second = NotificationWorker(self.bot)
        claims = await asyncio.gather(first._claim(), second._claim())
        self.assertEqual(sum(item is not None for item in claims), 1)
        claimed = next(item for item in claims if item is not None)
        self.assertFalse(await second.process_one())
        await engine.dispose()
        async with get_db_session() as session:
            job = await session.get(NotificationJob, job_id)
            job.lease_until = datetime.utcnow() - timedelta(seconds=1)
        await second.process_one()
        await first._finish(claimed, status='pending')  # stale worker must not overwrite the new result
        async with get_db_session() as session:
            self.assertEqual((await session.get(NotificationJob, job_id)).status, 'sent')
        self.assertEqual(self.bot.send_message.call_count, 1)

    async def test_notification_outbox_is_atomic_and_route_matches_are_deduplicated(self):
        from database.models import NotificationJob
        from services.notifications import enqueue_listing
        from services.notification_worker import NotificationWorker
        await self.register_bot_user(1)
        with self.assertRaises(RuntimeError):
            async with get_db_session() as session:
                await enqueue_listing(session, 'parcel', 999)
                raise RuntimeError('transaction rolled back')
        async with get_db_session() as session:
            self.assertEqual((await session.scalars(select(NotificationJob))).all(), [])
        await self.register_bot_user(2)
        await self.bot_trip(2)
        await self.call('parcels', 1, self.parcel_body())
        worker = NotificationWorker(self.bot)
        while await worker.process_one():
            pass
        # Both trip_created and parcel_created discover the same pair, with one delivery.
        self.assertEqual(self.bot.send_message.call_count, 1)
        async with get_db_session() as session:
            deliveries = (await session.scalars(select(NotificationJob).where(NotificationJob.kind == 'message'))).all()
            self.assertEqual(len(deliveries), 1)
            self.assertEqual(deliveries[0].status, 'sent')
        self.assertFalse(await worker.process_one())

    async def test_notification_skips_cancelled_listings_and_banned_recipients(self):
        from services.notification_worker import NotificationWorker
        from database.models import NotificationJob
        job_id = await self.queue_test_notification()
        async with get_db_session() as session:
            user = await session.scalar(select(User).where(User.telegram_id == 1))
            user.is_banned = True
        await NotificationWorker(self.bot).process_one()
        self.bot.send_message.assert_not_called()
        async with get_db_session() as session:
            self.assertEqual((await session.get(NotificationJob, job_id)).status, 'cancelled')
        async with get_db_session() as session:
            user = await session.scalar(select(User).where(User.telegram_id == 1))
            user.is_banned = False
        await self.register_bot_user(2)
        await self.bot_trip(2)
        _, data = await self.call('parcels', 1, self.parcel_body())
        worker = NotificationWorker(self.bot)
        await worker.process_one()  # Expand the trip event while the parcel is still active.
        await cancel_listing(1, 'parcel', data['parcel']['id'])
        while await worker.process_one():
            pass
        self.bot.send_message.assert_not_called()


    async def test_monitoring_client_config_is_public_and_has_no_private_settings(self):
        status, data = await self.call('client-config', user=None)
        self.assertEqual(status, 200)
        self.assertEqual(set(data), {'dsn', 'environment', 'release', 'botUrl'})
        self.assertNotIn(TOKEN, json.dumps(data))

    async def test_monitoring_scrubs_auth_request_and_local_variables(self):
        from monitoring import sanitize_event
        event = {'request': {'data': 'parcel content', 'headers': {'Authorization': TOKEN}},
            'user': {'id': 1}, 'breadcrumbs': [{'message': 'private message'}], 'extra': {'initData': 'secret'},
            'exception': {'values': [{'type': 'RuntimeError', 'value': f'bot{TOKEN}/sendMessage initData=secret',
                'stacktrace': {'frames': [{'filename': '/app/test.py', 'vars': {'token': TOKEN}}]}}]}}
        clean = sanitize_event(event)
        encoded = json.dumps(clean)
        self.assertNotIn(TOKEN, encoded)
        self.assertNotIn('parcel content', encoded)
        self.assertNotIn('private message', encoded)
        self.assertNotIn('secret', encoded)
        self.assertEqual(clean['exception']['values'][0]['type'], 'RuntimeError')


    async def test_public_feed_has_cards_without_contact_information(self):
        from database.models import ParcelDetails, TripDetails
        await self.register_bot_user(2)
        trip_id = await self.bot_trip(2)
        payload = {**self.parcel_body(), 'description': 'Документы. Контакт: @private_user +7 (999) 123-45-67 email@example.com https://t.me/private_user'}
        _, created = await self.call('parcels', 1, payload)
        parcel_id = created['parcel']['id']
        status, public = await self.call('public/parcels', user=None)
        self.assertEqual(status, 200)
        card = public['parcels'][0]
        self.assertEqual(card['id'], parcel_id)
        self.assertEqual(card['budget'], 2000)
        self.assertIn('Документы', card['description'])
        for key in ('senderId', 'senderName', 'senderHandle', 'senderRating', 'photoFileId'):
            self.assertNotIn(key, card)
        encoded = json.dumps(card)
        for contact in ('private_user', '999', 'email@example.com', 'https://t.me'):
            self.assertNotIn(contact, encoded)
        status, public_trips = await self.call('public/trips', user=None)
        self.assertEqual(status, 200)
        trip = public_trips['trips'][0]
        self.assertEqual(trip['id'], trip_id)
        self.assertNotIn('userId', trip)
        self.assertNotIn('userName', trip)
        self.assertNotIn('userHandle', trip)
        self.assertEqual((await self.call('parcels', user=None))[0], 401)
        self.assertEqual((await self.call('deals', user=None))[0], 401)
        self.assertEqual((await self.call('parcels', user=None, body=self.parcel_body()))[0], 401)
        self.assertEqual((await self.call('public/parcels', user=None, body=self.parcel_body()))[0], 401)
        # Public reads neither create a guest account nor expose withdrawn listings.
        async with get_db_session() as session:
            users = (await session.scalars(select(User))).all()
            self.assertEqual(len(users), 2)
        await cancel_listing(1, 'parcel', parcel_id)
        self.assertEqual((await self.call('public/parcels', user=None))[1]['parcels'], [])
        async with get_db_session() as session:
            traveler = await session.scalar(select(User).where(User.telegram_id == 2))
            traveler.is_banned = True
        self.assertEqual((await self.call('public/trips', user=None))[1]['trips'], [])

    async def test_bot_link_preserves_listing_through_first_start_and_disclaimer(self):
        from aiogram.fsm.context import FSMContext
        from aiogram.fsm.storage.base import StorageKey
        from database.fsm import DatabaseStorage
        from urllib.parse import urlsplit, parse_qs
        context = FSMContext(DatabaseStorage(), StorageKey(bot_id=123456, chat_id=7, user_id=7))
        entry = message(7)
        entry.text = '/start parcel_42'
        await handle_start(entry, context)
        self.assertEqual((await context.get_data())['entry'], 'parcel_42')
        accepted = callback(7)
        await handle_accept_disclaimer(accepted, context)
        launch = accepted.message.answer.call_args_list[-1].kwargs['reply_markup'].inline_keyboard[0][0].web_app.url
        self.assertEqual(parse_qs(urlsplit(launch).query), {'listingType': ['parcel'], 'listingId': ['42']})
        self.assertEqual(await context.get_data(), {})


if __name__ == '__main__':
    unittest.main()
