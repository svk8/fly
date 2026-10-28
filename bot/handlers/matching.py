"""
Matching, Search, Deals, and Safe Contact Handlers.
Enforces safe contact connection without phone number exposure.
"""

import logging
from datetime import date
from aiogram import Router, F, Bot
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
    """
    Invoked when a traveler taps '🤝 Откликнуться на заявку'.
    Creates a deal and delivers safe, phone-masked contact details to both parties.
    """
    parts = callback.data.split(":")
    parcel_id = int(parts[1])
    trip_id = int(parts[2])
    traveler_telegram_id = callback.from_user.id

    async with get_db_session() as session:
        # 1. Fetch parcel and sender
        parcel_stmt = select(ParcelRequest).where(ParcelRequest.id == parcel_id)
        p_res = await session.execute(parcel_stmt)
        parcel = p_res.scalar_one_or_none()

        if not parcel or parcel.status != ParcelStatus.SEARCHING:
            await callback.answer("Эта заявка уже закрыта или отменена.", show_alert=True)
            return

        sender_stmt = select(User).where(User.id == parcel.sender_id)
        s_res = await session.execute(sender_stmt)
        sender = s_res.scalar_one_or_none()

        # 2. Fetch traveler
        traveler_stmt = select(User).where(User.telegram_id == traveler_telegram_id)
        t_res = await session.execute(traveler_stmt)
        traveler = t_res.scalar_one_or_none()

        # 3. Fetch trip
        trip_stmt = select(TravelTrip).where(TravelTrip.id == trip_id)
        tr_res = await session.execute(trip_stmt)
        trip = tr_res.scalar_one_or_none()

        if not (parcel and sender and traveler and trip):
            await callback.answer("Ошибка данных сделки.", show_alert=True)
            return

        # 4. Create or fetch MatchDeal
        deal = MatchDeal(
            trip_id=trip.id,
            parcel_id=parcel.id,
            traveler_id=traveler.id,
            sender_id=sender.id,
            agreed_price=parcel.budget_amount,
            status=DealStatus.ACCEPTED
        )
        session.add(deal)

        # Mark parcel as matched
        parcel.status = ParcelStatus.MATCHED
        await session.commit()

        # 5. Send safe contact to SENDER
        sender_text = (
            f"🎉 <b>ПОПУТЧИК НАЙДЕН ДЛЯ ВАШЕЙ ПОСЫЛКИ!</b>\n\n"
            f"Попутчик <b>{traveler.full_name}</b> (@{traveler.username or 'без username'}) "
            f"согласился взять вашу посылку по маршруту <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>!\n\n"
            f"✈️ Дата рейса попутчика: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\n"
            f"💰 Вознаграждение: <b>{int(parcel.budget_amount)} {parcel.currency}</b>\n\n"
            f"🔒 <b>БЕЗОПАСНЫЙ ПЕРВЫЙ КОНТАКТ:</b>\n"
            f"Ваш телефонный номер скрыт. Нажмите кнопку ниже, чтобы начать диалог в Telegram напрямую.\n\n"
            f"<i>⚠️ Напоминание: передавайте посылку исключительно в открытом виде для досмотра!</i>"
        )

        try:
            await bot.send_message(
                chat_id=sender.telegram_id,
                text=sender_text,
                reply_markup=get_safe_contact_keyboard(traveler.username, traveler.telegram_id),
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning(f"Could not notify sender {sender.telegram_id}: {e}")

        # 6. Send safe contact to TRAVELER
        traveler_reply = (
            f"✅ <b>ВЫ ОТКЛИКНУЛИСЬ НА ЗАЯВКУ!</b>\n\n"
            f"Отправитель: <b>{sender.full_name}</b> (@{sender.username or 'без username'})\n"
            f"Маршрут: <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>\n"
            f"Вознаграждение: <b>{int(parcel.budget_amount)} {parcel.currency}</b>\n\n"
            f"🔒 <b>Свяжитесь с отправителем для обсуждения деталей:</b>\n"
            f"Телефонные номера не разглашаются в целях защиты приватности."
        )

        await callback.message.edit_text(
            traveler_reply,
            reply_markup=get_safe_contact_keyboard(sender.username, sender.telegram_id),
            parse_mode="HTML"
        )
        await callback.answer("Отклик отправлен отправителю!")


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
            f"Маршрут: <b>{trip.from_city.title()} ➔ {trip.to_city.title()}</b>\n"
            f"Дата: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\n"
            f"Вместимость: {trip.capacity_type.value}\n"
            f"Вознаграждение: {trip.reward_note}\n"
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
            f"Маршрут: <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>\n"
            f"Крайний срок: <b>{parcel.deadline_date.strftime('%d.%m.%Y')}</b>\n"
            f"Категория: {parcel.category.value}\n"
            f"Описание: {parcel.description}\n"
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
                    TravelTrip.departure_date >= date.today()
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
                    ParcelRequest.deadline_date >= date.today()
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
                f"• <b>{t.from_city.title()} ➔ {t.to_city.title()}</b> "
                f"| {t.departure_date.strftime('%d.%m')} "
                f"| {t.reward_note}\n"
            )
    else:
        text += "<i>Пока нет активных рейсов. Будьте первым, кто добавит поездку!</i>\n"

    text += "\n📦 <b>ОТКРЫТЫЕ ПОСЫЛКИ ДЛЯ ДОСТАВКИ:</b>\n"
    if parcels:
        for p in parcels:
            text += (
                f"• <b>{p.from_city.title()} ➔ {p.to_city.title()}</b> "
                f"| до {p.deadline_date.strftime('%d.%m')} "
                f"| {int(p.budget_amount)} {p.currency} "
                f"({p.category.value})\n"
            )
    else:
        text += "<i>Пока нет открытых заявок на доставку.</i>\n"

    text += (
        "\n💡 <i>Совет: Чтобы получить персональное предложение, просто опубликуйте свой рейс или создайте посылку. "
        "Умный алгоритм сопоставит маршруты автоматически!</i>"
    )

    await message.answer(text, reply_markup=get_main_menu_keyboard(), parse_mode="HTML")
