"""
Database session management and initialization using Async SQLAlchemy.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
import logging

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    async_sessionmaker,
    create_async_engine
)

from config import settings
from database.models import Base

logger = logging.getLogger(__name__)

# Create async engine with pool configuration
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    # Parameters for PostgreSQL or SQLite
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

# Async session factory
async_session_maker = async_sessionmaker(
    bind=engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False
)


async def init_db() -> None:
    """Initialize database tables."""
    logger.info("Initializing database tables...")
    async with engine.begin() as conn:
        # In production with migrations you would use Alembic,
        # but for out-of-the-box zero-setup deployment create_all ensures everything works instantly.
        await conn.run_sync(Base.metadata.create_all)
    logger.info("Database tables initialized successfully.")


@asynccontextmanager
async def get_db_session() -> AsyncGenerator[AsyncSession, None]:
    """Provide a transactional async session scope."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
