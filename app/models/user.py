"""User identity and the initial, database-enforced role vocabulary."""

from datetime import datetime
from enum import StrEnum
from uuid import UUID, uuid4

from sqlalchemy import Boolean, CheckConstraint, DateTime, Enum, String, Uuid, func, text
from sqlalchemy.orm import Mapped, mapped_column

from app.database.base import Base


class UserRole(StrEnum):
    ADMIN = "ADMIN"
    MEMBER = "MEMBER"


class User(Base):
    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint("email = lower(trim(email))", name="ck_users_email_normalized"),
        CheckConstraint("length(email) > 3", name="ck_users_email_length"),
        CheckConstraint("length(first_name) > 0", name="ck_users_first_name"),
        CheckConstraint("length(last_name) > 0", name="ck_users_last_name"),
    )

    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    hashed_password: Mapped[str] = mapped_column(String(512))
    first_name: Mapped[str] = mapped_column(String(100))
    last_name: Mapped[str] = mapped_column(String(100))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    role: Mapped[UserRole] = mapped_column(
        Enum(UserRole, name="user_role", native_enum=False, create_constraint=True,
             validate_strings=True, length=32),
        default=UserRole.MEMBER, server_default=UserRole.MEMBER.value,
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now()
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
