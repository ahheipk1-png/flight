from __future__ import annotations

import pytest

from app.config import get_settings
from app.redis import get_redis
from app.services.auth import (
    EncryptionKeyMissing,
    create_session,
    decrypt_api_key,
    delete_session,
    encrypt_api_key,
    get_session_user_id,
    hash_password,
    normalize_username,
    verify_password,
)


def test_password_hash_is_never_the_plaintext():
    h = hash_password("correcthorsebatterystaple")
    assert h != "correcthorsebatterystaple"
    assert "correcthorsebatterystaple" not in h


def test_same_password_hashes_differently_each_time_salted():
    h1 = hash_password("samepassword123")
    h2 = hash_password("samepassword123")
    assert h1 != h2  # argon2 salts per-hash -- two hashes of the same password must differ
    assert verify_password("samepassword123", h1)
    assert verify_password("samepassword123", h2)


def test_verify_password_rejects_wrong_password():
    h = hash_password("realpassword")
    assert verify_password("wrongpassword", h) is False


def test_normalize_username_strips_and_lowercases():
    assert normalize_username("  Alice  ") == "alice"
    assert normalize_username("BOB") == "bob"


def test_api_key_encrypt_decrypt_round_trip():
    settings = get_settings()
    ciphertext = encrypt_api_key("sk-real-secret-key-123", settings)
    assert ciphertext != "sk-real-secret-key-123"
    assert decrypt_api_key(ciphertext, settings) == "sk-real-secret-key-123"


def test_missing_encryption_key_raises_clear_error(monkeypatch):
    monkeypatch.setenv("API_KEY_ENCRYPTION_KEY", "")
    get_settings.cache_clear()
    settings = get_settings()
    with pytest.raises(EncryptionKeyMissing):
        encrypt_api_key("some-key", settings)


def test_decrypt_fails_loudly_if_the_encryption_key_changed():
    from cryptography.fernet import Fernet

    settings = get_settings()
    ciphertext = encrypt_api_key("sk-real-secret-key-123", settings)

    class _FakeSettings:
        api_key_encryption_key = Fernet.generate_key().decode()  # a DIFFERENT key

    with pytest.raises(EncryptionKeyMissing):
        decrypt_api_key(ciphertext, _FakeSettings())


async def test_session_lifecycle():
    redis = get_redis()
    settings = get_settings()

    token = await create_session(redis, user_id=42, settings=settings)
    assert await get_session_user_id(redis, token) == 42

    await delete_session(redis, token)
    assert await get_session_user_id(redis, token) is None


async def test_unknown_session_token_returns_none():
    redis = get_redis()
    assert await get_session_user_id(redis, "not-a-real-token") is None
