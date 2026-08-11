from __future__ import annotations

import datetime as dt

from pydantic import BaseModel, Field


class RegisterRequest(BaseModel):
    username: str = Field(min_length=3, max_length=16)
    password: str = Field(min_length=8, max_length=64)
    serpapi_api_key: str | None = Field(default=None, max_length=200)


class LoginRequest(BaseModel):
    username: str
    password: str


class ApiKeyUpdateRequest(BaseModel):
    serpapi_api_key: str = Field(min_length=1, max_length=200)


class AdminSetPasswordRequest(BaseModel):
    new_password: str = Field(min_length=8, max_length=64)


class SessionOut(BaseModel):
    token: str
    username: str
    is_admin: bool


class MeOut(BaseModel):
    username: str
    status: str
    is_admin: bool
    has_api_key: bool


class AdminAccountOut(BaseModel):
    id: int
    username: str
    status: str
    is_admin: bool
    has_api_key: bool
    created_at: dt.datetime
    decided_at: dt.datetime | None
