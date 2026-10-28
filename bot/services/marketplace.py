from services.clock import today
"""Business operations shared by Telegram handlers and the Mini App API."""
from datetime import date
from sqlalchemy import select, update, or_
from sqlalchemy.exc import IntegrityError
from services.notifications import enqueue_deal
from database.db import get_db_session
from database.models import User, TravelTrip, ParcelRequest, DeliveryDeal, TripStatus, ParcelStatus


class MarketplaceError(Exception):
    def __init__(self, message, status=400):
        super().__init__(message)
        self.status = status


async def create_response(telegram_id, kind, listing_id, trip_id=None):
    if kind not in ("trip", "parcel") or type(listing_id) is not int or listing_id <= 0:
        raise MarketplaceError("Выберите заявку.")
    async with get_db_session() as session:
        user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
        if not user or user.is_banned or not user.disclaimer_accepted:
            raise MarketplaceError("Примите правила в /start.", 403)
        listing = await session.get(ParcelRequest if kind == "parcel" else TravelTrip, listing_id)
        if not listing:
            raise MarketplaceError("Заявка не найдена.", 404)
        owner_id = listing.sender_id if kind == "parcel" else listing.user_id
        if owner_id == user.id:
            raise MarketplaceError("Нельзя откликнуться на свою заявку.", 409)
        owner = await session.get(User, owner_id)
        if owner.is_banned:
            raise MarketplaceError("Заявка недоступна.", 404)
        if (kind == "parcel" and (listing.status != ParcelStatus.SEARCHING or listing.deadline_date < today())) or (kind == "trip" and (listing.status != TripStatus.ACTIVE or listing.departure_date < today())):
            raise MarketplaceError("Заявка уже закрыта.", 409)
        if trip_id is not None:
            trip = await session.get(TravelTrip, trip_id)
            if not trip or trip.user_id != user.id or trip.status != TripStatus.ACTIVE:
                raise MarketplaceError("Этот рейс вам не принадлежит или закрыт.", 403)
            if kind != "parcel" or trip.from_city != listing.from_city or trip.to_city != listing.to_city or not today() <= trip.departure_date <= listing.deadline_date:
                raise MarketplaceError("Рейс не подходит к заявке.", 409)
        sender_id = owner_id if kind == "parcel" else user.id
        traveler_id = user.id if kind == "parcel" else owner_id
        duplicate = (DeliveryDeal.parcel_id == listing_id) & (DeliveryDeal.traveler_id == traveler_id) if kind == "parcel" else (DeliveryDeal.trip_id == listing_id) & (DeliveryDeal.sender_id == sender_id)
        if await session.scalar(select(DeliveryDeal.id).where(duplicate)):
            raise MarketplaceError("Вы уже откликнулись на эту заявку.", 409)
        deal = DeliveryDeal(parcel_id=listing_id if kind == "parcel" else None,
            trip_id=trip_id if kind == "parcel" else listing_id,
            sender_id=sender_id, traveler_id=traveler_id, confirmation_user_id=owner_id,
            reward=f"{listing.budget_amount:g} ₽" if kind == "parcel" else listing.reward_note,
            status="matched", inspection_done=False)
        session.add(deal)
        try:
            await session.flush()
            await enqueue_deal(session, deal, telegram_id)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise MarketplaceError("Вы уже откликнулись на эту заявку.", 409)
        return deal


async def change_status(telegram_id, deal_id, status, inspection=False):
    async with get_db_session() as session:
        user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
        if not user or user.is_banned or not user.disclaimer_accepted:
            raise MarketplaceError("Нет доступа.", 403)
        deal = await session.get(DeliveryDeal, deal_id)
        if not deal or user.id not in (deal.sender_id, deal.traveler_id):
            raise MarketplaceError("Сделка не найдена.", 404)
        expected = {"matched": "confirmed", "confirmed": "in_transit", "in_transit": "delivered"}.get(deal.status)
        if status != expected or expected is None:
            raise MarketplaceError("Недопустимая смена статуса.", 409)
        required = deal.confirmation_user_id if status == "confirmed" else deal.traveler_id if status == "in_transit" else deal.sender_id
        if user.id != required:
            raise MarketplaceError("Недостаточно прав.", 403)
        if status == "in_transit" and inspection is not True:
            raise MarketplaceError("Подтвердите фактический досмотр.")
        if status == "confirmed":
            if deal.trip_id:
                trip = await session.get(TravelTrip, deal.trip_id)
                if trip.status != TripStatus.ACTIVE or trip.departure_date < today():
                    raise MarketplaceError("Рейс уже закрыт.", 409)
            if deal.parcel_id:
                result = await session.execute(update(ParcelRequest).where(ParcelRequest.id == deal.parcel_id,
                    ParcelRequest.status == ParcelStatus.SEARCHING, ParcelRequest.deadline_date >= today()).values(status=ParcelStatus.MATCHED))
                if result.rowcount != 1:
                    raise MarketplaceError("Для посылки уже выбран попутчик или заявка закрыта.", 409)
        if status == "delivered" and deal.parcel_id:
            await session.execute(update(ParcelRequest).where(ParcelRequest.id == deal.parcel_id).values(status=ParcelStatus.DELIVERED))
        old = deal.status
        result = await session.execute(update(DeliveryDeal).where(DeliveryDeal.id == deal.id, DeliveryDeal.status == old).values(
            status=status, inspection_done=deal.inspection_done or status == "in_transit"))
        if result.rowcount != 1:
            raise MarketplaceError("Сделка уже изменена. Обновите страницу.", 409)
        if status == "delivered":
            await session.execute(update(User).where(User.id == deal.traveler_id).values(completed_deliveries=User.completed_deliveries + 1))
        await session.flush()
        await session.refresh(deal)
        await enqueue_deal(session, deal, telegram_id)
        await session.commit()
        return deal


async def cancel_listing(telegram_id, kind, listing_id):
    async with get_db_session() as session:
        user = await session.scalar(select(User).where(User.telegram_id == telegram_id))
        if not user or user.is_banned:
            raise MarketplaceError("Нет доступа.", 403)
        model = TravelTrip if kind == "trip" else ParcelRequest
        item = await session.get(model, listing_id)
        if not item or (item.user_id if kind == "trip" else item.sender_id) != user.id:
            raise MarketplaceError("Заявка не найдена.", 404)
        relevant = DeliveryDeal.trip_id == listing_id if kind == "trip" else DeliveryDeal.parcel_id == listing_id
        if await session.scalar(select(DeliveryDeal.id).where(relevant, DeliveryDeal.status.in_(["confirmed", "in_transit"]))):
            raise MarketplaceError("Нельзя отменить заявку с действующей сделкой.", 409)
        item.status = TripStatus.CANCELLED if kind == "trip" else ParcelStatus.CANCELLED
