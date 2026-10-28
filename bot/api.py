from services.clock import today
"""Mini App API backed by the same SQLAlchemy models and services as the bot."""
import hashlib
import hmac
import json
import logging
import math
import re
import time
from datetime import date, datetime
from urllib.parse import parse_qsl
from aiohttp import web
from sqlalchemy import select, or_, text as sql_text
from sqlalchemy.exc import IntegrityError
from config import settings
from database.db import get_db_session
from database.models import (User, TravelTrip, ParcelRequest, TripDetails, ParcelDetails,
    DeliveryDeal, TripStatus, ParcelStatus, ParcelCategory, CapacityType)
from services.marketplace import create_response, change_status, MarketplaceError
from services.matcher import normalize_city
from services.notifications import enqueue_listing

logger = logging.getLogger(__name__)


def verify_init_data(raw, token, now=None):
    if not raw or len(raw) > 16384:
        raise MarketplaceError("Откройте приложение через Telegram.", 401)
    pairs = parse_qsl(raw, keep_blank_values=True)
    if len({k for k, _ in pairs}) != len(pairs):
        raise MarketplaceError("Некорректная авторизация.", 401)
    params = dict(pairs)
    supplied = params.pop("hash", "")
    check = "\n".join(f"{key}={value}" for key, value in sorted(params.items()))
    secret = hmac.new(b"WebAppData", token.encode(), hashlib.sha256).digest()
    expected = hmac.new(secret, check.encode(), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, supplied):
        raise MarketplaceError("Некорректная авторизация.", 401)
    try:
        now = int(time.time()) if now is None else now
        auth_date = int(params["auth_date"])
        if not now - 86400 <= auth_date <= now + 30:
            raise ValueError()
        user = json.loads(params["user"])
        if type(user["id"]) is not int or not 0 < user["id"] <= 2**53 - 1 or not isinstance(user["first_name"], str):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise MarketplaceError("Сессия истекла или некорректна. Откройте приложение заново.", 401)
    return user


def field(body, key, max_length=200):
    value = body.get(key)
    if not isinstance(value, str) or not value.strip() or len(value.strip()) > max_length:
        raise MarketplaceError(f"Проверьте поле: {key}.")
    return value.strip()


def parse_date(body, key):
    try:
        value = datetime.strptime(field(body, key, 10), "%d.%m.%Y").date()
        if value < today():
            raise ValueError()
        return value
    except ValueError:
        raise MarketplaceError("Укажите сегодняшнюю или будущую дату в формате ДД.ММ.ГГГГ.")


async def ensure_user(tg):
    async with get_db_session() as session:
        user = await session.scalar(select(User).where(User.telegram_id == tg["id"]))
        if not user:
            user = User(telegram_id=tg["id"], full_name=" ".join(filter(None, [tg["first_name"], tg.get("last_name")]))[:128], username=tg.get("username"))
            session.add(user)
            try:
                await session.commit()
            except IntegrityError:
                await session.rollback()
                user = await session.scalar(select(User).where(User.telegram_id == tg["id"]))
        if user.is_banned:
            raise MarketplaceError("Доступ заблокирован.", 403)
        user.full_name = " ".join(filter(None, [tg["first_name"], tg.get("last_name")]))[:128]
        user.username = tg.get("username")
        return user


async def trip_json(session, trip):
    user = await session.get(User, trip.user_id)
    details = await session.get(TripDetails, trip.id)
    return dict(id=trip.id, userId=user.telegram_id, userName=user.full_name, userHandle=user.username or "",
        userRating=None, completedTrips=user.completed_deliveries,
        fromCity=trip.from_city.title(), toCity=trip.to_city.title(), departureDate=trip.departure_date.strftime("%d.%m.%Y"),
        capacity=details.capacity_label if details else f"до {trip.max_weight_kg:g} кг", reward=trip.reward_note,
        note=details.note if details else "", status=trip.status.value, createdAt=trip.created_at.isoformat())


async def parcel_json(session, parcel):
    user = await session.get(User, parcel.sender_id)
    details = await session.get(ParcelDetails, parcel.id)
    return dict(id=parcel.id, senderId=user.telegram_id, senderName=user.full_name, senderHandle=user.username or "",
        senderRating=None, fromCity=parcel.from_city.title(), toCity=parcel.to_city.title(),
        deadlineDate=parcel.deadline_date.strftime("%d.%m.%Y"), category=details.category_label if details else parcel.category.value,
        weight=details.weight_label if details else "Уточните у отправителя", description=parcel.description,
        budget=parcel.budget_amount, currency="₽" if parcel.currency == "RUB" else parcel.currency,
        status=parcel.status.value, createdAt=parcel.created_at.isoformat())


