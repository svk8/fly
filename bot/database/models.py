"""
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
    Index, UniqueConstraint, CheckConstraint, JSON
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
    phone_number: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    disclaimer_accepted: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    disclaimer_accepted_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)

    # Moderation & Administration
    is_banned: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    ban_reason: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    rating: Mapped[float] = mapped_column(Float, default=5.0, nullable=False)
    completed_deliveries: Mapped[int] = mapped_column(default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)

    # Relationships
    trips: Mapped[List["TravelTrip"]] = relationship("TravelTrip", back_populates="user", cascade="all, delete-orphan")
    parcels: Mapped[List["ParcelRequest"]] = relationship("ParcelRequest", back_populates="sender", cascade="all, delete-orphan")

    def __repr__(self) -> str:
        return f"<User telegram_id={self.telegram_id} role={self.role}>"


class TravelTrip(Base):
    __tablename__ = "travel_trips"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    
    # Города хранятся нормализованными в нижнем регистре для быстрого поиска
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

    def __repr__(self) -> str:
        return f"<TravelTrip {self.from_city}->{self.to_city} {self.departure_date}>"


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

    def __repr__(self) -> str:
        return f"<ParcelRequest {self.from_city}->{self.to_city} budget={self.budget_amount}>"


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


class TripDetails(Base):
    __tablename__ = "trip_details"
    trip_id: Mapped[int] = mapped_column(ForeignKey("travel_trips.id", ondelete="CASCADE"), primary_key=True)
    capacity_label: Mapped[str] = mapped_column(String(200), default="")
    note: Mapped[str] = mapped_column(Text, default="")


class ParcelDetails(Base):
    __tablename__ = "parcel_details"
    parcel_id: Mapped[int] = mapped_column(ForeignKey("parcel_requests.id", ondelete="CASCADE"), primary_key=True)
    weight_label: Mapped[str] = mapped_column(String(200), default="")
    category_label: Mapped[str] = mapped_column(String(200), default="")


class DeliveryDeal(Base):
    """Shared responses from the chat bot and Mini App; legacy MatchDeal is read-only."""
    __tablename__ = "delivery_deals"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    legacy_id: Mapped[Optional[int]] = mapped_column(unique=True, nullable=True)
    trip_id: Mapped[Optional[int]] = mapped_column(ForeignKey("travel_trips.id"), nullable=True)
    parcel_id: Mapped[Optional[int]] = mapped_column(ForeignKey("parcel_requests.id"), nullable=True)
    traveler_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    confirmation_user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    reward: Mapped[str] = mapped_column(String(255))
    status: Mapped[str] = mapped_column(String(24), default="matched")
    inspection_done: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    __table_args__ = (
        # Same participant cannot respond to the same listing twice, including across interfaces.
        UniqueConstraint('parcel_id', 'traveler_id'),
        UniqueConstraint('trip_id', 'sender_id'),
        CheckConstraint('trip_id IS NOT NULL OR parcel_id IS NOT NULL'),
        CheckConstraint('sender_id != traveler_id'),
    )


class DialogState(Base):
    """Durable aiogram FSM state; independent of completed marketplace records."""
    __tablename__ = "dialog_states"
    storage_key: Mapped[str] = mapped_column(String(1024), primary_key=True)
    state: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    data: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)


class NotificationJob(Base):
    """Transactional outbox: durable business events and Telegram delivery attempts."""
    __tablename__ = "notification_jobs"
    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True)
    dedup_key: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    kind: Mapped[str] = mapped_column(String(32), nullable=False)
    payload: Mapped[dict] = mapped_column(JSON, nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(default=0, nullable=False)
    next_attempt_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    lease_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    lease_token: Mapped[Optional[str]] = mapped_column(String(32), nullable=True)
    last_error: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    sent_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    telegram_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow, nullable=False)
    __table_args__ = (Index('idx_notification_due', 'status', 'next_attempt_at', 'lease_until'),)
