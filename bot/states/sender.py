"""
FSM States for Sender parcel registration.
"""

from aiogram.fsm.state import State, StatesGroup


class SenderStates(StatesGroup):
    waiting_from_city = State()       # Город откуда
    waiting_to_city = State()         # Город куда
    waiting_deadline = State()        # Предельная дата получения
    waiting_category = State()        # Категория вложения
    waiting_description = State()     # Описание посылки
    waiting_photo = State()           # Фото посылки (или кнопка Пропустить)
    waiting_budget = State()          # Предлагаемый бюджет вознаграждения
    confirm_parcel = State()          # Подтверждение отправки
