"""Keep the selected listing when a visitor moves from the public site to Telegram."""
import re
from urllib.parse import urlencode, urlsplit, urlunsplit
from aiogram.types import InlineKeyboardButton, InlineKeyboardMarkup, WebAppInfo
from config import settings


def entry_params(payload):
    match = re.fullmatch(r'(parcel|trip)_([1-9]\d{0,17})', payload)
    if match:
        return {'listingType': match[1], 'listingId': match[2]}
    if payload in ('post_parcel', 'post_trip', 'deals'):
        return {'tab': payload}
    return None


async def send_entry(message, payload):
    params = entry_params(payload)
    if params is None or not settings.WEBAPP_URL:
        return
    parts = urlsplit(settings.WEBAPP_URL)
    url = urlunsplit((parts.scheme, parts.netloc, parts.path or '/', urlencode(params), ''))
    label = 'Открыть выбранную заявку' if 'listingId' in params else 'Продолжить в приложении'
    await message.answer('Продолжите в приложении внутри Telegram: здесь доступны контакты, публикация и отклики.',
        reply_markup=InlineKeyboardMarkup(inline_keyboard=[[InlineKeyboardButton(text=label, web_app=WebAppInfo(url=url))]]))
