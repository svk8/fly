from html import escape
from services.clock import today
"""
Matching, Search, Deals, and Safe Contact Handlers.
Enforces safe contact connection without phone number exposure.
"""

import logging
from datetime import date
from aiogram import Router, F, Bot
from aiogram.filters import Command
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select, and_, or_

from database.db import get_db_session
from database.models import (
    User,
    TravelTrip,
    ParcelRequest,
    MatchDeal,
    TripStatus,
    ParcelStatus,
    DealStatus
)
from keyboards.inline import (
    get_safe_contact_keyboard,
    get_item_actions_keyboard
)
from keyboards.reply import get_main_menu_keyboard

logger = logging.getLogger(__name__)
router = Router(name="matching_router")


@router.callback_query(F.data.startswith("respond_match:"))
async def handle_traveler_response(callback: CallbackQuery, bot: Bot) -> None:
    from services.marketplace import create_response, MarketplaceError
    try:
        _, parcel_id, trip_id = callback.data.split(":")
        deal = await create_response(callback.from_user.id, "parcel", int(parcel_id), trip_id=int(trip_id))
    except (ValueError, MarketplaceError) as error:
        await callback.answer(str(error), show_alert=True)
        return
    from keyboards.inline import get_tma_launch_inline_keyboard
    await callback.message.edit_text(
        f"✅ Отклик по сделке #{deal.id} отправлен. Ожидайте подтверждения владельца заявки. Сделка доступна в боте через /deals и в Mini App.",
        reply_markup=get_tma_launch_inline_keyboard())
    await callback.answer("Отклик отправлен")


@router.callback_query(F.data.startswith("dismiss_match:"))
async def handle_dismiss_match(callback: CallbackQuery) -> None:
    """Traveler dismisses parcel match notification."""
    await callback.message.edit_text("Заявка отклонена. Мы пришлем новое уведомление, когда появится другой груз.")
    await callback.answer("Пропущено")


@router.message(F.text == "📋 Мои заявки и рейсы")
async def handle_my_items(message: Message) -> None:
    """View all current user's active trips and parcels."""
    telegram_id = message.from_user.id

    async with get_db_session() as session:
        user_stmt = select(User).where(User.telegram_id == telegram_id)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()

        if not user:
            await message.answer("Профиль не найден. Отправьте /start")
            return

        # Fetch active trips
        trips_stmt = (
            select(TravelTrip)
            .where(
                and_(
                    TravelTrip.user_id == user.id,
                    TravelTrip.status == TripStatus.ACTIVE
                )
            )
            .order_by(TravelTrip.departure_date.asc())
        )
        trips = (await session.execute(trips_stmt)).scalars().all()

        # Fetch active parcels
        parcels_stmt = (
            select(ParcelRequest)
            .where(
                and_(
                    ParcelRequest.sender_id == user.id,
                    or_(
                        ParcelRequest.status == ParcelStatus.SEARCHING,
                        ParcelRequest.status == ParcelStatus.MATCHED
                    )
                )
            )
            .order_by(ParcelRequest.created_at.desc())
        )
        parcels = (await session.execute(parcels_stmt)).scalars().all()

    if not trips and not parcels:
        await message.answer(
            "📋 <b>У вас пока нет активных рейсов или заявок.</b>\n\n"
            "Воспользуйтесь кнопками:\n"
            "• «✈️ Я лечу (Добавить рейс)» — если планируете поездку\n"
            "• «📦 Передать посылку» — если нужно передать документ или груз",
            parse_mode="HTML"
        )
        return

    await message.answer(f"📋 <b>ВАШИ АКТИВНЫЕ РЕЙСЫ И ЗАЯВКИ</b> (Рейсов: {len(trips)}, Посылок: {len(parcels)}):", parse_mode="HTML")

    # Render trips
    for trip in trips:
        trip_text = (
            f"✈️ <b>РЕЙС #{trip.id}</b>\n"
            f"Маршрут: <b>{escape(trip.from_city.title())} ➔ {escape(trip.to_city.title())}</b>\n"
            f"Дата: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\n"
            f"Вместимость: {trip.capacity_type.value}\n"
            f"Вознаграждение: {escape(trip.reward_note)}\n"
            f"Статус: 🟢 Активен"
        )
        await message.answer(
            trip_text,
            reply_markup=get_item_actions_keyboard("trip", trip.id),
            parse_mode="HTML"
        )

    # Render parcels
    for parcel in parcels:
        status_badge = "🟢 В поиске" if parcel.status == ParcelStatus.SEARCHING else "🤝 Найден попутчик"
        parcel_text = (
            f"📦 <b>ПОСЫЛКА #{parcel.id}</b>\n"
            f"Маршрут: <b>{escape(parcel.from_city.title())} ➔ {escape(parcel.to_city.title())}</b>\n"
            f"Крайний срок: <b>{parcel.deadline_date.strftime('%d.%m.%Y')}</b>\n"
            f"Категория: {escape(parcel.category.value)}\n"
            f"Описание: {escape(parcel.description)}\n"
            f"Вознаграждение: {int(parcel.budget_amount)} {parcel.currency}\n"
            f"Статус: {status_badge}"
        )
        await message.answer(
            parcel_text,
            reply_markup=get_item_actions_keyboard("parcel", parcel.id),
            parse_mode="HTML"
        )


