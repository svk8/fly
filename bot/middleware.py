from aiogram import BaseMiddleware
from aiogram.types import CallbackQuery
from sqlalchemy import select
from database.db import get_db_session
from database.models import User


class AccountMiddleware(BaseMiddleware):
    async def __call__(self, handler, event, data):
        tg = getattr(event, "from_user", None)
        if tg:
            async with get_db_session() as session:
                user = await session.scalar(select(User).where(User.telegram_id == tg.id))
            is_callback = isinstance(event, CallbackQuery)
            value = event.data if is_callback else (event.text or "")
            allowed = value in ("accept_disclaimer", "read_safety_rules", "/rules", "🛡️ Правила безопасности") or value.startswith("/start")
            if user and user.is_banned:
                await event.answer("Доступ заблокирован.")
                return
            if not allowed and (not user or not user.disclaimer_accepted):
                await event.answer("Примите правила через /start.")
                return
        return await handler(event, data)
