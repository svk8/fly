"""
Inline Keyboards for Telegram Bot.
"""

from datetime import datetime, timedelta
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from database.models import CapacityType, ParcelCategory, UserRole


def get_disclaimer_keyboard() -> InlineKeyboardMarkup:
    """Security disclaimer acceptance keyboard."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="✅ Принимаю правила и согласен на досмотр",
                    callback_data="accept_disclaimer"
                )
            ],
            [
                InlineKeyboardButton(
                    text="📖 Подробнее о безопасности",
                    callback_data="read_safety_rules"
                )
            ]
        ]
    )


def get_role_selector_keyboard(current_role: UserRole = UserRole.BOTH) -> InlineKeyboardMarkup:
    """Switch user role."""
    def marker(r: UserRole) -> str:
        return "✓ " if r == current_role else ""

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text=f"{marker(UserRole.TRAVELER)}✈️ Я лечу (Попутчик)",
                    callback_data="set_role:traveler"
                )
            ],
            [
                InlineKeyboardButton(
                    text=f"{marker(UserRole.SENDER)}📦 Мне нужно передать (Отправитель)",
                    callback_data="set_role:sender"
                )
            ],
            [
                InlineKeyboardButton(
                    text=f"{marker(UserRole.BOTH)}🔄 Совмещаю обе роли",
                    callback_data="set_role:both"
                )
            ]
        ]
    )


def get_capacity_keyboard() -> InlineKeyboardMarkup:
    """Select traveler package capacity."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="📄 Документы / Конверт (до 0.5 кг)",
                    callback_data=f"capacity:{CapacityType.DOCUMENTS.value}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="🎒 Небольшой пакет / рюкзак (до 2 кг)",
                    callback_data=f"capacity:{CapacityType.SMALL_BAG.value}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="🧳 Часть чемодана (до 5-10 кг)",
                    callback_data=f"capacity:{CapacityType.MEDIUM_LUGGAGE.value}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="📦 Целый чемодан (до 23 кг)",
                    callback_data=f"capacity:{CapacityType.FULL_SUITCASE.value}"
                )
            ]
        ]
    )


def get_parcel_category_keyboard() -> InlineKeyboardMarkup:
    """Select parcel category for sender."""
    categories = [
        ("📄 Документы и письма", ParcelCategory.DOCUMENTS),
        ("💻 Электроника и гаджеты", ParcelCategory.ELECTRONICS),
        ("👕 Одежда и обувь", ParcelCategory.CLOTHES),
        ("💊 Разрешенные медикаменты", ParcelCategory.MEDICINE),
        ("🎁 Подарки и сувениры", ParcelCategory.GIFTS),
        ("📦 Другое", ParcelCategory.OTHER),
    ]
    buttons = [
        [InlineKeyboardButton(text=label, callback_data=f"cat:{cat.name}")]
        for label, cat in categories
    ]
    return InlineKeyboardMarkup(inline_keyboard=buttons)


def get_quick_dates_keyboard() -> InlineKeyboardMarkup:
    """Quick date selector for convenience."""
    today = datetime.now()
    d1 = today.strftime("%Y-%m-%d")
    d2 = (today + timedelta(days=1)).strftime("%Y-%m-%d")
    d3 = (today + timedelta(days=3)).strftime("%Y-%m-%d")
    d7 = (today + timedelta(days=7)).strftime("%Y-%m-%d")

    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="Сегодня", callback_data=f"qdate:{d1}"),
                InlineKeyboardButton(text="Завтра", callback_data=f"qdate:{d2}")
            ],
            [
                InlineKeyboardButton(text="Через 3 дня", callback_data=f"qdate:{d3}"),
                InlineKeyboardButton(text="Через неделю", callback_data=f"qdate:{d7}")
            ]
        ]
    )


def get_confirm_trip_keyboard() -> InlineKeyboardMarkup:
    """Confirmation for trip submission."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚀 Опубликовать рейс", callback_data="confirm_trip_yes"),
                InlineKeyboardButton(text="❌ Отменить", callback_data="confirm_trip_no")
            ]
        ]
    )


def get_confirm_parcel_keyboard() -> InlineKeyboardMarkup:
    """Confirmation for parcel submission."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚀 Запустить поиск попутчиков", callback_data="confirm_parcel_yes"),
                InlineKeyboardButton(text="❌ Отменить", callback_data="confirm_parcel_no")
            ]
        ]
    )


def get_match_action_keyboard(parcel_id: int, trip_id: int) -> InlineKeyboardMarkup:
    """Notification keyboard sent to traveler when match is found."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🤝 Откликнуться на заявку",
                    callback_data=f"respond_match:{parcel_id}:{trip_id}"
                )
            ],
            [
                InlineKeyboardButton(
                    text="❌ Пропустить",
                    callback_data=f"dismiss_match:{parcel_id}"
                )
            ]
        ]
    )


def get_safe_contact_keyboard(telegram_username: str | None, user_id: int) -> InlineKeyboardMarkup:
    """
    Generate privacy-safe contact button.
    Crucial security requirement: Does NOT disclose telephone numbers!
    Directs to Telegram @username or deep-link chat.
    """
    if telegram_username:
        url = f"https://t.me/{telegram_username.replace('@', '')}"
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text="💬 Написать в Telegram (без раскрытия номера)",
                        url=url
                    )
                ]
            ]
        )
    else:
        # User without public @username: deep link to user profile
        return InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(
                        text=f"💬 Написать в Telegram (ID: {user_id})",
                        url=f"tg://user?id={user_id}"
                    )
                ]
            ]
        )


def get_item_actions_keyboard(item_type: str, item_id: int) -> InlineKeyboardMarkup:
    """Delete or close active trip or parcel."""
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🗑️ Удалить / Закрыть заявку",
                    callback_data=f"delete_{item_type}:{item_id}"
                )
            ]
        ]
    )


def get_tma_launch_inline_keyboard() -> InlineKeyboardMarkup:
    """Button to launch Telegram Mini App (TMA)."""
    from aiogram.types import WebAppInfo
    from config import settings
    url = settings.WEBAPP_URL or "https://example.com"
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(
                    text="🚀 Открыть приложение (TMA)",
                    web_app=WebAppInfo(url=url)
                )
            ]
        ]
    )

