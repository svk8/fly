"""
Reply Keyboards for Telegram Bot.
"""

from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
from config import settings


def get_main_menu_keyboard() -> ReplyKeyboardMarkup:
    """Standard bottom menu for navigation, with optional TMA WebApp button."""
    keyboard = []
    
    # If TMA WebApp URL is configured, offer a prominent launch button
    if settings.WEBAPP_URL:
        keyboard.append([
            KeyboardButton(
                text="🚀 Открыть приложение (TMA)",
                web_app=WebAppInfo(url=settings.WEBAPP_URL)
            )
        ])

    keyboard.extend([
        [
            KeyboardButton(text="✈️ Я лечу (Добавить рейс)"),
            KeyboardButton(text="📦 Передать посылку")
        ],
        [
            KeyboardButton(text="🔍 Поиск рейсов и посылок"),
            KeyboardButton(text="📋 Мои заявки и рейсы")
        ],
        [
            KeyboardButton(text="👤 Мой профиль"),
            KeyboardButton(text="🛡️ Правила безопасности")
        ]
    ])
    return ReplyKeyboardMarkup(
        keyboard=keyboard,
        resize_keyboard=True,
        input_field_placeholder="Выберите действие в меню..."
    )


def get_cancel_keyboard() -> ReplyKeyboardMarkup:
    """Cancel current FSM flow."""
    return ReplyKeyboardMarkup(
        keyboard=[[KeyboardButton(text="❌ Отменить")]],
        resize_keyboard=True,
        one_time_keyboard=True
    )


def get_skip_or_cancel_keyboard() -> ReplyKeyboardMarkup:
    """Skip optional step (e.g. photo) or cancel."""
    return ReplyKeyboardMarkup(
        keyboard=[
            [KeyboardButton(text="⏩ Пропустить фото")],
            [KeyboardButton(text="❌ Отменить")]
        ],
        resize_keyboard=True,
        one_time_keyboard=True
    )
