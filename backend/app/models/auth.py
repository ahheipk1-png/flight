"""Accounts. See app/services/auth.py for the security-relevant parts
(hashing, encryption, sessions) -- this module is schema only.
"""

from __future__ import annotations

import datetime as dt

from sqlalchemy import Boolean, DateTime, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(16), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))  # argon2 -- one-way, never displayed
    # "pending" (awaiting admin review) | "approved" | "denied" | "disabled"
    status: Mapped[str] = mapped_column(String(20), default="pending")
    is_admin: Mapped[bool] = mapped_column(Boolean, default=False)
    # Fernet ciphertext, NOT a hash -- this must be decryptable (search
    # needs the real key), unlike password_hash. Nullable: an approved
    # user hasn't necessarily added a key yet.
    serpapi_api_key_encrypted: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True))
    decided_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