async def deal_json(session, deal):
    sender = await session.get(User, deal.sender_id)
    traveler = await session.get(User, deal.traveler_id)
    owner = await session.get(User, deal.confirmation_user_id)
    listing = await session.get(ParcelRequest, deal.parcel_id) if deal.parcel_id else await session.get(TravelTrip, deal.trip_id)
    return dict(id=deal.id, parcelId=deal.parcel_id, tripId=deal.trip_id, senderId=sender.telegram_id, travelerId=traveler.telegram_id,
        confirmationUserId=owner.telegram_id, senderName=sender.full_name, senderHandle=sender.username or "",
        travelerName=traveler.full_name, travelerHandle=traveler.username or "", route=f"{listing.from_city.title()} ➔ {listing.to_city.title()}",
        reward=deal.reward, category=listing.category.value if deal.parcel_id else "Посылка", status=deal.status,
        inspectionDone=deal.inspection_done, createdAt=deal.created_at.isoformat())


def create_api(bot):
    writes = {}
    @web.middleware
    async def middleware(request, handler):
        try:
            if request.path == "/api/health":
                return await handler(request)
            tg = verify_init_data(request.headers.get("X-Telegram-Init-Data", ""), settings.BOT_TOKEN)
            request["user"] = await ensure_user(tg)
            if request.method != "GET":
                now = time.monotonic()
                for key in list(writes):
                    if writes[key][1] < now:
                        del writes[key]
                count, until = writes.get(tg["id"], (0, now + 60))
                writes[tg["id"]] = (count + 1, until)
                if count >= 30:
                    raise MarketplaceError("Слишком много запросов. Подождите минуту.", 429)
                try:
                    body = await request.json()
                except (ValueError, UnicodeDecodeError):
                    raise MarketplaceError("Некорректный JSON.")
                if not isinstance(body, dict):
                    raise MarketplaceError("Ожидается JSON-объект.")
                request["body"] = body
            response = await handler(request)
            response.headers["Cache-Control"] = "no-store"
            return response
        except MarketplaceError as error:
            return web.json_response({"error": str(error)}, status=error.status)
        except web.HTTPException as error:
            return web.json_response({"error": "Метод не найден." if error.status == 404 else error.reason}, status=error.status)
        except Exception as error:
            logger.error("API request failed: %s", type(error).__name__)
            return web.json_response({"error": "Сервис временно недоступен."}, status=500)

    app = web.Application(middlewares=[middleware], client_max_size=32768)

    async def health(request):
        async with get_db_session() as session:
            await session.execute(sql_text("SELECT 1"))
        return web.json_response({"status": "ok"})

    async def listings(request):
        kind = request.match_info["kind"]
        async with get_db_session() as session:
            if kind == "trips":
                items = (await session.scalars(select(TravelTrip).join(User).where(TravelTrip.status == TripStatus.ACTIVE,
                    TravelTrip.departure_date >= today(), User.is_banned.is_(False)).order_by(TravelTrip.id.desc()).limit(500))).all()
                data = [await trip_json(session, item) for item in items]
            else:
                items = (await session.scalars(select(ParcelRequest).join(User).where(ParcelRequest.status == ParcelStatus.SEARCHING,
                    ParcelRequest.deadline_date >= today(), User.is_banned.is_(False)).order_by(ParcelRequest.id.desc()).limit(500))).all()
                data = [await parcel_json(session, item) for item in items]
        return web.json_response({kind: data})

    async def create_listing(request):
        body = request["body"]
        if body.get("safetyAccepted") is not True:
            raise MarketplaceError("Подтвердите согласие на открытый досмотр.")
        origin, destination = normalize_city(field(body, "fromCity", 100)), normalize_city(field(body, "toCity", 100))
        if origin == destination:
            raise MarketplaceError("Выберите разные города.")
        is_trip = request.match_info["kind"] == "trips"
        async with get_db_session() as session:
            user = await session.get(User, request["user"].id)
            user.disclaimer_accepted = True
            user.disclaimer_accepted_at = user.disclaimer_accepted_at or datetime.utcnow()
            if is_trip:
                reward = field(body, "reward", 255)
                try:
                    amount = float(reward.removesuffix("₽").strip())
                except ValueError:
                    raise MarketplaceError("Некорректное вознаграждение.")
                if not math.isfinite(amount) or not 0 < amount <= 10000000:
                    raise MarketplaceError("Некорректное вознаграждение.")
                capacity = field(body, "capacity")
                match = re.fullmatch(r"до (\d+(?:[.,]\d+)?) кг", capacity)
                if not match or not 0 < float(match[1].replace(",", ".")) <= 23:
                    raise MarketplaceError("Выберите свободный вес до 23 кг.")
                weight = float(match[1].replace(",", "."))
                capacity_type = CapacityType.DOCUMENTS if weight <= .5 else CapacityType.SMALL_BAG if weight <= 2 else CapacityType.MEDIUM_LUGGAGE if weight <= 10 else CapacityType.FULL_SUITCASE
                item = TravelTrip(user_id=user.id, from_city=origin, to_city=destination, departure_date=parse_date(body, "departureDate"),
                    capacity_type=capacity_type, max_weight_kg=weight, reward_note=reward)
                session.add(item)
                await session.flush()
                session.add(TripDetails(trip_id=item.id, capacity_label=capacity, note=field(body, "note", 2000)))
                await session.flush()
                data = await trip_json(session, item)
            else:
                budget = body.get("budget")
                if type(budget) not in (int, float) or not math.isfinite(budget) or not 0 < budget <= 10000000:
                    raise MarketplaceError("Укажите бюджет от 1 до 10 000 000 ₽.")
                category = field(body, "category")
                aliases = {"Документы": ParcelCategory.DOCUMENTS, "Электроника": ParcelCategory.ELECTRONICS,
                    "Одежда & Покупки": ParcelCategory.CLOTHES, "Подарки": ParcelCategory.GIFTS}
                canonical = aliases.get(category, next((c for c in ParcelCategory if c.value == category), ParcelCategory.OTHER))
                item = ParcelRequest(sender_id=user.id, from_city=origin, to_city=destination, deadline_date=parse_date(body, "deadlineDate"),
                    category=canonical, description=field(body, "description", 2000), budget_amount=budget, currency="RUB")
                session.add(item)
                await session.flush()
                session.add(ParcelDetails(parcel_id=item.id, weight_label=field(body, "weight"), category_label=category))
                await session.flush()
                data = await parcel_json(session, item)
            await enqueue_listing(session, "trip" if is_trip else "parcel", item.id)
            await session.commit()
        return web.json_response({"trip" if is_trip else "parcel": data}, status=201)

    async def deals(request):
        async with get_db_session() as session:
            user = request["user"]
            items = (await session.scalars(select(DeliveryDeal).where(or_(DeliveryDeal.sender_id == user.id,
                DeliveryDeal.traveler_id == user.id)).order_by(DeliveryDeal.id.desc()).limit(500))).all()
            return web.json_response({"deals": [await deal_json(session, item) for item in items]})

    async def respond(request):
        body = request["body"]
        if body.get("safetyAccepted") is not True:
            raise MarketplaceError("Подтвердите согласие на открытый досмотр.")
        # Accepting the same rules in the Mini App also unlocks chat commands.
        async with get_db_session() as session:
            user = await session.get(User, request["user"].id)
            user.disclaimer_accepted = True
            user.disclaimer_accepted_at = user.disclaimer_accepted_at or datetime.utcnow()
        item = await create_response(request["user"].telegram_id, body.get("listingType"), body.get("listingId"))
        async with get_db_session() as session:
            data = await deal_json(session, item)
        return web.json_response({"deal": data}, status=201)

    async def status(request):
        try:
            deal_id = int(request.match_info["id"])
        except ValueError:
            raise MarketplaceError("Некорректная сделка.")
        item = await change_status(request["user"].telegram_id, deal_id, request["body"].get("status"), request["body"].get("inspectionDone") is True)
        async with get_db_session() as session:
            data = await deal_json(session, item)
        return web.json_response({"deal": data})

    app.router.add_get('/api/health', health)
    app.router.add_get('/api/{kind:trips|parcels}', listings)
    app.router.add_post('/api/{kind:trips|parcels}', create_listing)
    app.router.add_get('/api/deals', deals)
    app.router.add_post('/api/deals', respond)
    app.router.add_post('/api/deals/{id}/status', status)
    return app
