"""
Common Handlers: /start, Disclaimer Acceptance, Profile, Safety Rules, and Navigation.
"""

from html import escape
from datetime import datetime
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from sqlalchemy import select, update

from database.db import get_db_session
from database.models import User, UserRole
from services.bot_entry import entry_params, send_entry
from keyboards.reply import get_main_menu_keyboard
from keyboards.inline import (
    get_disclaimer_keyboard,
    get_role_selector_keyboard
)

router = Router(name="common_router")

SAFETY_TEXT = (
    "🛡️ <b>ПРАВИЛА БЕЗОПАСНОСТИ И ДОСМОТРА ПОСЫЛОК (КРАУДШИППИНГ)</b>\n\n"
    "1. <b>Осмотр только в открытом виде:</b>\n"
    "Попутчик <u>обязан</u> лично видеть, что именно он берет на борт. "
    "Никогда не соглашайтесь на передачу упакованных «сюрпризов» или запечатанных скотчем коробок без предварительного вскрытия!\n\n"
    "2. <b>Запрещенные к перевозке предметы:</b>\n"
    "• Оружие, боеприпасы и спецсредства;\n"
    "• Наркотические и психотропные вещества;\n"
    "• Лекарства без оригинальной упаковки или требующие рецепта;\n"
    "• Литиевые аккумуляторы высокой емкости в багаже;\n"
    "• Скоропортящиеся продукты питания без сертификатов;\n"
    "• Валюта свыше таможенного лимита без декларации.\n\n"
    "3. <b>Безопасность личных данных:</b>\n"
    "Мы не передаем ваши телефонные номера третьим лицам. Связь осуществляется внутри Telegram.\n\n"
    "4. <b>Вознаграждение:</b>\n"
    "Оплата производится по взаимной договоренности при личной встрече или безопасными методами после осмотра посылки."
)


