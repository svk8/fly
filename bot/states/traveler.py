"""
FSM States for Traveler flight/trip registration.
"""

from aiogram.fsm.state import State, StatesGroup


class TravelerStates(StatesGroup):
    waiting_from_city = State()       # Город отправления
    waiting_to_city = State()         # Город назначения
    waiting_date = State()            # Дата вылета (ГГГГ-ММ-ДД или выбор кнопки)
    waiting_capacity = State()        # Габариты / тип груза
    waiting_reward = State()          # Желаемое вознаграждение
    confirm_trip = State()            # Подтверждение публикации
