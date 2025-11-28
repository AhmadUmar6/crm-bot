"""Authentication utilities for the CRMREBS FastAPI backend."""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

from fastapi import HTTPException, Request, status
from jose import JWTError, jwt

from config import settings

logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = 12 * 60  # 12 hours
TOKEN_COOKIE_NAME = "crmrebs_token"


def _get_cookie_secret() -> str:
    secret = (
        settings.cookie_secret_key.get_secret_value()
        if settings.cookie_secret_key
        else None
    )
    if not secret:
        raise RuntimeError(
            "COOKIE_SECRET_KEY is not configured. Populate it in backend/.env."
        )
    return secret


def create_access_token(subject: str, expires_delta: Optional[timedelta] = None) -> str:
    """Generate a JWT for the given subject."""
    if expires_delta is None:
        expires_delta = timedelta(minutes=TOKEN_EXPIRE_MINUTES)

    now = datetime.now(timezone.utc)
    expire = now + expires_delta

    payload: Dict[str, Any] = {"sub": subject, "iat": now, "exp": expire}
    token = jwt.encode(payload, _get_cookie_secret(), algorithm=ALGORITHM)
    return token


async def get_current_user(request: Request) -> Dict[str, Any]:
    """Validate the JWT provided via cookie or Authorization header."""
    token = request.cookies.get(TOKEN_COOKIE_NAME)
    if not token:
        auth_header = request.headers.get("Authorization", "")
        if auth_header.lower().startswith("bearer "):
            token = auth_header.split(" ", 1)[1].strip()

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    try:
        payload = jwt.decode(token, _get_cookie_secret(), algorithms=[ALGORITHM])
    except JWTError:
        logger.warning("Invalid authentication token supplied.")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication credentials",
        ) from None

    return payload

