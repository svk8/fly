from datetime import datetime
from zoneinfo import ZoneInfo
from config import settings


def today():
    return datetime.now(ZoneInfo(settings.TIMEZONE)).date()
