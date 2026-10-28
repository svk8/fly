"""
Traveler Handlers: Trip creation FSM, active trips management.
"""

from datetime import datetime, date
import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from sqlalchemy import select, update

from database.db import get_db_session
from database.models import User, TravelTrip, CapacityType, TripStatus
from states.traveler import TravelerStates
from keyboards.reply import get_main_menu_keyboard, get_cancel_keyboard
from keyboards.inline import (
    get_capacity_keyboard,
    get_quick_dates_keyboard,
    get_confirm_trip_keyboard,
    get_item_actions_keyboard
)
from services.matcher import normalize_city, find_matching_parcels_for_trip

logger = logging.getLogger(__name__)
router = Router(name="traveler_router")


def parse_date_input(text: str) -> date | None:
    """Parse various Russian/ISO date formats."""
    text = text.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d.%m"):
        try:
            d = datetime.strptime(text, fmt).date()
            if fmt == "%d.%m":
                d = d.replace(year=datetime.now().year)
                if d < date.today():
                    d = d.replace(year=datetime.now().year + 1)
            return d
        except ValueError:
            continue
    return None


@router.message(F.text == "✈️ Я лечу (Добавить рейс)")
async def start_traveler_flow(message: Message, state: FSMContext) -> None:
    """Initiate traveler flight registration flow."""
    await state.clear()
    await state.set_state(TravelerStates.waiting_from_city)

    await message.answer(
        "✈️ <b>ДОБАВЛЕНИЕ НОВОГО РЕЙСА</b>\n\n"
        "Шаг 1 из 5: Укажите <b>город вылета / отправления</b> (например: <i>Москва</i> или <i>Стамбул</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(TravelerStates.waiting_from_city)
async def process_from_city(message: Message, state: FSMContext) -> None:
    """Process origin city."""
    city = message.text.strip()
    if len(city) < 2:
        await message.answer("Пожалуйста, укажите корректное название города (минимум 2 буквы):")
        return

    await state.update_data(from_city=city)
    await state.set_state(TravelerStates.waiting_to_city)

    await message.answer(
        f"Откуда: <b>{city}</b>\n\n"
        f"Шаг 2 из 5: Укажите <b>город назначения / прилета</b> (например: <i>Ереван</i>, <i>Тбилиси</i>, <i>Дубай</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(TravelerStates.waiting_to_city)
async def process_to_city(message: Message, state: FSMContext) -> None:
    """Process destination city."""
    city = message.text.strip()
    data = await state.get_data()
    if normalize_city(city) == normalize_city(data.get("from_city", "")):
        await message.answer("Город назначения не может совпадать с городом отправления. Укажите другой город:")
        return

    await state.update_data(to_city=city)
    await state.set_state(TravelerStates.waiting_date)

    await message.answer(
        f"Маршрут: <b>{data.get('from_city')} ➔ {city}</b>\n\n"
        f"Шаг 3 из 5: Укажите <b>дату вылета</b> (в формате <i>ДД.ММ.ГГГГ</i> или выберите быструю кнопку):",
        reply_markup=get_quick_dates_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(TravelerStates.waiting_date, F.data.startswith("qdate:"))
async def process_quick_date(callback: CallbackQuery, state: FSMContext) -> None:
    """Process quick date selection."""
    date_str = callback.data.split(":")[1]
    parsed_date = parse_date_input(date_str)
    if not parsed_date or parsed_date < date.today():
        await callback.answer("Выбранная дата уже прошла. Выберите актуальную дату.", show_alert=True)
        return

    await state.update_data(departure_date=parsed_date.isoformat())
    await state.set_state(TravelerStates.waiting_capacity)

    await callback.message.delete()
    await callback.message.answer(
        f"📅 Дата вылета: <b>{parsed_date.strftime('%d.%m.%Y')}</b>\n\n"
        f"Шаг 4 из 5: Выберите <b>свободное место / тип груза</b>, который готовы взять:",
        reply_markup=get_capacity_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(TravelerStates.waiting_date)
async def process_text_date(message: Message, state: FSMContext) -> None:
    """Process manually typed date."""
    parsed_date = parse_date_input(message.text)
    if not parsed_date:
        await message.answer(
            "Не удалось распознать дату. Введите дату в формате <b>ДД.ММ.ГГГГ</b> (например: <i>15.11.2026</i>):",
            parse_mode="HTML"
        )
        return

    if parsed_date < date.today():
        await message.answer("Дата вылета не может быть в прошлом. Введите будущую дату:")
        return

    await state.update_data(departure_date=parsed_date.isoformat())
    await state.set_state(TravelerStates.waiting_capacity)

    await message.answer(
        f"📅 Дата вылета: <b>{parsed_date.strftime('%d.%m.%Y')}</b>\n\n"
        f"Шаг 4 из 5: Выберите <b>свободное место / тип груза</b>, который готовы взять:",
        reply_markup=get_capacity_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(TravelerStates.waiting_capacity, F.data.startswith("capacity:"))
async def process_capacity(callback: CallbackQuery, state: FSMContext) -> None:
    """Process luggage capacity selection."""
    cap_val = callback.data.split(":")[1]
    cap_type = CapacityType(cap_val)

    weights = {
        CapacityType.DOCUMENTS: 0.5,
        CapacityType.SMALL_BAG: 2.0,
        CapacityType.MEDIUM_LUGGAGE: 8.0,
        CapacityType.FULL_SUITCASE: 23.0
    }

    labels = {
        CapacityType.DOCUMENTS: "📄 Только документы (до 0.5 кг)",
        CapacityType.SMALL_BAG: "🎒 Небольшой пакет/рюкзак (до 2 кг)",
        CapacityType.MEDIUM_LUGGAGE: "🧳 Часть чемодана (до 8 кг)",
        CapacityType.FULL_SUITCASE: "📦 Отдельный чемодан (до 23 кг)"
    }

    await state.update_data(
        capacity_type=cap_type.value,
        max_weight_kg=weights.get(cap_type, 2.0),
        capacity_label=labels.get(cap_type)
    )
    await state.set_state(TravelerStates.waiting_reward)

    await callback.message.delete()
    await callback.message.answer(
        f"Вместимость: <b>{labels.get(cap_type)}</b>\n\n"
        f"Шаг 5 из 5: Укажите <b>желаемое вознаграждение</b> (например: <i>«2000 руб»</i>, <i>«$30»</i> или <i>«По договоренности»</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(TravelerStates.waiting_reward)
async def process_reward(message: Message, state: FSMContext) -> None:
    """Process desired reward and show confirmation summary."""
    reward = message.text.strip()
    await state.update_data(reward_note=reward)
    await state.set_state(TravelerStates.confirm_trip)

    data = await state.get_data()
    dep_date = datetime.fromisoformat(data["departure_date"]).strftime("%d.%m.%Y")

    summary_text = (
        f"✈️ <b>ПРОВЕРЬТЕ ДАННЫЕ ВАШЕГО РЕЙСА:</b>\n\n"
        f"📍 <b>Маршрут:</b> {data['from_city'].title()} ➔ {data['to_city'].title()}\n"
        f"📅 <b>Дата вылета:</b> {dep_date}\n"
        f"🎒 <b>Вместимость:</b> {data.get('capacity_label')}\n"
        f"💰 <b>Вознаграждение:</b> {reward}\n\n"
        f"<i>При публикации рейса бот автоматически начнет искать подходящие посылки отправителей и пришлет уведомление.</i>"
    )

    await message.answer(
        summary_text,
        reply_markup=get_confirm_trip_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(TravelerStates.confirm_trip, F.data == "confirm_trip_yes")
async def commit_trip(callback: CallbackQuery, state: FSMContext) -> None:
    """Save trip to database and run immediate match search."""
    data = await state.get_data()
    telegram_id = callback.from_user.id

    async with get_db_session() as session:
        user_stmt = select(User).where(User.telegram_id == telegram_id)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()

        if not user:
            await callback.answer("Ошибка: пользователь не найден.", show_alert=True)
            return

        new_trip = TravelTrip(
            user_id=user.id,
            from_city=normalize_city(data["from_city"]),
            to_city=normalize_city(data["to_city"]),
            departure_date=datetime.fromisoformat(data["departure_date"]).date(),
            capacity_type=CapacityType(data["capacity_type"]),
            max_weight_kg=data["max_weight_kg"],
            reward_note=data["reward_note"],
            status=TripStatus.ACTIVE
        )
        session.add(new_trip)
        await session.commit()
        await session.refresh(new_trip)

        # Immediate search for existing parcels
        matched_parcels = await find_matching_parcels_for_trip(new_trip)

    await state.clear()
    await callback.message.delete()

    success_text = (
        f"✅ <b>Ваш рейс успешно опубликован!</b>\n\n"
        f"Маршрут: <b>{data['from_city'].title()} ➔ {data['to_city'].title()}</b>\n"
        f"Как только отправитель создаст подходящую посылку, бот мгновенно уведомит вас.\n\n"
    )

    if matched_parcels:
        success_text += (
            f"🎯 <b>Прямо сейчас уже есть {len(matched_parcels)} заявок на этот маршрут!</b>\n"
            f"Перейдите в раздел «Поиск рейсов и посылок», чтобы связаться с отправителями."
        )

    await callback.message.answer(
        success_text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer("Рейс сохранен!")


@router.callback_query(TravelerStates.confirm_trip, F.data == "confirm_trip_no")
async def cancel_trip_creation(callback: CallbackQuery, state: FSMContext) -> None:
    """Cancel trip creation."""
    await state.clear()
    await callback.message.delete()
    await callback.message.answer("Публикация рейса отменена.", reply_markup=get_main_menu_keyboard())
    await callback.answer()


@router.callback_query(F.data.startswith("delete_trip:"))
async def handle_delete_trip(callback: CallbackQuery) -> None:
    """Cancel an active trip."""
    trip_id = int(callback.data.split(":")[1])
    async with get_db_session() as session:
        stmt = (
            update(TravelTrip)
            .where(TravelTrip.id == trip_id)
            .values(status=TripStatus.CANCELLED)
        )
        await session.execute(stmt)

    await callback.message.edit_text("❌ Рейс успешно отменен и удален из активного поиска.")
    await callback.answer("Рейс отменен")
