"""Password hashing (argon2, one-way -- never displayed or recovered),
API-key encryption (Fernet, recoverable -- search needs the real key back,
so one-way hashing doesn't apply the way it does to a password), and
Redis-backed bearer-token sessions. See models/auth.py for the schema.
"""

from __future__ import annotations

import secrets

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from cryptography.fernet import Fernet, InvalidToken

from app.config import Settings
from app.redis import RedisLike

_hasher = PasswordHasher()


def normalize_username(username: str) -> str:
    return username.strip().lower()


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def verify_password(password: str, password_hash: str) -> bool:
    try:
        return _hasher.verify(password_hash, password)
    except VerifyMismatchError:
        return False


class EncryptionKeyMissing(RuntimeError):
    pass


def _fernet(settings: Settings) -> Fernet:
    key = settings.api_key_encryption_key
    if not key:
        raise EncryptionKeyMissing(
            "API_KEY_ENCRYPTION_KEY is not set -- generate one with "
            '`python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"` '
            "and set it in .env"
        )
    return Fernet(key.encode())


def encrypt_api_key(raw_key: str, settings: Settings) -> str:
    return _fernet(settings).encrypt(raw_key.encode()).decode()


def decrypt_api_key(ciphertext: str, settings: Settings) -> str:
    try:
        return _fernet(settings).decrypt(ciphertext.encode()).decode()
    except InvalidToken as exc:
        raise EncryptionKeyMissing(
            "Stored API key could not be decrypted -- API_KEY_ENCRYPTION_KEY may have changed since it was saved"
        ) from exc


# ---------- sessions ----------
# Bearer token in Redis, not an httpOnly cookie -- deliberately matches the
# reference app's pattern (localStorage token, Authorization: Bearer
# header), which also sidesteps cross-origin cookie/SameSite complexity
# once the frontend and backend end up on different domains in production.


def _session_key(token: str) -> str:
    return f"session:{token}"


async def create_session(redis: RedisLike, user_id: int, settings: Settings) -> str:
    token = secrets.token_urlsafe(32)
    await redis.set(_session_key(token), str(user_id), ex=settings.session_ttl_seconds)
    return token


async def get_session_user_id(redis: RedisLike, token: str) -> int | None:
    raw = await redis.get(_session_key(token))
    if raw is None:
        return None
    value = raw.decode() if isinstance(raw, (bytes, bytearray)) else raw
    return int(value)


async def delete_session(redis: RedisLike, token: str) -> None:
    await redis.delete(_session_key(token))
