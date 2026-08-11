"""HTTP-level coverage of the account-request/approval gate and the "no
fallback" search gate (app/api/deps.py). Pure pipeline correctness is
covered separately by tests/e2e/test_search_e2e.py -- this file is about
who is and isn't allowed to reach it, and with which provider.
"""

from __future__ import annotations

import datetime as dt

from app.models.auth import User
from app.providers.mock import mock_provider
from app.services.auth import hash_password

VALID_SEARCH_BODY = {
    "destination": {"regions": ["japan"]},
    "dates": {"departure_from": "2026-09-01", "departure_to": "2026-10-31"},
    "budget": {"currency": "CAD", "max_total": 2500},
}


async def _make_admin(session, username: str = "admin1") -> User:
    now = dt.datetime.now(dt.UTC)
    user = User(
        username=username,
        password_hash=hash_password("adminpassword"),
        status="approved",
        is_admin=True,
        created_at=now,
        decided_at=now,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    return user


async def _login(client, username: str, password: str) -> dict:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()


def _auth(token: str) -> dict:
    return {"Authorization": f"Bearer {token}"}


# ---------- registration / approval lifecycle ----------


async def test_register_creates_pending_account_not_logged_in(client, db_session):
    r = await client.post("/api/auth/register", json={"username": "newfriend", "password": "friendpass123"})
    assert r.status_code == 200
    assert r.json()["ok"] is True

    login = await client.post("/api/auth/login", json={"username": "newfriend", "password": "friendpass123"})
    assert login.status_code == 403
    assert "approval" in login.json()["detail"].lower()


async def test_duplicate_username_rejected(client, db_session):
    body = {"username": "dupe", "password": "somepassword1"}
    r1 = await client.post("/api/auth/register", json=body)
    assert r1.status_code == 200
    r2 = await client.post("/api/auth/register", json=body)
    assert r2.status_code == 409


async def test_login_wrong_password_rejected(client, db_session):
    await client.post("/api/auth/register", json={"username": "someone", "password": "correctpassword1"})
    r = await client.post("/api/auth/login", json={"username": "someone", "password": "wrongpassword"})
    assert r.status_code == 401


async def test_login_nonexistent_user_rejected(client, db_session):
    r = await client.post("/api/auth/login", json={"username": "ghost", "password": "whatever123"})
    assert r.status_code == 401


async def test_admin_approve_then_login_succeeds(client, db_session):
    await _make_admin(db_session)
    admin = await _login(client, "admin1", "adminpassword")

    await client.post("/api/auth/register", json={"username": "friend2", "password": "friendpass123"})
    accounts = (await client.get("/api/admin/accounts", headers=_auth(admin["token"]))).json()
    target = next(a for a in accounts if a["username"] == "friend2")
    assert target["status"] == "pending"

    approve = await client.post(f"/api/admin/accounts/{target['id']}/approve", headers=_auth(admin["token"]))
    assert approve.status_code == 200

    login = await _login(client, "friend2", "friendpass123")
    assert login["is_admin"] is False


async def test_admin_deny_blocks_login(client, db_session):
    await _make_admin(db_session)
    admin = await _login(client, "admin1", "adminpassword")
    await client.post("/api/auth/register", json={"username": "denyme", "password": "friendpass123"})
    accounts = (await client.get("/api/admin/accounts", headers=_auth(admin["token"]))).json()
    target = next(a for a in accounts if a["username"] == "denyme")

    await client.post(f"/api/admin/accounts/{target['id']}/deny", headers=_auth(admin["token"]))
    login = await client.post("/api/auth/login", json={"username": "denyme", "password": "friendpass123"})
    assert login.status_code == 403
    assert "denied" in login.json()["detail"].lower()


async def test_admin_set_password_lets_admin_recover_a_locked_out_friend(client, db_session):
    """No self-serve password reset (matches the reference app's model) --
    this is the actual recovery path.
    """
    await _make_admin(db_session)
    admin = await _login(client, "admin1", "adminpassword")
    await client.post("/api/auth/register", json={"username": "forgetful", "password": "oldpassword1"})
    accounts = (await client.get("/api/admin/accounts", headers=_auth(admin["token"]))).json()
    target = next(a for a in accounts if a["username"] == "forgetful")
    await client.post(f"/api/admin/accounts/{target['id']}/approve", headers=_auth(admin["token"]))

    await client.post(
        f"/api/admin/accounts/{target['id']}/set-password",
        headers=_auth(admin["token"]),
        json={"new_password": "brandnewpassword1"},
    )

    old_login = await client.post("/api/auth/login", json={"username": "forgetful", "password": "oldpassword1"})
    assert old_login.status_code == 401
    new_login = await client.post("/api/auth/login", json={"username": "forgetful", "password": "brandnewpassword1"})
    assert new_login.status_code == 200


# ---------- admin-only enforcement ----------


async def test_non_admin_cannot_reach_admin_routes(client, db_session):
    await client.post("/api/auth/register", json={"username": "regular", "password": "friendpass123"})
    await _make_admin(db_session)  # only so approval is possible via a second account
    admin = await _login(client, "admin1", "adminpassword")
    accounts = (await client.get("/api/admin/accounts", headers=_auth(admin["token"]))).json()
    target = next(a for a in accounts if a["username"] == "regular")
    await client.post(f"/api/admin/accounts/{target['id']}/approve", headers=_auth(admin["token"]))

    regular = await _login(client, "regular", "friendpass123")
    r = await client.get("/api/admin/accounts", headers=_auth(regular["token"]))
    assert r.status_code == 403


async def test_unauthenticated_requests_rejected(client, db_session):
    assert (await client.get("/api/auth/me")).status_code == 401
    assert (await client.post("/api/search", json=VALID_SEARCH_BODY)).status_code == 401
    assert (await client.get("/api/admin/accounts")).status_code == 401


# ---------- the "no fallback" search gate itself ----------


async def test_approved_user_without_key_cannot_search(client, db_session):
    await _make_admin(db_session)
    admin = await _login(client, "admin1", "adminpassword")
    await client.post("/api/auth/register", json={"username": "nokey", "password": "friendpass123"})
    accounts = (await client.get("/api/admin/accounts", headers=_auth(admin["token"]))).json()
    target = next(a for a in accounts if a["username"] == "nokey")
    await client.post(f"/api/admin/accounts/{target['id']}/approve", headers=_auth(admin["token"]))

    user = await _login(client, "nokey", "friendpass123")
    r = await client.post("/api/search", headers=_auth(user["token"]), json=VALID_SEARCH_BODY)
    assert r.status_code == 400
    assert "key" in r.json()["detail"].lower()


async def test_pending_user_cannot_search_even_with_a_key(client, db_session):
    r = await client.post(
        "/api/auth/register",
        json={"username": "pendingwithkey", "password": "friendpass123", "serpapi_api_key": "fake-key-123"},
    )
    assert r.status_code == 200

    # Never approved -- can't even log in, so there's no token to search with.
    login = await client.post("/api/auth/login", json={"username": "pendingwithkey", "password": "friendpass123"})
    assert login.status_code == 403


async def test_approved_user_with_key_can_search_uses_their_own_key_not_site_wide(client, seeded_session, monkeypatch):
    """The core promise of this whole feature: search succeeds once a key
    is set, and it runs on a provider built from THIS user's key -- not
    the site's. Swaps the actual network call for the mock provider
    (monkeypatching build_serpapi_provider, called only after the real
    approved+has-key gates already passed) so this stays a fast, offline,
    deterministic test rather than hitting real SerpApi with a fake key.
    """
    captured_keys = []

    def _fake_build(api_key):
        captured_keys.append(api_key)
        return mock_provider

    monkeypatch.setattr("app.api.deps.build_serpapi_provider", _fake_build)

    await _make_admin(seeded_session)
    admin_login = await _login(client, "admin1", "adminpassword")
    await client.post("/api/auth/register", json={"username": "haskey", "password": "friendpass123"})
    accounts = (await client.get("/api/admin/accounts", headers=_auth(admin_login["token"]))).json()
    target = next(a for a in accounts if a["username"] == "haskey")
    await client.post(f"/api/admin/accounts/{target['id']}/approve", headers=_auth(admin_login["token"]))

    user = await _login(client, "haskey", "friendpass123")
    put = await client.put(
        "/api/auth/api-key", headers=_auth(user["token"]), json={"serpapi_api_key": "this-friends-own-key"}
    )
    assert put.status_code == 200

    me = (await client.get("/api/auth/me", headers=_auth(user["token"]))).json()
    assert me["has_api_key"] is True

    resp = await client.post("/api/search", headers=_auth(user["token"]), json=VALID_SEARCH_BODY)
    assert resp.status_code == 200
    search_id = resp.json()["search_id"]

    import asyncio

    state = None
    for _ in range(500):
        state = (await client.get(f"/api/search/{search_id}", headers=_auth(user["token"]))).json()
        if state["status"] in ("done", "error"):
            break
        await asyncio.sleep(0.02)

    assert state["status"] == "done", state.get("error")
    assert captured_keys == ["this-friends-own-key"]
