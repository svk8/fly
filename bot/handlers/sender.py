from services.clock import today
"""
Sender Handlers: Parcel request creation FSM, photo handling, and auto-matching trigger.
"""

from datetime import datetime, date
import logging
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery, ContentType
from aiogram.fsm.context import FSMContext
from sqlalchemy import select, update

from database.db import get_db_session
from database.models import User, ParcelRequest, ParcelCategory, ParcelStatus
from states.sender import SenderStates
from keyboards.reply import (
    get_main_menu_keyboard,
    get_cancel_keyboard,
    get_skip_or_cancel_keyboard
)
from keyboards.inline import (
    get_parcel_category_keyboard,
    get_quick_dates_keyboard,
    get_confirm_parcel_keyboard,
    get_item_actions_keyboard
)
from services.matcher import normalize_city, find_matching_trips_for_parcel
from handlers.traveler import parse_date_input

logger = logging.getLogger(__name__)
router = Router(name="sender_router")


@router.message(F.text == "📦 Передать посылку")
async def start_sender_flow(message: Message, state: FSMContext) -> None:
    """Initiate parcel registration flow."""
    await state.clear()
    await state.set_state(SenderStates.waiting_from_city)

    await message.answer(
        "📦 <b>ОТПРАВКА ПОСЫЛКИ / ДОКУМЕНТОВ</b>\n\n"
        "Шаг 1 из 7: Укажите <b>город отправления</b> (откуда забрать, например: <i>Москва</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_from_city)
async def process_sender_from_city(message: Message, state: FSMContext) -> None:
    """Process sender origin city."""
    city = message.text.strip()
    if len(city) < 2:
        await message.answer("Пожалуйста, укажите корректное название города:")
        return

    await state.update_data(from_city=city)
    await state.set_state(SenderStates.waiting_to_city)

    await message.answer(
        f"Откуда: <b>{city}</b>\n\n"
        f"Шаг 2 из 7: Укажите <b>город назначения</b> (куда доставить, например: <i>Ереван</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_to_city)
async def process_sender_to_city(message: Message, state: FSMContext) -> None:
    """Process destination city."""
    city = message.text.strip()
    data = await state.get_data()
    if normalize_city(city) == normalize_city(data.get("from_city", "")):
        await message.answer("Город назначения не может совпадать с городом отправления. Укажите другой:")
        return

    await state.update_data(to_city=city)
    await state.set_state(SenderStates.waiting_deadline)

    await message.answer(
        f"Маршрут: <b>{data.get('from_city')} ➔ {city}</b>\n\n"
        f"Шаг 3 из 7: До какой даты необходимо доставить? (<b>Крайний срок</b> в формате <i>ДД.ММ.ГГГГ</i>):",
        reply_markup=get_quick_dates_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(SenderStates.waiting_deadline, F.data.startswith("qdate:"))
async def process_sender_quick_date(callback: CallbackQuery, state: FSMContext) -> None:
    """Process quick deadline date."""
    date_str = callback.data.split(":")[1]
    parsed_date = parse_date_input(date_str)
    if not parsed_date or parsed_date < today():
        await callback.answer("Выбранная дата в прошлом. Выберите актуальную дату.", show_alert=True)
        return

    await state.update_data(deadline_date=parsed_date.isoformat())
    await state.set_state(SenderStates.waiting_category)

    await callback.message.delete()
    await callback.message.answer(
        f"📅 Срок доставки: <b>до {parsed_date.strftime('%d.%m.%Y')}</b>\n\n"
        f"Шаг 4 из 7: Выберите <b>категорию отправления</b>:",
        reply_markup=get_parcel_category_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(SenderStates.waiting_deadline)
async def process_sender_text_date(message: Message, state: FSMContext) -> None:
    """Process typed deadline date."""
    parsed_date = parse_date_input(message.text)
    if not parsed_date:
        await message.answer("Формат даты не распознан. Введите дату в виде <b>ДД.ММ.ГГГГ</b> (например: <i>10.11.2026</i>):", parse_mode="HTML")
        return

    if parsed_date < today():
        await message.answer("Срок не может быть в прошлом. Введите будущую дату:")
        return

    await state.update_data(deadline_date=parsed_date.isoformat())
    await state.set_state(SenderStates.waiting_category)

    await message.answer(
        f"📅 Срок доставки: <b>до {parsed_date.strftime('%d.%m.%Y')}</b>\n\n"
        f"Шаг 4 из 7: Выберите <b>категорию отправления</b>:",
        reply_markup=get_parcel_category_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(SenderStates.waiting_category, F.data.startswith("cat:"))
async def process_sender_category(callback: CallbackQuery, state: FSMContext) -> None:
    """Process category selection."""
    cat_key = callback.data.split(":")[1]
    category = ParcelCategory[cat_key]

    await state.update_data(
        category=category.name,
        category_label=category.value
    )
    await state.set_state(SenderStates.waiting_description)

    await callback.message.delete()
    await callback.message.answer(
        f"Категория: <b>{category.value}</b>\n\n"
        f"Шаг 5 из 7: Подробно опишите <b>содержимое и габариты</b> посылки:\n"
        f"<i>(Пример: «Договор в файле А4, 20 листов, вес около 150 грамм» или «Детская куртка и ботинки, до 2 кг»):</i>",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(SenderStates.waiting_description)
async def process_sender_description(message: Message, state: FSMContext) -> None:
    """Process parcel description."""
    desc = message.text.strip()
    if len(desc) < 5:
        await message.answer("Пожалуйста, опишите посылку чуть подробнее для попутчика (от 5 символов):")
        return

    await state.update_data(description=desc)
    await state.set_state(SenderStates.waiting_photo)

    await message.answer(
        "Шаг 6 из 7: Прикрепите <b>фотографию посылки</b> (или нажмите кнопку «Пропустить фото»):\n\n"
        "<i>Напоминание: фото в открытом виде повышает доверие попутчиков в 3 раза!</i>",
        reply_markup=get_skip_or_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_photo, F.photo)
async def process_sender_photo(message: Message, state: FSMContext) -> None:
    """Handle uploaded photo."""
    photo_file_id = message.photo[-1].file_id
    await state.update_data(photo_file_id=photo_file_id)
    await state.set_state(SenderStates.waiting_budget)

    await message.answer(
        "📷 Фото успешно прикреплено!\n\n"
        "Шаг 7 из 7: Укажите <b>размер вознаграждения попутчику в рублях</b> (только цифры, например: <i>1500</i> или <i>3000</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_photo, F.text == "⏩ Пропустить фото")
async def skip_sender_photo(message: Message, state: FSMContext) -> None:
    """Skip photo step."""
    await state.update_data(photo_file_id=None)
    await state.set_state(SenderStates.waiting_budget)

    await message.answer(
        "Шаг 7 из 7: Укажите <b>размер вознаграждения попутчику в рублях</b> (только цифры, например: <i>1500</i> или <i>3000</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_budget)
async def process_sender_budget(message: Message, state: FSMContext) -> None:
    """Process offered budget and show preview."""
    budget_raw = "".join(ch for ch in message.text if ch.isdigit() or ch == ".")
    try:
        budget = float(budget_raw)
        if budget <= 0:
            raise ValueError()
    except ValueError:
        await message.answer("Пожалуйста, введите положительную сумму вознаграждения цифрами (например: 2000):")
        return

    await state.update_data(budget_amount=budget)
    await state.set_state(SenderStates.confirm_parcel)

    data = await state.get_data()
    deadline_fmt = datetime.fromisoformat(data["deadline_date"]).strftime("%d.%m.%Y")

    summary_text = (
        f"📦 <b>ПРОВЕРЬТЕ ДАННЫЕ ЗАЯВКИ НА ДОСТАВКУ:</b>\n\n"
        f"📍 <b>Маршрут:</b> {data['from_city'].title()} ➔ {data['to_city'].title()}\n"
        f"📅 <b>Крайний срок:</b> {deadline_fmt}\n"
        f"🏷️ <b>Категория:</b> {data.get('category_label')}\n"
        f"📝 <b>Описание:</b> {data['description']}\n"
        f"💰 <b>Вознаграждение:</b> {int(budget)} RUB\n"
        f"📷 <b>Фотография:</b> {'Прикреплена' if data.get('photo_file_id') else 'Без фото'}\n\n"
        f"<i>При подтверждении система автоматически найдет подходящих попутчиков и отправит им Push-уведомление!</i>"
    )

    if data.get("photo_file_id"):
        await message.answer_photo(
            photo=data["photo_file_id"],
            caption=summary_text,
            reply_markup=get_confirm_parcel_keyboard(),
            parse_mode="HTML"
        )
    else:
        await message.answer(
            summary_text,
            reply_markup=get_confirm_parcel_keyboard(),
            parse_mode="HTML"
        )


@router.callback_query(SenderStates.confirm_parcel, F.data == "confirm_parcel_yes")
async def commit_parcel(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    """Save parcel and execute Smart Auto-Matching."""
    data = await state.get_data()
    telegram_id = callback.from_user.id

    async with get_db_session() as session:
        user_stmt = select(User).where(User.telegram_id == telegram_id)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()

        if not user:
            await callback.answer("Ошибка: пользователь не найден.", show_alert=True)
            return

        new_parcel = ParcelRequest(
            sender_id=user.id,
            from_city=normalize_city(data["from_city"]),
            to_city=normalize_city(data["to_city"]),
            deadline_date=datetime.fromisoformat(data["deadline_date"]).date(),
            category=ParcelCategory[data["category"]],
            description=data["description"],
            photo_file_id=data.get("photo_file_id"),
            budget_amount=data["budget_amount"],
            currency="RUB",
            status=ParcelStatus.SEARCHING
        )
        session.add(new_parcel)
        await session.flush()
        from services.notifications import enqueue_listing
        await enqueue_listing(session, "parcel", new_parcel.id)
        await session.commit()
        await session.refresh(new_parcel)

        # The outbox handles delivery; this count is only a preview for the sender.
        notified_travelers = len(await find_matching_trips_for_parcel(new_parcel))

    await state.clear()
    await callback.message.delete()

    text = (
        f"🚀 <b>Заявка на доставку успешно зарегистрирована!</b>\n\n"
        f"Маршрут: <b>{data['from_city'].title()} ➔ {data['to_city'].title()}</b>\n"
        f"Бюджет: <b>{int(data['budget_amount'])} RUB</b>\n\n"
    )

    if notified_travelers > 0:
        text += (
            f"🎯 <b>УМНЫЙ АВТО-МЭТЧИНГ СРАБОТАЛ!</b>\n"
            f"Найдено подходящих попутчиков на маршруте: <b>{notified_travelers}</b>.\n"
            f"Уведомления для попутчиков поставлены в очередь отправки. "
            f"Как только попутчик откликнется, бот пришлет вам защищенную ссылку на диалог!"
        )
    else:
        text += (
            f"Пока нет попутчиков с точным совпадением дат. "
            f"Как только кто-то добавит рейс по вашему маршруту, бот сразу уведомит его о вашей посылке!"
        )

    await callback.message.answer(text, reply_markup=get_main_menu_keyboard(), parse_mode="HTML")
    await callback.answer("Заявка создана!")


@router.callback_query(SenderStates.confirm_parcel, F.data == "confirm_parcel_no")
async def cancel_parcel_creation(callback: CallbackQuery, state: FSMContext) -> None:
    """Cancel parcel creation."""
    await state.clear()
    await callback.message.delete()
    await callback.message.answer("Регистрация посылки отменена.", reply_markup=get_main_menu_keyboard())
    await callback.answer()


@router.callback_query(F.data.startswith("delete_parcel:"))
async def handle_delete_parcel(callback: CallbackQuery) -> None:
    """Cancel an active parcel."""
    parcel_id = int(callback.data.split(":")[1])
    from services.marketplace import cancel_listing, MarketplaceError
    try:
        await cancel_listing(callback.from_user.id, "parcel", parcel_id)
    except MarketplaceError as error:
        await callback.answer(str(error), show_alert=True)
        return

    await callback.message.edit_text("❌ Заявка на посылку отменена и закрыта.")
    await callback.answer("Заявка закрыта")
