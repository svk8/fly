/**
 * Exact contents of the complete bot files for in-browser inspection and instant ZIP download.
 */

export const BOT_FILE_CONTENTS: Record<string, string> = {
  "main.py": `"""
Main Entrypoint for the Crowdshipping Telegram Bot.
Built with aiogram 3.x, SQLAlchemy (Async), and APScheduler.
"""

import asyncio
import logging
import sys

from aiogram import Bot, Dispatcher
from aiogram.client.default import DefaultBotProperties
from aiogram.enums import ParseMode
from aiogram.fsm.storage.memory import MemoryStorage
from aiogram.types import BotCommand

from config import settings
from database.db import init_db
from handlers.common import router as common_router
from handlers.traveler import router as traveler_router
from handlers.sender import router as sender_router
from handlers.matching import router as matching_router
from services.scheduler import start_scheduler, stop_scheduler


logging.basicConfig(
    level=logging.DEBUG if settings.DEBUG else logging.INFO,
    format="%(asctime)s | %(levelname)-8s | %(name)s:%(funcName)s:%(lineno)d - %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)]
)
logger = logging.getLogger("crowdship_bot")


async def setup_bot_commands(bot: Bot) -> None:
    """Register standard commands in Telegram menu button."""
    commands = [
        BotCommand(command="start", description="🚀 Главное меню и перезапуск"),
        BotCommand(command="profile", description="👤 Мой профиль и роль"),
        BotCommand(command="rules", description="🛡️ Правила безопасности и досмотра"),
    ]
    await bot.set_my_commands(commands)
    logger.info("Bot commands menu registered successfully.")


async def main() -> None:
    """Initialize resources, routers, and launch polling loop."""
    logger.info("Starting Crowdshipping Marketplace Bot...")

    # 1. Initialize Database schema
    await init_db()

    # 2. Instantiate Bot with HTML parse mode by default
    bot = Bot(
        token=settings.BOT_TOKEN,
        default=DefaultBotProperties(parse_mode=ParseMode.HTML)
    )

    # 3. Instantiate Dispatcher with in-memory FSM storage
    dp = Dispatcher(storage=MemoryStorage())

    # 4. Register Modular Handlers
    dp.include_router(common_router)
    dp.include_router(traveler_router)
    dp.include_router(sender_router)
    dp.include_router(matching_router)

    # 5. Start Background Scheduler
    start_scheduler(bot)

    # 6. Configure Bot Menu Commands
    await setup_bot_commands(bot)

    # Notify Admins on startup
    for admin_id in settings.admin_ids:
        try:
            await bot.send_message(
                chat_id=admin_id,
                text="🚀 <b>Бот P2P-доставки посылок запущен и готов к работе!</b>",
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning(f"Could not send startup alert to admin {admin_id}: {e}")

    try:
        await bot.delete_webhook(drop_pending_updates=True)
        logger.info("Bot polling is active. Press Ctrl+C to stop.")
        await dp.start_polling(bot, allowed_updates=dp.resolve_used_update_types())
    finally:
        logger.info("Shutting down bot...")
        stop_scheduler()
        await bot.session.close()
        logger.info("Bot shutdown complete.")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except (KeyboardInterrupt, SystemExit):
        logger.info("Bot execution terminated by user.")
`,

  "config.py": `"""
Configuration module using Pydantic Settings.
Loads environment variables from .env file or system environment.
"""

from typing import List
from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    BOT_TOKEN: str = Field(..., description="Telegram Bot API Token from @BotFather")
    DATABASE_URL: str = Field(
        default="sqlite+aiosqlite:///./crowdship.db",
        description="Async SQLAlchemy database URL (PostgreSQL or SQLite)"
    )
    ADMIN_IDS_RAW: str = Field(default="", alias="ADMIN_IDS")
    WEBAPP_URL: str = Field(default="", description="URL of Telegram Mini App (TMA) WebApp")
    DEBUG: bool = Field(default=False)
    TIMEZONE: str = Field(default="Europe/Moscow")

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )

    @property
    def admin_ids(self) -> List[int]:
        if not self.ADMIN_IDS_RAW.strip():
            return []
        try:
            return [int(x.strip()) for x in self.ADMIN_IDS_RAW.split(",") if x.strip()]
        except ValueError:
            return []


settings = Settings()
`,

  "database/models.py": `"""
Database Models for P2P Crowdshipping Marketplace using SQLAlchemy 2.0.
"""

from datetime import datetime, date
import enum
from typing import Optional, List
from sqlalchemy import (
    BigInteger,
    String,
    Text,
    Boolean,
    Float,
    Date,
    DateTime,
    ForeignKey,
    Enum,
    Index
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class UserRole(str, enum.Enum):
    TRAVELER = "traveler"      # Попутчик / Перевозчик
    SENDER = "sender"          # Отправитель посылки
    BOTH = "both"              # Совмещает обе роли


class CapacityType(str, enum.Enum):
    DOCUMENTS = "documents"         # Документы (конверт, до 0.5 кг)
    SMALL_BAG = "small_bag"         # Маленький пакет / ручная кладь (до 2 кг)
    MEDIUM_LUGGAGE = "medium"      # Место в чемодане (до 5-10 кг)
    FULL_SUITCASE = "full_suitcase" # Целый чемодан / крупногабарит (до 23 кг)


class ParcelCategory(str, enum.Enum):
    DOCUMENTS = "Документы и письма"
    ELECTRONICS = "Гаджеты и электроника"
    CLOTHES = "Одежда и личные вещи"
    MEDICINE = "Разрешенные лекарства/БАДы"
    GIFTS = "Подарки и сувениры"
    OTHER = "Другое"


class TripStatus(str, enum.Enum):
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"


class ParcelStatus(str, enum.Enum):
    SEARCHING = "searching"    # В поиске попутчика
    MATCHED = "matched"        # Найден попутчик / сделка согласована
    DELIVERED = "delivered"    # Успешно доставлено
    CANCELLED = "cancelled"    # Отменено


class DealStatus(str, enum.Enum):
    PROPOSED = "proposed"      # Предложено
    ACCEPTED = "accepted"      # Принято обеими сторонами
    REJECTED = "rejected"      # Отклонено
    COMPLETED = "completed"    # Завершено


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True, index=True, nullable=False)
    username: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    full_name: Mapped[str] = mapped_column(String(128), nullable=False)
    
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.BOTH, nullable=False)
    disclaimer_accepted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    disclaimer_accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    rating: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
    completed_deliveries: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    trips: Mapped[List["TravelTrip"]] = relationship("TravelTrip", back_populates="user", cascade="all, delete-orphan")
    parcels: Mapped[List["ParcelRequest"]] = relationship("ParcelRequest", back_populates="sender", cascade="all, delete-orphan")


class TravelTrip(Base):
    __tablename__ = "travel_trips"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    from_city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    to_city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    
    departure_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    return_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    
    capacity_type: Mapped[CapacityType] = mapped_column(Enum(CapacityType), default=CapacityType.SMALL_BAG, nullable=False)
    max_weight_kg: Mapped[float] = mapped_column(Float, default=2.0, nullable=False)
    reward_note: Mapped[str] = mapped_column(String(255), default="Договорное вознаграждение", nullable=False)
    
    status: Mapped[TripStatus] = mapped_column(Enum(TripStatus), default=TripStatus.ACTIVE, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="trips")
    deals: Mapped[List["MatchDeal"]] = relationship("MatchDeal", back_populates="trip")

    __table_args__ = (
        Index("idx_trip_route_date", "from_city", "to_city", "departure_date", "status"),
    )


class ParcelRequest(Base):
    __tablename__ = "parcel_requests"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    from_city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    to_city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    deadline_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)

    category: Mapped[ParcelCategory] = mapped_column(Enum(ParcelCategory), default=ParcelCategory.DOCUMENTS, nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    photo_file_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    budget_amount: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    currency: Mapped[str] = mapped_column(String(10), default="RUB", nullable=False)

    status: Mapped[ParcelStatus] = mapped_column(Enum(ParcelStatus), default=ParcelStatus.SEARCHING, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    sender: Mapped["User"] = relationship("User", back_populates="parcels")
    deals: Mapped[List["MatchDeal"]] = relationship("MatchDeal", back_populates="parcel")

    __table_args__ = (
        Index("idx_parcel_route_date", "from_city", "to_city", "deadline_date", "status"),
    )


class MatchDeal(Base):
    __tablename__ = "match_deals"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    trip_id: Mapped[int] = mapped_column(ForeignKey("travel_trips.id", ondelete="CASCADE"), nullable=False)
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcel_requests.id", ondelete="CASCADE"), nullable=False)

    traveler_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)

    agreed_price: Mapped[float] = mapped_column(Float, default=0.0)
    status: Mapped[DealStatus] = mapped_column(Enum(DealStatus), default=DealStatus.PROPOSED, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    trip: Mapped["TravelTrip"] = relationship("TravelTrip", back_populates="deals")
    parcel: Mapped["ParcelRequest"] = relationship("ParcelRequest", back_populates="deals")
`,

  "database/db.py": `"""
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

engine: AsyncEngine = create_async_engine(
    settings.DATABASE_URL,
    echo=settings.DEBUG,
    future=True,
    connect_args={"check_same_thread": False} if "sqlite" in settings.DATABASE_URL else {}
)

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
`,

  "services/matcher.py": `"""
Smart Auto-Matching Service for Crowdshipping Marketplace.
Detects matching routes between Travelers and Senders and triggers instant push notifications.
"""

import logging
from typing import List
from datetime import date
from sqlalchemy import select, and_
from aiogram import Bot

from database.db import get_db_session
from database.models import (
    TravelTrip,
    ParcelRequest,
    User,
    TripStatus,
    ParcelStatus
)
from keyboards.inline import get_match_action_keyboard

logger = logging.getLogger(__name__)


def normalize_city(city: str) -> str:
    """Normalize city string for reliable comparison."""
    if not city:
        return ""
    return city.strip().lower()


async def find_matching_trips_for_parcel(parcel: ParcelRequest) -> List[TravelTrip]:
    """Find active trips that can carry this parcel."""
    async with get_db_session() as session:
        stmt = (
            select(TravelTrip)
            .join(User, TravelTrip.user_id == User.id)
            .where(
                and_(
                    TravelTrip.status == TripStatus.ACTIVE,
                    TravelTrip.from_city == normalize_city(parcel.from_city),
                    TravelTrip.to_city == normalize_city(parcel.to_city),
                    TravelTrip.departure_date <= parcel.deadline_date,
                    TravelTrip.departure_date >= date.today(),
                    TravelTrip.user_id != parcel.sender_id
                )
            )
            .order_by(TravelTrip.departure_date.asc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())


async def find_matching_parcels_for_trip(trip: TravelTrip) -> List[ParcelRequest]:
    """Find searching parcels suitable for this trip."""
    async with get_db_session() as session:
        stmt = (
            select(ParcelRequest)
            .join(User, ParcelRequest.sender_id == User.id)
            .where(
                and_(
                    ParcelRequest.status == ParcelStatus.SEARCHING,
                    ParcelRequest.from_city == normalize_city(trip.from_city),
                    ParcelRequest.to_city == normalize_city(trip.to_city),
                    ParcelRequest.deadline_date >= trip.departure_date,
                    ParcelRequest.sender_id != trip.user_id
                )
            )
            .order_by(ParcelRequest.created_at.desc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())


async def notify_travelers_about_new_parcel(bot: Bot, parcel: ParcelRequest) -> int:
    """
    Called immediately after a sender registers a parcel.
    Pushes instant Telegram notifications to all matching travelers.
    """
    matching_trips = await find_matching_trips_for_parcel(parcel)
    if not matching_trips:
        return 0

    notified_count = 0
    async with get_db_session() as session:
        for trip in matching_trips:
            user_stmt = select(User).where(User.id == trip.user_id)
            user_res = await session.execute(user_stmt)
            traveler = user_res.scalar_one_or_none()

            if not traveler:
                continue

            text = (
                f"🔔 <b>НАЙДЕНА ПОДХОДЯЩАЯ ПОСЫЛКА ДЛЯ ВАШЕГО РЕЙСА!</b>\\n\\n"
                f"Маршрут: <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>\\n"
                f"📅 Крайний срок доставки: <b>{parcel.deadline_date.strftime('%d.%m.%Y')}</b>\\n"
                f"✈️ Ваш рейс: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\\n\\n"
                f"📦 <b>Категория:</b> {parcel.category.value}\\n"
                f"📝 <b>Описание:</b> {parcel.description}\\n"
                f"💰 <b>Предлагаемый бюджет:</b> {int(parcel.budget_amount)} {parcel.currency}\\n\\n"
                f"<i>Нажмите «Откликнуться», чтобы отправить согласие и связаться с отправителем без раскрытия телефонного номера.</i>"
            )

            try:
                kb = get_match_action_keyboard(parcel_id=parcel.id, trip_id=trip.id)
                if parcel.photo_file_id:
                    await bot.send_photo(
                        chat_id=traveler.telegram_id,
                        photo=parcel.photo_file_id,
                        caption=text,
                        reply_markup=kb,
                        parse_mode="HTML"
                    )
                else:
                    await bot.send_message(
                        chat_id=traveler.telegram_id,
                        text=text,
                        reply_markup=kb,
                        parse_mode="HTML"
                    )
                notified_count += 1
            except Exception as e:
                logger.warning(f"Could not send match notification to user {traveler.telegram_id}: {e}")

    return notified_count
`,

  "services/scheduler.py": `"""
Background Task Scheduler using APScheduler.
Handles automated expiration of old trips and reminders.
"""

import logging
from datetime import date
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from sqlalchemy import update, and_
from aiogram import Bot

from database.db import get_db_session
from database.models import TravelTrip, ParcelRequest, TripStatus, ParcelStatus

logger = logging.getLogger(__name__)
scheduler = AsyncIOScheduler()


async def archive_expired_entries(bot: Bot) -> None:
    """Archive trips and parcel requests that have passed their target dates."""
    today = date.today()
    logger.info(f"Running scheduler sweep for expired records on {today}...")

    async with get_db_session() as session:
        trip_stmt = (
            update(TravelTrip)
            .where(
                and_(
                    TravelTrip.status == TripStatus.ACTIVE,
                    TravelTrip.departure_date < today
                )
            )
            .values(status=TripStatus.COMPLETED)
        )
        trip_res = await session.execute(trip_stmt)

        parcel_stmt = (
            update(ParcelRequest)
            .where(
                and_(
                    ParcelRequest.status == ParcelStatus.SEARCHING,
                    ParcelRequest.deadline_date < today
                )
            )
            .values(status=ParcelStatus.CANCELLED)
        )
        parcel_res = await session.execute(parcel_stmt)

        logger.info(
            f"Archived {trip_res.rowcount} expired trips and {parcel_res.rowcount} expired parcels."
        )


def start_scheduler(bot: Bot) -> None:
    """Configure and start the background scheduler."""
    scheduler.add_job(
        archive_expired_entries,
        trigger="cron",
        hour=2,
        minute=0,
        args=[bot],
        id="archive_expired_entries",
        replace_existing=True
    )
    scheduler.start()
    logger.info("APScheduler initialized and running.")


def stop_scheduler() -> None:
    """Graceful shutdown of scheduler."""
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("APScheduler stopped.")
`,

  "handlers/common.py": `"""
Common Handlers: /start, Disclaimer Acceptance, Profile, Safety Rules, and Navigation.
"""

from datetime import datetime
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.filters import CommandStart, Command
from aiogram.fsm.context import FSMContext
from sqlalchemy import select, update

from database.db import get_db_session
from database.models import User, UserRole
from keyboards.reply import get_main_menu_keyboard
from keyboards.inline import (
    get_disclaimer_keyboard,
    get_role_selector_keyboard
)

router = Router(name="common_router")

SAFETY_TEXT = (
    "🛡️ <b>ПРАВИЛА БЕЗОПАСНОСТИ И ДОСМОТРА ПОСЫЛОК (КРАУДШИППИНГ)</b>\\n\\n"
    "1. <b>Осмотр только в открытом виде:</b>\\n"
    "Попутчик <u>обязан</u> лично видеть, что именно он берет на борт. "
    "Никогда не соглашайтесь на передачу упакованных «сюрпризов» или запечатанных скотчем коробок без предварительного вскрытия!\\n\\n"
    "2. <b>Запрещенные к перевозке предметы:</b>\\n"
    "• Оружие, боеприпасы и спецсредства;\\n"
    "• Наркотические и психотропные вещества;\\n"
    "• Лекарства без оригинальной упаковки или требующие рецепта;\\n"
    "• Литиевые аккумуляторы высокой емкости в багаже;\\n"
    "• Скоропортящиеся продукты питания без сертификатов;\\n"
    "• Валюта свыше таможенного лимита без декларации.\\n\\n"
    "3. <b>Безопасность личных данных:</b>\\n"
    "Мы не передаем ваши телефонные номера третьим лицам. Связь осуществляется внутри Telegram.\\n\\n"
    "4. <b>Вознаграждение:</b>\\n"
    "Оплата производится по взаимной договоренности при личной встрече или безопасными методами после осмотра посылки."
)


@router.message(CommandStart())
async def handle_start(message: Message, state: FSMContext) -> None:
    await state.clear()
    telegram_user = message.from_user
    if not telegram_user:
        return

    async with get_db_session() as session:
        stmt = select(User).where(User.telegram_id == telegram_user.id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            user = User(
                telegram_id=telegram_user.id,
                username=telegram_user.username,
                full_name=telegram_user.full_name or "Пользователь",
                role=UserRole.BOTH,
                disclaimer_accepted=False
            )
            session.add(user)
            await session.commit()
            await session.refresh(user)

        if not user.disclaimer_accepted:
            welcome_text = (
                f"👋 Здравствуйте, <b>{telegram_user.first_name}</b>!\\n\\n"
                f"Добро пожаловать в сервис <b>P2P-доставки посылок и документов через путешественников</b>!\\n\\n"
                f"⚠️ <b>ВНИМАНИЕ: ПРАВИЛА БЕЗОПАСНОСТИ</b>\\n"
                f"Для использования сервиса вы обязаны принять регламент безопасности:\\n\\n"
                f"• Попутчик <b>всегда осматривает посылку в открытом виде</b> перед приемом.\\n"
                f"• Передача запечатанных коробок строго запрещена.\\n"
                f"• Запрещены любые нелегальные, опасные и рецептурные грузы.\\n\\n"
                f"Пожалуйста, подтвердите согласие для продолжения:"
            )
            await message.answer(
                welcome_text,
                reply_markup=get_disclaimer_keyboard(),
                parse_mode="HTML"
            )
            return

    await message.answer(
        f"👋 Рады видеть вас снова, <b>{telegram_user.first_name}</b>!\\n"
        f"Чем вы хотите заняться сегодня?",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(F.data == "accept_disclaimer")
async def handle_accept_disclaimer(callback: CallbackQuery) -> None:
    telegram_id = callback.from_user.id
    async with get_db_session() as session:
        stmt = (
            update(User)
            .where(User.telegram_id == telegram_id)
            .values(
                disclaimer_accepted=True,
                disclaimer_accepted_at=datetime.utcnow()
            )
        )
        await session.execute(stmt)

    await callback.message.delete()
    await callback.message.answer(
        "✅ <b>Правила безопасности приняты!</b>\\n\\n"
        "Выберите вашу основную роль (ее всегда можно сменить в профиле):",
        reply_markup=get_role_selector_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.callback_query(F.data == "read_safety_rules")
async def handle_inline_safety_rules(callback: CallbackQuery) -> None:
    await callback.message.answer(SAFETY_TEXT, parse_mode="HTML")
    await callback.answer()


@router.callback_query(F.data.startswith("set_role:"))
async def handle_role_selection(callback: CallbackQuery) -> None:
    role_str = callback.data.split(":")[1]
    telegram_id = callback.from_user.id
    new_role = UserRole(role_str)

    async with get_db_session() as session:
        stmt = (
            update(User)
            .where(User.telegram_id == telegram_id)
            .values(role=new_role)
        )
        await session.execute(stmt)

    role_titles = {
        UserRole.TRAVELER: "✈️ Попутчик (Я лечу)",
        UserRole.SENDER: "📦 Отправитель (Мне нужно передать)",
        UserRole.BOTH: "🔄 Совмещаю обе роли"
    }

    await callback.message.delete()
    await callback.message.answer(
        f"🎉 Ваша роль обновлена: <b>{role_titles.get(new_role)}</b>\\n\\n"
        f"Используйте кнопки меню внизу экрана для добавления рейсов или отправки посылок.",
        reply_markup=get_main_menu_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer("Роль сохранена!")


@router.message(F.text == "🛡️ Правила безопасности")
@router.message(Command("rules"))
async def handle_rules_menu(message: Message) -> None:
    await message.answer(SAFETY_TEXT, parse_mode="HTML")


@router.message(F.text == "👤 Мой профиль")
@router.message(Command("profile"))
async def handle_profile(message: Message) -> None:
    telegram_id = message.from_user.id
    async with get_db_session() as session:
        stmt = select(User).where(User.telegram_id == telegram_id)
        result = await session.execute(stmt)
        user = result.scalar_one_or_none()

        if not user:
            await message.answer("Профиль не найден. Пожалуйста, отправьте команду /start")
            return

        role_labels = {
            UserRole.TRAVELER: "✈️ Попутчик (беру посылки в дорогу)",
            UserRole.SENDER: "📦 Отправитель (ищу попутчиков)",
            UserRole.BOTH: "🔄 Обе роли (летаю и отправляю)"
        }

        profile_text = (
            f"👤 <b>ВАШ ПРОФИЛЬ</b>\\n\\n"
            f"Имя: <b>{user.full_name}</b>\\n"
            f"Username: @{user.username or 'не указан'}\\n"
            f"Telegram ID: <code>{user.telegram_id}</code>\\n\\n"
            f"⭐ Рейтинг: <b>{user.rating:.1f} / 5.0</b>\\n"
            f"📦 Завершено доставок: <b>{user.completed_deliveries}</b>\\n"
            f"🛡️ Правила досмотра: {'✅ Приняты' if user.disclaimer_accepted else '❌ Не приняты'}\\n\\n"
            f"Текущая роль: <b>{role_labels.get(user.role, 'Не указана')}</b>"
        )

        await message.answer(
            profile_text,
            reply_markup=get_role_selector_keyboard(user.role),
            parse_mode="HTML"
        )


@router.message(F.text == "❌ Отменить")
async def handle_cancel(message: Message, state: FSMContext) -> None:
    await state.clear()
    await message.answer("Действие отменено. Вы вернулись в главное меню.", reply_markup=get_main_menu_keyboard())
`,

  "handlers/traveler.py": `"""
Traveler Handlers: Trip creation FSM, active trips management.
"""

from datetime import datetime, date
from aiogram import Router, F
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from sqlalchemy import select, update

from database.db import get_db_session
from database.models import User, TravelTrip, CapacityType, TripStatus
from states.traveler import TravelerStates
from keyboards.reply import get_main_menu_keyboard, get_cancel_keyboard
from keyboards.inline import (
    get_capacity_keyboard,
    get_quick_dates_keyboard,
    get_confirm_trip_keyboard,
    get_item_actions_keyboard
)
from services.matcher import normalize_city, find_matching_parcels_for_trip

router = Router(name="traveler_router")


def parse_date_input(text: str) -> date | None:
    text = text.strip()
    for fmt in ("%Y-%m-%d", "%d.%m.%Y", "%d/%m/%Y", "%d.%m"):
        try:
            d = datetime.strptime(text, fmt).date()
            if fmt == "%d.%m":
                d = d.replace(year=datetime.now().year)
                if d < date.today():
                    d = d.replace(year=datetime.now().year + 1)
            return d
        except ValueError:
            continue
    return None


@router.message(F.text == "✈️ Я лечу (Добавить рейс)")
async def start_traveler_flow(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(TravelerStates.waiting_from_city)
    await message.answer(
        "✈️ <b>ДОБАВЛЕНИЕ НОВОГО РЕЙСА</b>\\n\\n"
        "Шаг 1 из 5: Укажите <b>город вылета / отправления</b> (например: <i>Москва</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(TravelerStates.waiting_from_city)
async def process_from_city(message: Message, state: FSMContext) -> None:
    city = message.text.strip()
    if len(city) < 2:
        await message.answer("Пожалуйста, укажите корректное название города:")
        return

    await state.update_data(from_city=city)
    await state.set_state(TravelerStates.waiting_to_city)
    await message.answer(
        f"Откуда: <b>{city}</b>\\n\\n"
        f"Шаг 2 из 5: Укажите <b>город назначения / прилета</b> (например: <i>Ереван</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(TravelerStates.waiting_to_city)
async def process_to_city(message: Message, state: FSMContext) -> None:
    city = message.text.strip()
    data = await state.get_data()
    if normalize_city(city) == normalize_city(data.get("from_city", "")):
        await message.answer("Город назначения не может совпадать с отправлением:")
        return

    await state.update_data(to_city=city)
    await state.set_state(TravelerStates.waiting_date)
    await message.answer(
        f"Маршрут: <b>{data.get('from_city')} ➔ {city}</b>\\n\\n"
        f"Шаг 3 из 5: Укажите <b>дату вылета</b> (ДД.ММ.ГГГГ или быстрая кнопка):",
        reply_markup=get_quick_dates_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(TravelerStates.waiting_date, F.data.startswith("qdate:"))
async def process_quick_date(callback: CallbackQuery, state: FSMContext) -> None:
    date_str = callback.data.split(":")[1]
    parsed_date = parse_date_input(date_str)
    if not parsed_date or parsed_date < date.today():
        await callback.answer("Дата прошла. Выберите актуальную дату.", show_alert=True)
        return

    await state.update_data(departure_date=parsed_date.isoformat())
    await state.set_state(TravelerStates.waiting_capacity)
    await callback.message.delete()
    await callback.message.answer(
        f"📅 Дата вылета: <b>{parsed_date.strftime('%d.%m.%Y')}</b>\\n\\n"
        f"Шаг 4 из 5: Выберите <b>свободное место / тип груза</b>:",
        reply_markup=get_capacity_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(TravelerStates.waiting_date)
async def process_text_date(message: Message, state: FSMContext) -> None:
    parsed_date = parse_date_input(message.text)
    if not parsed_date or parsed_date < date.today():
        await message.answer("Введите корректную будущую дату в формате <b>ДД.ММ.ГГГГ</b>:", parse_mode="HTML")
        return

    await state.update_data(departure_date=parsed_date.isoformat())
    await state.set_state(TravelerStates.waiting_capacity)
    await message.answer(
        f"📅 Дата вылета: <b>{parsed_date.strftime('%d.%m.%Y')}</b>\\n\\n"
        f"Шаг 4 из 5: Выберите <b>свободное место / тип груза</b>:",
        reply_markup=get_capacity_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(TravelerStates.waiting_capacity, F.data.startswith("capacity:"))
async def process_capacity(callback: CallbackQuery, state: FSMContext) -> None:
    cap_val = callback.data.split(":")[1]
    cap_type = CapacityType(cap_val)

    weights = {
        CapacityType.DOCUMENTS: 0.5,
        CapacityType.SMALL_BAG: 2.0,
        CapacityType.MEDIUM_LUGGAGE: 8.0,
        CapacityType.FULL_SUITCASE: 23.0
    }
    labels = {
        CapacityType.DOCUMENTS: "📄 Только документы (до 0.5 кг)",
        CapacityType.SMALL_BAG: "🎒 Небольшой пакет/рюкзак (до 2 кг)",
        CapacityType.MEDIUM_LUGGAGE: "🧳 Часть чемодана (до 8 кг)",
        CapacityType.FULL_SUITCASE: "📦 Отдельный чемодан (до 23 кг)"
    }

    await state.update_data(
        capacity_type=cap_type.value,
        max_weight_kg=weights.get(cap_type, 2.0),
        capacity_label=labels.get(cap_type)
    )
    await state.set_state(TravelerStates.waiting_reward)
    await callback.message.delete()
    await callback.message.answer(
        f"Вместимость: <b>{labels.get(cap_type)}</b>\\n\\n"
        f"Шаг 5 из 5: Укажите <b>желаемое вознаграждение</b> (например: <i>«2000 руб»</i> или <i>«По договоренности»</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(TravelerStates.waiting_reward)
async def process_reward(message: Message, state: FSMContext) -> None:
    reward = message.text.strip()
    await state.update_data(reward_note=reward)
    await state.set_state(TravelerStates.confirm_trip)

    data = await state.get_data()
    dep_date = datetime.fromisoformat(data["departure_date"]).strftime("%d.%m.%Y")

    summary_text = (
        f"✈️ <b>ПРОВЕРЬТЕ ДАННЫЕ ВАШЕГО РЕЙСА:</b>\\n\\n"
        f"📍 <b>Маршрут:</b> {data['from_city'].title()} ➔ {data['to_city'].title()}\\n"
        f"📅 <b>Дата вылета:</b> {dep_date}\\n"
        f"🎒 <b>Вместимость:</b> {data.get('capacity_label')}\\n"
        f"💰 <b>Вознаграждение:</b> {reward}\\n\\n"
        f"<i>При публикации рейса бот автоматически начнет искать подходящие посылки отправителей.</i>"
    )

    await message.answer(
        summary_text,
        reply_markup=get_confirm_trip_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(TravelerStates.confirm_trip, F.data == "confirm_trip_yes")
async def commit_trip(callback: CallbackQuery, state: FSMContext) -> None:
    data = await state.get_data()
    telegram_id = callback.from_user.id

    async with get_db_session() as session:
        user_stmt = select(User).where(User.telegram_id == telegram_id)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()

        if not user:
            await callback.answer("Ошибка: пользователь не найден.", show_alert=True)
            return

        new_trip = TravelTrip(
            user_id=user.id,
            from_city=normalize_city(data["from_city"]),
            to_city=normalize_city(data["to_city"]),
            departure_date=datetime.fromisoformat(data["departure_date"]).date(),
            capacity_type=CapacityType(data["capacity_type"]),
            max_weight_kg=data["max_weight_kg"],
            reward_note=data["reward_note"],
            status=TripStatus.ACTIVE
        )
        session.add(new_trip)
        await session.commit()
        await session.refresh(new_trip)

        matched_parcels = await find_matching_parcels_for_trip(new_trip)

    await state.clear()
    await callback.message.delete()

    success_text = (
        f"✅ <b>Ваш рейс успешно опубликован!</b>\\n\\n"
        f"Маршрут: <b>{data['from_city'].title()} ➔ {data['to_city'].title()}</b>\\n"
        f"Как только отправитель создаст подходящую посылку, бот мгновенно уведомит вас.\\n\\n"
    )

    if matched_parcels:
        success_text += (
            f"🎯 <b>Прямо сейчас уже есть {len(matched_parcels)} заявок на этот маршрут!</b>\\n"
            f"Перейдите в раздел «Поиск рейсов и посылок», чтобы связаться с отправителями."
        )

    await callback.message.answer(
        success_text,
        reply_markup=get_main_menu_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer("Рейс сохранен!")


@router.callback_query(TravelerStates.confirm_trip, F.data == "confirm_trip_no")
async def cancel_trip_creation(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.delete()
    await callback.message.answer("Публикация рейса отменена.", reply_markup=get_main_menu_keyboard())
    await callback.answer()


@router.callback_query(F.data.startswith("delete_trip:"))
async def handle_delete_trip(callback: CallbackQuery) -> None:
    trip_id = int(callback.data.split(":")[1])
    async with get_db_session() as session:
        stmt = (
            update(TravelTrip)
            .where(TravelTrip.id == trip_id)
            .values(status=TripStatus.CANCELLED)
        )
        await session.execute(stmt)

    await callback.message.edit_text("❌ Рейс успешно отменен.")
    await callback.answer("Рейс отменен")
`,

  "handlers/sender.py": `"""
Sender Handlers: Parcel request creation FSM, photo handling, and auto-matching trigger.
"""

from datetime import datetime, date
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery
from aiogram.fsm.context import FSMContext
from sqlalchemy import select, update

from database.db import get_db_session
from database.models import User, ParcelRequest, ParcelCategory, ParcelStatus
from states.sender import SenderStates
from keyboards.reply import (
    get_main_menu_keyboard,
    get_cancel_keyboard,
    get_skip_or_cancel_keyboard
)
from keyboards.inline import (
    get_parcel_category_keyboard,
    get_quick_dates_keyboard,
    get_confirm_parcel_keyboard
)
from services.matcher import normalize_city, notify_travelers_about_new_parcel
from handlers.traveler import parse_date_input

router = Router(name="sender_router")


@router.message(F.text == "📦 Передать посылку")
async def start_sender_flow(message: Message, state: FSMContext) -> None:
    await state.clear()
    await state.set_state(SenderStates.waiting_from_city)
    await message.answer(
        "📦 <b>ОТПРАВКА ПОСЫЛКИ / ДОКУМЕНТОВ</b>\\n\\n"
        "Шаг 1 из 7: Укажите <b>город отправления</b> (откуда забрать, например: <i>Москва</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_from_city)
async def process_sender_from_city(message: Message, state: FSMContext) -> None:
    city = message.text.strip()
    if len(city) < 2:
        await message.answer("Пожалуйста, укажите корректное название города:")
        return

    await state.update_data(from_city=city)
    await state.set_state(SenderStates.waiting_to_city)
    await message.answer(
        f"Откуда: <b>{city}</b>\\n\\n"
        f"Шаг 2 из 7: Укажите <b>город назначения</b> (куда доставить, например: <i>Ереван</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_to_city)
async def process_sender_to_city(message: Message, state: FSMContext) -> None:
    city = message.text.strip()
    data = await state.get_data()
    if normalize_city(city) == normalize_city(data.get("from_city", "")):
        await message.answer("Город назначения не может совпадать с отправлением:")
        return

    await state.update_data(to_city=city)
    await state.set_state(SenderStates.waiting_deadline)
    await message.answer(
        f"Маршрут: <b>{data.get('from_city')} ➔ {city}</b>\\n\\n"
        f"Шаг 3 из 7: До какой даты необходимо доставить? (<b>Крайний срок</b> в формате <i>ДД.ММ.ГГГГ</i>):",
        reply_markup=get_quick_dates_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(SenderStates.waiting_deadline, F.data.startswith("qdate:"))
async def process_sender_quick_date(callback: CallbackQuery, state: FSMContext) -> None:
    date_str = callback.data.split(":")[1]
    parsed_date = parse_date_input(date_str)
    if not parsed_date or parsed_date < date.today():
        await callback.answer("Выбранная дата в прошлом.", show_alert=True)
        return

    await state.update_data(deadline_date=parsed_date.isoformat())
    await state.set_state(SenderStates.waiting_category)
    await callback.message.delete()
    await callback.message.answer(
        f"📅 Срок доставки: <b>до {parsed_date.strftime('%d.%m.%Y')}</b>\\n\\n"
        f"Шаг 4 из 7: Выберите <b>категорию отправления</b>:",
        reply_markup=get_parcel_category_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(SenderStates.waiting_deadline)
async def process_sender_text_date(message: Message, state: FSMContext) -> None:
    parsed_date = parse_date_input(message.text)
    if not parsed_date or parsed_date < date.today():
        await message.answer("Введите будущую дату в виде <b>ДД.ММ.ГГГГ</b>:", parse_mode="HTML")
        return

    await state.update_data(deadline_date=parsed_date.isoformat())
    await state.set_state(SenderStates.waiting_category)
    await message.answer(
        f"📅 Срок доставки: <b>до {parsed_date.strftime('%d.%m.%Y')}</b>\\n\\n"
        f"Шаг 4 из 7: Выберите <b>категорию отправления</b>:",
        reply_markup=get_parcel_category_keyboard(),
        parse_mode="HTML"
    )


@router.callback_query(SenderStates.waiting_category, F.data.startswith("cat:"))
async def process_sender_category(callback: CallbackQuery, state: FSMContext) -> None:
    cat_key = callback.data.split(":")[1]
    category = ParcelCategory[cat_key]

    await state.update_data(
        category=category.name,
        category_label=category.value
    )
    await state.set_state(SenderStates.waiting_description)
    await callback.message.delete()
    await callback.message.answer(
        f"Категория: <b>{category.value}</b>\\n\\n"
        f"Шаг 5 из 7: Подробно опишите <b>содержимое и габариты</b> посылки:",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )
    await callback.answer()


@router.message(SenderStates.waiting_description)
async def process_sender_description(message: Message, state: FSMContext) -> None:
    desc = message.text.strip()
    if len(desc) < 5:
        await message.answer("Пожалуйста, опишите посылку подробнее (от 5 символов):")
        return

    await state.update_data(description=desc)
    await state.set_state(SenderStates.waiting_photo)
    await message.answer(
        "Шаг 6 из 7: Прикрепите <b>фотографию посылки</b> (или нажмите кнопку «Пропустить фото»):\\n\\n"
        "<i>Напоминание: фото в открытом виде повышает доверие попутчиков!</i>",
        reply_markup=get_skip_or_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_photo, F.photo)
async def process_sender_photo(message: Message, state: FSMContext) -> None:
    photo_file_id = message.photo[-1].file_id
    await state.update_data(photo_file_id=photo_file_id)
    await state.set_state(SenderStates.waiting_budget)
    await message.answer(
        "📷 Фото успешно прикреплено!\\n\\n"
        "Шаг 7 из 7: Укажите <b>размер вознаграждения попутчику в рублях</b> (например: <i>1500</i> или <i>3000</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_photo, F.text == "⏩ Пропустить фото")
async def skip_sender_photo(message: Message, state: FSMContext) -> None:
    await state.update_data(photo_file_id=None)
    await state.set_state(SenderStates.waiting_budget)
    await message.answer(
        "Шаг 7 из 7: Укажите <b>размер вознаграждения попутчику в рублях</b> (например: <i>1500</i> или <i>3000</i>):",
        reply_markup=get_cancel_keyboard(),
        parse_mode="HTML"
    )


@router.message(SenderStates.waiting_budget)
async def process_sender_budget(message: Message, state: FSMContext) -> None:
    budget_raw = "".join(ch for ch in message.text if ch.isdigit() or ch == ".")
    try:
        budget = float(budget_raw)
        if budget <= 0:
            raise ValueError()
    except ValueError:
        await message.answer("Пожалуйста, введите положительную сумму вознаграждения цифрами (например: 2000):")
        return

    await state.update_data(budget_amount=budget)
    await state.set_state(SenderStates.confirm_parcel)

    data = await state.get_data()
    deadline_fmt = datetime.fromisoformat(data["deadline_date"]).strftime("%d.%m.%Y")

    summary_text = (
        f"📦 <b>ПРОВЕРЬТЕ ДАННЫЕ ЗАЯВКИ НА ДОСТАВКУ:</b>\\n\\n"
        f"📍 <b>Маршрут:</b> {data['from_city'].title()} ➔ {data['to_city'].title()}\\n"
        f"📅 <b>Крайний срок:</b> {deadline_fmt}\\n"
        f"🏷️ <b>Категория:</b> {data.get('category_label')}\\n"
        f"📝 <b>Описание:</b> {data['description']}\\n"
        f"💰 <b>Вознаграждение:</b> {int(budget)} RUB\\n"
        f"📷 <b>Фотография:</b> {'Прикреплена' if data.get('photo_file_id') else 'Без фото'}\\n\\n"
        f"<i>При подтверждении система автоматически найдет попутчиков и отправит им Push-уведомление!</i>"
    )

    if data.get("photo_file_id"):
        await message.answer_photo(
            photo=data["photo_file_id"],
            caption=summary_text,
            reply_markup=get_confirm_parcel_keyboard(),
            parse_mode="HTML"
        )
    else:
        await message.answer(
            summary_text,
            reply_markup=get_confirm_parcel_keyboard(),
            parse_mode="HTML"
        )


@router.callback_query(SenderStates.confirm_parcel, F.data == "confirm_parcel_yes")
async def commit_parcel(callback: CallbackQuery, state: FSMContext, bot: Bot) -> None:
    data = await state.get_data()
    telegram_id = callback.from_user.id

    async with get_db_session() as session:
        user_stmt = select(User).where(User.telegram_id == telegram_id)
        user_res = await session.execute(user_stmt)
        user = user_res.scalar_one_or_none()

        if not user:
            await callback.answer("Ошибка: пользователь не найден.", show_alert=True)
            return

        new_parcel = ParcelRequest(
            sender_id=user.id,
            from_city=normalize_city(data["from_city"]),
            to_city=normalize_city(data["to_city"]),
            deadline_date=datetime.fromisoformat(data["deadline_date"]).date(),
            category=ParcelCategory[data["category"]],
            description=data["description"],
            photo_file_id=data.get("photo_file_id"),
            budget_amount=data["budget_amount"],
            currency="RUB",
            status=ParcelStatus.SEARCHING
        )
        session.add(new_parcel)
        await session.commit()
        await session.refresh(new_parcel)

        # Trigger Smart Auto-Matching Notifications to Travelers!
        notified_travelers = await notify_travelers_about_new_parcel(bot, new_parcel)

    await state.clear()
    await callback.message.delete()

    text = (
        f"🚀 <b>Заявка на доставку успешно зарегистрирована!</b>\\n\\n"
        f"Маршрут: <b>{data['from_city'].title()} ➔ {data['to_city'].title()}</b>\\n"
        f"Бюджет: <b>{int(data['budget_amount'])} RUB</b>\\n\\n"
    )

    if notified_travelers > 0:
        text += (
            f"🎯 <b>УМНЫЙ АВТО-МЭТЧИНГ СРАБОТАЛ!</b>\\n"
            f"Найдено подходящих попутчиков на маршруте: <b>{notified_travelers}</b>.\\n"
            f"Им направлены Push-уведомления с кнопкой согласия на доставку."
        )
    else:
        text += (
            f"Пока нет попутчиков с точным совпадением дат. "
            f"Как только кто-то добавит рейс по вашему маршруту, бот сразу уведомит его!"
        )

    await callback.message.answer(text, reply_markup=get_main_menu_keyboard(), parse_mode="HTML")
    await callback.answer("Заявка создана!")


@router.callback_query(SenderStates.confirm_parcel, F.data == "confirm_parcel_no")
async def cancel_parcel_creation(callback: CallbackQuery, state: FSMContext) -> None:
    await state.clear()
    await callback.message.delete()
    await callback.message.answer("Регистрация посылки отменена.", reply_markup=get_main_menu_keyboard())
    await callback.answer()
`,

  "handlers/matching.py": `"""
Matching, Search, Deals, and Safe Contact Handlers.
Enforces safe contact connection without phone number exposure.
"""

import logging
from datetime import date
from aiogram import Router, F, Bot
from aiogram.types import Message, CallbackQuery
from sqlalchemy import select, and_, or_

from database.db import get_db_session
from database.models import (
    User,
    TravelTrip,
    ParcelRequest,
    MatchDeal,
    TripStatus,
    ParcelStatus,
    DealStatus
)
from keyboards.inline import (
    get_safe_contact_keyboard,
    get_item_actions_keyboard
)
from keyboards.reply import get_main_menu_keyboard

logger = logging.getLogger(__name__)
router = Router(name="matching_router")


@router.callback_query(F.data.startswith("respond_match:"))
async def handle_traveler_response(callback: CallbackQuery, bot: Bot) -> None:
    parts = callback.data.split(":")
    parcel_id = int(parts[1])
    trip_id = int(parts[2])
    traveler_telegram_id = callback.from_user.id

    async with get_db_session() as session:
        parcel_stmt = select(ParcelRequest).where(ParcelRequest.id == parcel_id)
        parcel = (await session.execute(parcel_stmt)).scalar_one_or_none()

        if not parcel or parcel.status != ParcelStatus.SEARCHING:
            await callback.answer("Эта заявка уже закрыта или отменена.", show_alert=True)
            return

        sender_stmt = select(User).where(User.id == parcel.sender_id)
        sender = (await session.execute(sender_stmt)).scalar_one_or_none()

        traveler_stmt = select(User).where(User.telegram_id == traveler_telegram_id)
        traveler = (await session.execute(traveler_stmt)).scalar_one_or_none()

        trip_stmt = select(TravelTrip).where(TravelTrip.id == trip_id)
        trip = (await session.execute(trip_stmt)).scalar_one_or_none()

        if not (parcel and sender and traveler and trip):
            await callback.answer("Ошибка данных сделки.", show_alert=True)
            return

        deal = MatchDeal(
            trip_id=trip.id,
            parcel_id=parcel.id,
            traveler_id=traveler.id,
            sender_id=sender.id,
            agreed_price=parcel.budget_amount,
            status=DealStatus.ACCEPTED
        )
        session.add(deal)
        parcel.status = ParcelStatus.MATCHED
        await session.commit()

        # Send safe contact to SENDER
        sender_text = (
            f"🎉 <b>ПОПУТЧИК НАЙДЕН ДЛЯ ВАШЕЙ ПОСЫЛКИ!</b>\\n\\n"
            f"Попутчик <b>{traveler.full_name}</b> (@{traveler.username or 'без username'}) "
            f"согласился взять вашу посылку по маршруту <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>!\\n\\n"
            f"✈️ Дата рейса: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\\n"
            f"💰 Вознаграждение: <b>{int(parcel.budget_amount)} {parcel.currency}</b>\\n\\n"
            f"🔒 <b>БЕЗОПАСНЫЙ ПЕРВЫЙ КОНТАКТ:</b>\\n"
            f"Ваш телефонный номер скрыт. Нажмите кнопку ниже, чтобы начать диалог в Telegram напрямую.\\n\\n"
            f"<i>⚠️ Напоминание: передавайте посылку исключительно в открытом виде для досмотра!</i>"
        )

        try:
            await bot.send_message(
                chat_id=sender.telegram_id,
                text=sender_text,
                reply_markup=get_safe_contact_keyboard(traveler.username, traveler.telegram_id),
                parse_mode="HTML"
            )
        except Exception as e:
            logger.warning(f"Could not notify sender {sender.telegram_id}: {e}")

        traveler_reply = (
            f"✅ <b>ВЫ ОТКЛИКНУЛИСЬ НА ЗАЯВКУ!</b>\\n\\n"
            f"Отправитель: <b>{sender.full_name}</b> (@{sender.username or 'без username'})\\n"
            f"Маршрут: <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>\\n"
            f"Вознаграждение: <b>{int(parcel.budget_amount)} {parcel.currency}</b>\\n\\n"
            f"🔒 <b>Свяжитесь с отправителем для обсуждения деталей:</b>\\n"
            f"Телефонные номера не разглашаются в целях защиты приватности."
        )

        await callback.message.edit_text(
            traveler_reply,
            reply_markup=get_safe_contact_keyboard(sender.username, sender.telegram_id),
            parse_mode="HTML"
        )
        await callback.answer("Отклик отправлен отправителю!")


@router.callback_query(F.data.startswith("dismiss_match:"))
async def handle_dismiss_match(callback: CallbackQuery) -> None:
    await callback.message.edit_text("Заявка отклонена. Мы пришлем новое уведомление, когда появится другой груз.")
    await callback.answer("Пропущено")


@router.message(F.text == "📋 Мои заявки и рейсы")
async def handle_my_items(message: Message) -> None:
    telegram_id = message.from_user.id
    async with get_db_session() as session:
        user_stmt = select(User).where(User.telegram_id == telegram_id)
        user = (await session.execute(user_stmt)).scalar_one_or_none()

        if not user:
            await message.answer("Профиль не найден. Отправьте /start")
            return

        trips_stmt = (
            select(TravelTrip)
            .where(
                and_(
                    TravelTrip.user_id == user.id,
                    TravelTrip.status == TripStatus.ACTIVE
                )
            )
            .order_by(TravelTrip.departure_date.asc())
        )
        trips = (await session.execute(trips_stmt)).scalars().all()

        parcels_stmt = (
            select(ParcelRequest)
            .where(
                and_(
                    ParcelRequest.sender_id == user.id,
                    or_(
                        ParcelRequest.status == ParcelStatus.SEARCHING,
                        ParcelRequest.status == ParcelStatus.MATCHED
                    )
                )
            )
            .order_by(ParcelRequest.created_at.desc())
        )
        parcels = (await session.execute(parcels_stmt)).scalars().all()

    if not trips and not parcels:
        await message.answer(
            "📋 <b>У вас пока нет активных рейсов или заявок.</b>\\n\\n"
            "Воспользуйтесь кнопками меню для добавления поездки или посылки.",
            parse_mode="HTML"
        )
        return

    await message.answer(f"📋 <b>ВАШИ АКТИВНЫЕ РЕЙСЫ И ЗАЯВКИ</b> (Рейсов: {len(trips)}, Посылок: {len(parcels)}):", parse_mode="HTML")

    for trip in trips:
        trip_text = (
            f"✈️ <b>РЕЙС #{trip.id}</b>\\n"
            f"Маршрут: <b>{trip.from_city.title()} ➔ {trip.to_city.title()}</b>\\n"
            f"Дата: <b>{trip.departure_date.strftime('%d.%m.%Y')}</b>\\n"
            f"Вместимость: {trip.capacity_type.value}\\n"
            f"Вознаграждение: {trip.reward_note}\\n"
            f"Статус: 🟢 Активен"
        )
        await message.answer(
            trip_text,
            reply_markup=get_item_actions_keyboard("trip", trip.id),
            parse_mode="HTML"
        )

    for parcel in parcels:
        status_badge = "🟢 В поиске" if parcel.status == ParcelStatus.SEARCHING else "🤝 Найден попутчик"
        parcel_text = (
            f"📦 <b>ПОСЫЛКА #{parcel.id}</b>\\n"
            f"Маршрут: <b>{parcel.from_city.title()} ➔ {parcel.to_city.title()}</b>\\n"
            f"Крайний срок: <b>{parcel.deadline_date.strftime('%d.%m.%Y')}</b>\\n"
            f"Категория: {parcel.category.value}\\n"
            f"Описание: {parcel.description}\\n"
            f"Вознаграждение: {int(parcel.budget_amount)} {parcel.currency}\\n"
            f"Статус: {status_badge}"
        )
        await message.answer(
            parcel_text,
            reply_markup=get_item_actions_keyboard("parcel", parcel.id),
            parse_mode="HTML"
        )


@router.message(F.text == "🔍 Поиск рейсов и посылок")
async def handle_search_menu(message: Message) -> None:
    async with get_db_session() as session:
        trips_stmt = (
            select(TravelTrip)
            .where(
                and_(
                    TravelTrip.status == TripStatus.ACTIVE,
                    TravelTrip.departure_date >= date.today()
                )
            )
            .order_by(TravelTrip.departure_date.asc())
            .limit(5)
        )
        trips = (await session.execute(trips_stmt)).scalars().all()

        parcels_stmt = (
            select(ParcelRequest)
            .where(
                and_(
                    ParcelRequest.status == ParcelStatus.SEARCHING,
                    ParcelRequest.deadline_date >= date.today()
                )
            )
            .order_by(ParcelRequest.created_at.desc())
            .limit(5)
        )
        parcels = (await session.execute(parcels_stmt)).scalars().all()

    text = "🔍 <b>АКТУАЛЬНЫЕ РЕЙСЫ И ЗАЯВКИ В МАРКЕТПЛЕЙСЕ</b>\\n\\n"
    text += "✈️ <b>БЛИЖАЙШИЕ РЕЙСЫ ПОПУТЧИКОВ:</b>\\n"
    if trips:
        for t in trips:
            text += f"• <b>{t.from_city.title()} ➔ {t.to_city.title()}</b> | {t.departure_date.strftime('%d.%m')} | {t.reward_note}\\n"
    else:
        text += "<i>Пока нет активных рейсов. Будьте первым!</i>\\n"

    text += "\\n📦 <b>ОТКРЫТЫЕ ПОСЫЛКИ ДЛЯ ДОСТАВКИ:</b>\\n"
    if parcels:
        for p in parcels:
            text += f"• <b>{p.from_city.title()} ➔ {p.to_city.title()}</b> | до {p.deadline_date.strftime('%d.%m')} | {int(p.budget_amount)} {p.currency} ({p.category.value})\\n"
    else:
        text += "<i>Пока нет открытых заявок на доставку.</i>\\n"

    await message.answer(text, reply_markup=get_main_menu_keyboard(), parse_mode="HTML")
`,

  "keyboards/reply.py": `"""
Reply Keyboards for Telegram Bot.
"""

from aiogram.types import ReplyKeyboardMarkup, KeyboardButton, WebAppInfo
from config import settings


def get_main_menu_keyboard() -> ReplyKeyboardMarkup:
    """Standard bottom menu for navigation, with optional TMA WebApp button."""
    keyboard = []
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
`,

  "keyboards/inline.py": `"""
Inline Keyboards for Telegram Bot.
"""

from datetime import datetime, timedelta
from aiogram.types import InlineKeyboardMarkup, InlineKeyboardButton
from database.models import CapacityType, ParcelCategory, UserRole


def get_disclaimer_keyboard() -> InlineKeyboardMarkup:
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
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [InlineKeyboardButton(text="📄 Документы / Конверт (до 0.5 кг)", callback_data=f"capacity:{CapacityType.DOCUMENTS.value}")],
            [InlineKeyboardButton(text="🎒 Небольшой пакет / рюкзак (до 2 кг)", callback_data=f"capacity:{CapacityType.SMALL_BAG.value}")],
            [InlineKeyboardButton(text="🧳 Часть чемодана (до 5-10 кг)", callback_data=f"capacity:{CapacityType.MEDIUM_LUGGAGE.value}")],
            [InlineKeyboardButton(text="📦 Целый чемодан (до 23 кг)", callback_data=f"capacity:{CapacityType.FULL_SUITCASE.value}")]
        ]
    )


def get_parcel_category_keyboard() -> InlineKeyboardMarkup:
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
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚀 Опубликовать рейс", callback_data="confirm_trip_yes"),
                InlineKeyboardButton(text="❌ Отменить", callback_data="confirm_trip_no")
            ]
        ]
    )


def get_confirm_parcel_keyboard() -> InlineKeyboardMarkup:
    return InlineKeyboardMarkup(
        inline_keyboard=[
            [
                InlineKeyboardButton(text="🚀 Запустить поиск попутчиков", callback_data="confirm_parcel_yes"),
                InlineKeyboardButton(text="❌ Отменить", callback_data="confirm_parcel_no")
            ]
        ]
    )


def get_match_action_keyboard(parcel_id: int, trip_id: int) -> InlineKeyboardMarkup:
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
`,

  "states/traveler.py": `"""
FSM States for Traveler flight/trip registration.
"""

from aiogram.fsm.state import State, StatesGroup


class TravelerStates(StatesGroup):
    waiting_from_city = State()       # Город отправления
    waiting_to_city = State()         # Город назначения
    waiting_date = State()            # Дата вылета
    waiting_capacity = State()        # Габариты / тип груза
    waiting_reward = State()          # Желаемое вознаграждение
    confirm_trip = State()            # Подтверждение публикации
`,

  "states/sender.py": `"""
FSM States for Sender parcel registration.
"""

from aiogram.fsm.state import State, StatesGroup


class SenderStates(StatesGroup):
    waiting_from_city = State()       # Город откуда
    waiting_to_city = State()         # Город куда
    waiting_deadline = State()        # Предельная дата получения
    waiting_category = State()        # Категория вложения
    waiting_description = State()     # Описание посылки
    waiting_photo = State()           # Фото посылки
    waiting_budget = State()          # Предлагаемый бюджет
    confirm_parcel = State()          # Подтверждение отправки
`,

  "requirements.txt": `aiogram>=3.13.0
pydantic>=2.7.0
pydantic-settings>=2.2.1
SQLAlchemy>=2.0.29
asyncpg>=0.29.0
aiosqlite>=0.20.0
APScheduler>=3.10.4
python-dotenv>=1.0.1
pytz>=2024.1
`,

  "docker-compose.yml": `version: '3.8'

services:
  db:
    image: postgres:16-alpine
    container_name: crowdship_postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: crowdship_user
      POSTGRES_PASSWORD: secure_postgres_password
      POSTGRES_DB: crowdship_db
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U crowdship_user -d crowdship_db"]
      interval: 5s
      timeout: 5s
      retries: 5

  bot:
    build: .
    container_name: crowdship_bot
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    env_file:
      - .env
    environment:
      - DATABASE_URL=postgresql+asyncpg://crowdship_user:secure_postgres_password@db:5432/crowdship_db
    volumes:
      - .:/app

volumes:
  postgres_data:
`,

  "Dockerfile": `FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \\
    build-essential \\
    libpq-dev \\
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

COPY . /app/

CMD ["python", "main.py"]
`,

  ".env.example": `# Токен вашего Telegram бота, полученный от @BotFather
BOT_TOKEN=1234567890:ABCDefGhIJklmnOPQRstUVwxYZ

# Строка подключения к базе данных.
# Для локальной разработки и MVP можно использовать SQLite:
DATABASE_URL=sqlite+aiosqlite:///./crowdship.db

# Для продакшена с PostgreSQL:
# DATABASE_URL=postgresql+asyncpg://postgres:secure_password@localhost:5432/crowdship_db

# ID администраторов через запятую
ADMIN_IDS=123456789,987654321

DEBUG=True
TIMEZONE=Europe/Moscow
`,

  "README.md": `# 📦 Crowdshipping Marketplace — Telegram Bot (P2P Посылки и Документы)

Полнофункциональный, готовый к продакшен-деплою Telegram-бот для P2P-доставки посылок и документов через путешественников (попутчиков), написанный на **Python 3.11+**, **aiogram 3.x**, **SQLAlchemy 2.0 (Async)** и **APScheduler**.

## 🌟 Ключевые возможности
1. **Безопасность и регламент досмотра посылок:**
   - Обязательное интерактивное принятие дисклеймера безопасности при \`/start\`.
   - Запрет на передачу запечатанных коробок без личного визуального досмотра попутчиком перед посадкой.
2. **Ролевая модель:**
   - ✈️ Попутчик (Я лечу)
   - 📦 Отправитель (Мне нужно передать)
   - 🔄 Совмещение ролей
3. **Умный Авто-Мэтчинг:**
   - Моментальные Push-уведомления попутчику при создании посылки отправителем.
4. **Безопасный первый контакт:**
   - Телефонные номера не раскрываются. Связь по защищенным Telegram ссылкам.
5. **Фоновый планировщик (APScheduler):**
   - Автоматическая архивация рейсов и заявок с истекшим сроком.
`
};