@router.message(F.text == "🔍 Поиск рейсов и посылок")
async def handle_search_menu(message: Message) -> None:
    """List available active trips and open parcels in the marketplace."""
    async with get_db_session() as session:
        # Top 5 upcoming trips
        trips_stmt = (
            select(TravelTrip)
            .where(
                and_(
                    TravelTrip.status == TripStatus.ACTIVE,
                    TravelTrip.departure_date >= today()
                )
            )
            .order_by(TravelTrip.departure_date.asc())
            .limit(5)
        )
        trips = (await session.execute(trips_stmt)).scalars().all()

        # Top 5 searching parcels
        parcels_stmt = (
            select(ParcelRequest)
            .where(
                and_(
                    ParcelRequest.status == ParcelStatus.SEARCHING,
                    ParcelRequest.deadline_date >= today()
                )
            )
            .order_by(ParcelRequest.created_at.desc())
            .limit(5)
        )
        parcels = (await session.execute(parcels_stmt)).scalars().all()

    text = "🔍 <b>АКТУАЛЬНЫЕ РЕЙСЫ И ЗАЯВКИ В МАРКЕТПЛЕЙСЕ</b>\n\n"

    text += "✈️ <b>БЛИЖАЙШИЕ РЕЙСЫ ПОПУТЧИКОВ:</b>\n"
    if trips:
        for t in trips:
            text += (
                f"• <b>{escape(t.from_city.title())} ➔ {escape(t.to_city.title())}</b> "
                f"| {t.departure_date.strftime('%d.%m')} "
                f"| {escape(t.reward_note)}\n"
            )
    else:
        text += "<i>Пока нет активных рейсов. Будьте первым, кто добавит поездку!</i>\n"

    text += "\n📦 <b>ОТКРЫТЫЕ ПОСЫЛКИ ДЛЯ ДОСТАВКИ:</b>\n"
    if parcels:
        for p in parcels:
            text += (
                f"• <b>{escape(p.from_city.title())} ➔ {escape(p.to_city.title())}</b> "
                f"| до {p.deadline_date.strftime('%d.%m')} "
                f"| {int(p.budget_amount)} {p.currency} "
                f"({escape(p.category.value)})\n"
            )
    else:
        text += "<i>Пока нет открытых заявок на доставку.</i>\n"

    text += (
        "\n💡 <i>Совет: Чтобы получить персональное предложение, просто опубликуйте свой рейс или создайте посылку. "
        "Умный алгоритм сопоставит маршруты автоматически!</i>"
    )

    await message.answer(text, reply_markup=get_main_menu_keyboard(), parse_mode="HTML")


@router.message(Command("deals"))
@router.message(F.text == "🤝 Мои сделки")
async def handle_my_deals(message: Message) -> None:
    from api import deal_json
    from html import escape
    from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup
    from database.models import DeliveryDeal
    async with get_db_session() as session:
        user = await session.scalar(select(User).where(User.telegram_id == message.from_user.id))
        if not user or user.is_banned:
            await message.answer("Нет доступа. Отправьте /start.")
            return
        deals = (await session.scalars(select(DeliveryDeal).where(or_(DeliveryDeal.sender_id == user.id,
            DeliveryDeal.traveler_id == user.id)).order_by(DeliveryDeal.id.desc()).limit(20))).all()
        if not deals:
            await message.answer("У вас пока нет сделок. Заявки доступны в поиске и Mini App.")
        for deal in deals:
            data = await deal_json(session, deal)
            next_status = {"matched": "confirmed", "confirmed": "in_transit", "in_transit": "delivered"}.get(deal.status)
            role = deal.confirmation_user_id if next_status == "confirmed" else deal.traveler_id if next_status == "in_transit" else deal.sender_id
            labels = {"confirmed": "Подтвердить договоренность", "in_transit": "Лично досмотрел и принял посылку", "delivered": "Подтвердить доставку"}
            rows = []
            if next_status and user.id == role:
                rows.append([InlineKeyboardButton(text=labels[next_status], callback_data=f"deal_status:{deal.id}:{next_status}")])
            contact = data['travelerId'] if user.id == deal.sender_id else data['senderId']
            handle = data['travelerHandle'] if user.id == deal.sender_id else data['senderHandle']
            rows.append([InlineKeyboardButton(text="Написать участнику", url=f"https://t.me/{handle}" if handle else f"tg://user?id={contact}")])
            await message.answer(f"🤝 <b>Сделка #{deal.id}</b>\n{escape(data['route'])}\n{escape(deal.reward)}\nСтатус: {escape(deal.status)}",
                reply_markup=InlineKeyboardMarkup(inline_keyboard=rows))


@router.callback_query(F.data.startswith("deal_status:"))
async def handle_deal_status(callback: CallbackQuery, bot: Bot) -> None:
    from services.marketplace import change_status, MarketplaceError
    try:
        _, deal_id, status = callback.data.split(":")
        deal = await change_status(callback.from_user.id, int(deal_id), status, inspection=status == "in_transit")
    except (ValueError, MarketplaceError) as error:
        await callback.answer(str(error), show_alert=True)
        return
    await callback.message.edit_text(f"✅ Сделка #{deal.id}: {deal.status}. Обновите список командой /deals или откройте Mini App.")
    await callback.answer("Статус обновлен")
