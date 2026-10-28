"""
Admin Panel & Moderation Handlers.
Allows administrators to manage users, ban violators, and inspect statistics.
"""

import logging
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery, InlineKeyboardMarkup, InlineKeyboardButton
from aiogram.filters import Command
from sqlalchemy import select, func, update

from config import settings
from database.db import get_db_session
from database.models import User, TravelTrip, ParcelRequest, DeliveryDeal, TripStatus, ParcelStatus

logger = logging.getLogger(__name__)
router = Router(name="admin_router")


def is_admin(user_id: int) -> bool:
    """Check if telegram ID belongs to an administrator."""
    return user_id in settings.admin_ids


@router.message(Command("admin"))
async def handle_admin_panel(message: Message) -> None:
    """Show admin dashboard with metrics and moderation controls."""
    if not is_admin(message.from_user.id):
        await message.answer("⛔ У вас нет доступа к панели администратора.")
        return

    async with get_db_session() as session:
        # Metrics count
        users_count = (await session.execute(select(func.count(User.id)))).scalar() or 0
        banned_count = (await session.execute(select(func.count(User.id)).where(User.is_banned == True))).scalar() or 0
        active_trips = (await session.execute(select(func.count(TravelTrip.id)).where(TravelTrip.status == TripStatus.ACTIVE))).scalar() or 0
        active_parcels = (await session.execute(select(func.count(ParcelRequest.id)).where(ParcelRequest.status == ParcelStatus.SEARCHING))).scalar() or 0
        total_deals = (await session.execute(select(func.count(DeliveryDeal.id)))).scalar() or 0

    text = (
        f"👑 <b>ПАНЕЛЬ АДМИНИСТРАТОРА CROWDSHIP</b>\n\n"
        f"👥 Всего пользователей: <b>{users_count}</b> (Заблокировано: {banned_count})\n"
        f"✈️ Активных рейсов: <b>{active_trips}</b>\n"
        f"📦 Открытых посылок: <b>{active_parcels}</b>\n"
        f"🤝 Совершенных сделок: <b>{total_deals}</b>\n\n"
        f"<b>Команды модерации:</b>\n"
        f"• <code>/ban &lt;ID&gt; [причина]</code> — заблокировать пользователя\n"
        f"• <code>/unban &lt;ID&gt;</code> — разблокировать пользователя\n"
        f"• <code>/users</code> — список последних зарегистрированных\n"
        f"• <code>/trips_all</code> — все активные рейсы"
    )

    kb = InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="👥 Список пользователей", callback_data="admin_list_users"),
                InlineKeyboardButton(text="🚫 Заблокированные", callback_data="admin_list_banned")
            ],
            [
                InlineKeyboardButton(text="🔄 Обновить статистику", callback_data="admin_refresh_stats")
            ]
        ]
    )

    await message.answer(text, reply_markup=kb, parse_mode="HTML")


@router.message(Command("ban"))
async def handle_ban_command(message: Message) -> None:
    """Ban user by Telegram ID or internal ID."""
    if not is_admin(message.from_user.id):
        return

    parts = message.text.split(maxsplit=2)
    if len(parts) < 2:
        await message.answer("Использование: <code>/ban &lt;telegram_id&gt; [причина]</code>", parse_mode="HTML")
        return

    try:
        target_id = int(parts[1])
    except ValueError:
        await message.answer("ID пользователя должен быть числом.")
        return

    reason = parts[2] if len(parts) > 2 else "Нарушение регламента безопасности сервиса"

    async with get_db_session() as session:
        stmt = (
            update(User)
            .where(User.telegram_id == target_id)
            .values(is_banned=True, ban_reason=reason)
        )
        res = await session.execute(stmt)

        if res.rowcount == 0:
            await message.answer(f"Пользователь с Telegram ID <code>{target_id}</code> не найден в базе.")
            return

    await message.answer(
        f"🚫 <b>Пользователь {target_id} успешно заблокирован!</b>\nПричина: <i>{reason}</i>",
        parse_mode="HTML"
    )


@router.message(Command("unban"))
async def handle_unban_command(message: Message) -> None:
    """Unban user by Telegram ID."""
    if not is_admin(message.from_user.id):
        return

    parts = message.text.split(maxsplit=1)
    if len(parts) < 2:
        await message.answer("Использование: <code>/unban &lt;telegram_id&gt;</code>", parse_mode="HTML")
        return

    try:
        target_id = int(parts[1])
    except ValueError:
        await message.answer("ID пользователя должен быть числом.")
        return

    async with get_db_session() as session:
        stmt = (
            update(User)
            .where(User.telegram_id == target_id)
            .values(is_banned=False, ban_reason=None)
        )
        res = await session.execute(stmt)

        if res.rowcount == 0:
            await message.answer(f"Пользователь с Telegram ID <code>{target_id}</code> не найден.")
            return

    await message.answer(f"✅ Пользователь <code>{target_id}</code> успешно разблокирован.", parse_mode="HTML")


@router.callback_query(F.data == "admin_refresh_stats")
async def handle_admin_refresh(callback: CallbackQuery) -> None:
    """Refresh admin stats."""
    if not is_admin(callback.from_user.id):
        await callback.answer("Нет доступа", show_alert=True)
        return

    await callback.message.delete()
    await handle_admin_panel(callback.message)
    await callback.answer("Статистика обновлена")
