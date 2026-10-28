"""
Database session management and initialization using Async SQLAlchemy.
"""

from contextlib import asynccontextmanager
from typing import AsyncGenerator
import logging

from sqlalchemy import event, select
from sqlalchemy.engine import make_url
from pathlib import Path
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    AsyncEngine,
    async_sessionmaker,
    create_async_engine
)

from config import settings
from database.models import Base, MatchDeal, DeliveryDeal, DealStatus

logger = logging.getLogger(__name__)

url = make_url(settings.DATABASE_URL)
if url.drivername.startswith("sqlite") and url.database and url.database != ":memory:":
    Path(url.database).parent.mkdir(parents=True, exist_ok=True)

# Create async engine with pool configuration
engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    # Parameters for PostgreSQL or SQLite
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

if "sqlite" in settings.DATABASE_URL:
    @event.listens_for(engine.sync_engine, "connect")
    def sqlite_settings(connection, _record):
        cursor = connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute("PRAGMA journal_mode=WAL")
        cursor.execute("PRAGMA busy_timeout=5000")
        cursor.close()

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
    # Additive migration: retain old tables and import their deals once. Existing records are not deleted.
    async with async_session_maker() as session:
        old = (await session.execute(select(MatchDeal).where(~MatchDeal.id.in_(select(DeliveryDeal.legacy_id).where(DeliveryDeal.legacy_id.is_not(None)))))).scalars().all()
        for deal in old:
            # Older handlers permitted duplicate responses. Keep the first usable response in the unified table.
            exists = await session.scalar(select(DeliveryDeal.id).where(
                ((DeliveryDeal.parcel_id == deal.parcel_id) & (DeliveryDeal.traveler_id == deal.traveler_id)) | ((DeliveryDeal.trip_id == deal.trip_id) & (DeliveryDeal.sender_id == deal.sender_id))))
            if exists or deal.sender_id == deal.traveler_id:
                continue
            session.add(DeliveryDeal(legacy_id=deal.id, trip_id=deal.trip_id, parcel_id=deal.parcel_id,
                sender_id=deal.sender_id, traveler_id=deal.traveler_id, confirmation_user_id=deal.sender_id,
                reward=f"{deal.agreed_price:g} ₽", created_at=deal.created_at,
                status={DealStatus.PROPOSED: "matched", DealStatus.ACCEPTED: "confirmed", DealStatus.COMPLETED: "delivered", DealStatus.REJECTED: "rejected"}[deal.status]))
            await session.flush()
        await session.commit()
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
