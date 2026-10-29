"""Explicit public projections: no Telegram identity, contacts, photos or deal data."""
import re

CONTACT = '[контакты в Telegram]'


def public_text(value):
    value = re.sub(r'\d{6,12}:[A-Za-z0-9_-]{8,}', CONTACT, value)
    value = re.sub(r'[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}', CONTACT, value)
    value = re.sub(r'(?i)(?:https?://|tg://|www\.)\S+', CONTACT, value)
    value = re.sub(r'(?<!\w)@[A-Za-z0-9_]{3,32}', CONTACT, value)
    value = re.sub(r'(?<!\w)\+?\d[\d ()-]{5,}\d(?!\w)', CONTACT, value)
    value = re.sub(r'(?<!\w)\+?\d[\d ().-]{6,}\d(?!\w)', lambda m: CONTACT if sum(c.isdigit() for c in m[0]) >= 10 else m[0], value)
    return value


def public_card(data, kind):
    shared = ('id', 'fromCity', 'toCity', 'status', 'createdAt')
    fields = ('departureDate', 'capacity', 'reward', 'note') if kind == 'trips' else (
        'deadlineDate', 'category', 'weight', 'description', 'budget', 'currency')
    trusted = {'id', 'createdAt', 'status', 'departureDate', 'deadlineDate'}
    return {key: public_text(data[key]) if key not in trusted and isinstance(data[key], str) else data[key]
        for key in (*shared, *fields)}
