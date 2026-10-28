"""Persistent FSM storage in the application's existing SQLite/PostgreSQL database."""
import asyncio
import json
from collections.abc import Mapping
from typing import Any
from aiogram.fsm.state import State
from aiogram.fsm.storage.base import BaseStorage, StorageKey, StateType
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from database.db import async_session_maker
from database.models import DialogState


class DatabaseStorage(BaseStorage):
    def __init__(self, session_factory=async_session_maker):
        self.session_factory = session_factory
        self._data_locks: dict[str, asyncio.Lock] = {}

    @staticmethod
    def _key(key: StorageKey) -> str:
        # JSON avoids ambiguities between missing IDs, thread IDs and arbitrary destiny strings.
        return json.dumps([key.bot_id, key.chat_id, key.user_id, key.thread_id,
            key.business_connection_id, key.destiny], separators=(',', ':'), ensure_ascii=True)

    async def _write(self, key: StorageKey, **values: Any) -> None:
        async with self.session_factory() as session:
            dialect = session.bind.dialect.name
            if dialect not in ('sqlite', 'postgresql'):
                raise RuntimeError(f'Unsupported FSM database: {dialect}')
            insert = sqlite_insert if dialect == 'sqlite' else postgres_insert
            statement = insert(DialogState).values(storage_key=self._key(key), **values)
            # Only replace the requested field: state writes must not erase data or vice versa.
            statement = statement.on_conflict_do_update(index_elements=[DialogState.storage_key], set_=values)
            await session.execute(statement)
            await session.commit()

    async def set_state(self, key: StorageKey, state: StateType = None) -> None:
        await self._write(key, state=state.state if isinstance(state, State) else state)

    async def get_state(self, key: StorageKey) -> str | None:
        async with self.session_factory() as session:
            row = await session.get(DialogState, self._key(key))
            return row.state if row else None

    async def _set_data(self, key: StorageKey, data: Mapping[str, Any]) -> None:
        if not isinstance(data, Mapping):
            raise TypeError('FSM data must be a mapping')
        await self._write(key, data=dict(data))

    async def set_data(self, key: StorageKey, data: Mapping[str, Any]) -> None:
        async with self._data_locks.setdefault(self._key(key), asyncio.Lock()):
            await self._set_data(key, data)

    async def get_data(self, key: StorageKey) -> dict[str, Any]:
        async with self.session_factory() as session:
            row = await session.get(DialogState, self._key(key))
            return row.data if row else {}

    async def update_data(self, key: StorageKey, data: Mapping[str, Any]) -> dict[str, Any]:
        async with self._data_locks.setdefault(self._key(key), asyncio.Lock()):
            current = await self.get_data(key)
            current.update(data)
            await self._set_data(key, current)
            return current.copy()

    async def close(self) -> None:
        # Database lifecycle belongs to main.py. Closing the dispatcher never deletes drafts.
        self._data_locks.clear()