@router.message(CommandStart())
async def handle_start(message: Message, state: FSMContext) -> None:
    """Handle /start command with user registration and disclaimer verification."""
    await state.clear()
    payload = (message.text or '').partition(' ')[2].strip()
    if entry_params(payload):
        await state.update_data(entry=payload)
    telegram_user = message.from_user
    if not telegram_user:
        return

    async with get_db_session() as session:
        stmt = select(User).where(User.telegram_id == telegram_user.id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            # Register new user
            user = User(
                telegram_id=telegram_user.id,
                username=telegram_user.username,
                full_name=telegram_user.full_name or "Пользователь",
                role=UserRole.BOTH,
                disclaimer_accepted=False
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

        # Check if disclaimer is accepted
        if not user.disclaimer_accepted:
            welcome_text = (
                f"👋 Здравствуйте, <b>{escape(telegram_user.first_name)}</b>!\n\n"
                f"Добро пожаловать в сервис <b>P2P-доставки посылок и документов через путешественников</b>!\n\n"
                f"⚠️ <b>ВНИМАНИЕ: ПРАВИЛА БЕЗОПАСНОСТИ</b>\n"
                f"Для использования сервиса вы обязаны принять регламент безопасности:\n\n"
                f"• Попутчик <b>всегда осматривает посылку в открытом виде</b> перед приемом.\n"
                f"• Передача запечатанных коробок строго запрещена.\n"
                f"• Запрещены любые нелегальные, опасные и рецептурные грузы.\n\n"
                f"Пожалуйста, подтвердите согласие для продолжения:"
            )
            await message.answer(
                welcome_text,
                reply_markup=get_disclaimer_keyboard(),
                parse_mode="HTML"
            )
            return

    # If disclaimer already accepted, show main menu
    await message.answer(
        f"👋 Рады видеть вас снова, <b>{escape(telegram_user.first_name)}</b>!\n"
        f"Чем вы хотите заняться сегодня?",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="HTML"
    )

    if entry_params(payload):
        await send_entry(message, payload)
        await state.set_data({})


@router.callback_query(F.data == "accept_disclaimer")
async def handle_accept_disclaimer(callback: CallbackQuery, state: FSMContext | None = None) -> None:
    """Handle user accepting security disclaimer."""
    telegram_id = callback.from_user.id

    async with get_db_session() as session:
        stmt = (
            update(User)
            .where(User.telegram_id == telegram_id)
            .values(
                disclaimer_accepted=True,
                disclaimer_accepted_at=datetime.utcnow()
            )
        )
        await session.execute(stmt)

    await callback.message.delete()
    await callback.message.answer(
        "✅ <b>Правила безопасности приняты!</b>\n\n"
        "Выберите вашу основную роль (ее всегда можно сменить в профиле):",
        reply_markup=get_role_selector_keyboard(),
        parse_mode="HTML"
    )
    if state is not None:
        data = await state.get_data()
        payload = data.pop('entry', '')
        if entry_params(payload):
            await send_entry(callback.message, payload)
            await state.set_data(data)
    await callback.answer()


@router.callback_query(F.data == "read_safety_rules")
async def handle_inline_safety_rules(callback: CallbackQuery) -> None:
    """Read safety rules in detail."""
    await callback.message.answer(SAFETY_TEXT, parse_mode="HTML")
    await callback.answer()


@router.callback_query(F.data.startswith("set_role:"))
async def handle_role_selection(callback: CallbackQuery) -> None:
    """Set or switch user role."""
    role_str = callback.data.split(":")[1]
    telegram_id = callback.from_user.id

    new_role = UserRole(role_str)

    async with get_db_session() as session:
        stmt = (
            update(User)
            .where(User.telegram_id == telegram_id)
            .values(role=new_role)
        )
        await session.execute(stmt)

    role_titles = {
        UserRole.TRAVELER: "✈️ Попутчик (Я лечу)",
        UserRole.SENDER: "📦 Отправитель (Мне нужно передать)",
        UserRole.BOTH: "🔄 Совмещаю обе роли"
    }

    await callback.message.delete()
    await callback.message.answer(
        f"🎉 Ваша роль обновлена: <b>{role_titles.get(new_role)}</b>\n\n"
        f"Используйте кнопки меню внизу экрана для добавления рейсов или отправки посылок.",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer("Роль сохранена!")


@router.message(F.text == "🛡️ Правила безопасности")
@router.message(Command("rules"))
async def handle_rules_menu(message: Message) -> None:
    """Display safety instructions."""
    await message.answer(SAFETY_TEXT, parse_mode="HTML")


@router.message(F.text == "👤 Мой профиль")
@router.message(Command("profile"))
async def handle_profile(message: Message) -> None:
    """Show user profile information and role switcher."""
    telegram_id = message.from_user.id

    async with get_db_session() as session:
        stmt = select(User).where(User.telegram_id == telegram_id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            await message.answer("Профиль не найден. Пожалуйста, отправьте команду /start")
            return

        role_labels = {
            UserRole.TRAVELER: "✈️ Попутчик (беру посылки в дорогу)",
            UserRole.SENDER: "📦 Отправитель (ищу попутчиков)",
            UserRole.BOTH: "🔄 Обе роли (летаю и отправляю)"
        }

        profile_text = (
            f"👤 <b>ВАШ ПРОФИЛЬ</b>\n\n"
            f"Имя: <b>{escape(user.full_name)}</b>\n"
            f"Username: @{user.username or 'не указан'}\n"
            f"Telegram ID: <code>{user.telegram_id}</code>\n\n"
            "⭐ Оценки пока недоступны\n"
            f"📦 Завершено доставок: <b>{user.completed_deliveries}</b>\n"
            f"🛡️ Правила досмотра: {'✅ Приняты' if user.disclaimer_accepted else '❌ Не приняты'}\n\n"
            f"Текущая роль: <b>{role_labels.get(user.role, 'Не указана')}</b>\n\n"
            f"<i>Вы можете переключить роль в любой момент:</i>"
        )

        await message.answer(
            profile_text,
            reply_markup=get_role_selector_keyboard(user.role),
            parse_mode="HTML"
        )


@router.message(F.text == "❌ Отменить")
async def handle_cancel(message: Message, state: FSMContext) -> None:
    """Cancel any active FSM state and return to main menu."""
    await state.clear()
    await message.answer(
        "Действие отменено. Вы вернулись в главное меню.",
        reply_markup=get_main_menu_keyboard()
    )
