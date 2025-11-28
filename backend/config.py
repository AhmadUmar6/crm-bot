"""Centralized configuration and shared service clients for the CRMREBS project.

This module exposes:
    - `settings`: loaded environment configuration via pydantic-settings
    - `db`: Firestore client initialised with the Firebase Admin SDK
    - `twilio_client`: Twilio REST client (optional if credentials not provided)
    - Lead data model helpers for consistent Firestore documents
"""
from __future__ import annotations

import logging
from enum import Enum
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional

import firebase_admin
from firebase_admin import credentials, firestore
from google.cloud.firestore_v1 import Client as FirestoreClient
from pydantic import BaseModel, ConfigDict, Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

logger = logging.getLogger(__name__)


class Settings(BaseSettings):
    """Application configuration loaded from environment variables."""

    crm_api_key: Optional[SecretStr] = Field(default=None)
    crm_base_url: str = Field(default="https://realestateluxury.crmrebs.com")
    crm_ignore_before: Optional[str] = Field(
        default=None,
        description=(
            "ISO 8601 datetime; polling stops when encountering listings older than this."
        ),
    )

    whatsapp_business_account_id: Optional[str] = Field(default=None)
    whatsapp_phone_number_id: Optional[str] = Field(default=None)
    whatsapp_access_token: Optional[SecretStr] = Field(default=None)
    whatsapp_template_name: Optional[str] = Field(default=None)
    whatsapp_template_language: str = Field(default="en_US")
    whatsapp_template_parameter_count: int = Field(
        default=2, description="Number of body parameters expected by the template."
    )
    personal_whatsapp_link: Optional[str] = Field(
        default=None,
        description="Optional wa.me link included in outreach messages.",
    )
    whatsapp_webhook_verify_token: Optional[str] = Field(
        default=None,
        description="Verify token for WhatsApp webhook handshake.",
    )
    default_country_dial_code: str = Field(
        default="40",
        description="Default country dial code (without +) used when normalising phone numbers.",
    )

    firebase_service_account_json: Optional[str] = Field(default=None, description="Path to SA JSON")

    dashboard_password: Optional[SecretStr] = Field(default=None)
    cookie_secret_key: Optional[SecretStr] = Field(default=None)
    cors_allowed_origins: List[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        ]
    )

    model_config = SettingsConfigDict(
        env_file=Path(__file__).resolve().parent / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


class LeadStatus(str, Enum):
    """Valid state transitions for a lead document."""

    LEAD = "LEAD"
    REACHED_OUT = "REACHED_OUT"
    ERROR = "ERROR"


class OutreachHistoryEntry(BaseModel):
    """Represents a single outreach attempt stored in Firestore."""

    date: Any = Field(description="Timestamp of the outreach event")
    success: bool
    note: Optional[str] = Field(default=None, description="Optional contextual note")

    model_config = ConfigDict(extra="forbid")


class LeadRecord(BaseModel):
    """Canonical schema for leads stored in Firestore."""

    property_id: int
    display_id: str
    title: str
    date_added: Any
    lister_name: str
    lister_phone: Optional[str]
    status: LeadStatus = LeadStatus.LEAD
    outreach_history: List[OutreachHistoryEntry] = Field(default_factory=list)
    crm_raw: Dict[str, Any]

    model_config = ConfigDict(extra="forbid")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Cached accessor for application settings."""

    settings = Settings()  # type: ignore[call-arg]
    logger.debug("Settings loaded successfully")
    return settings


settings = get_settings()


def _resolve_service_account_path(path_str: str) -> Path:
    path = Path(path_str).expanduser().resolve()
    if not path.exists():
        raise FileNotFoundError(
            f"Firebase service account JSON not found at '{path}'. "
            "Update FIREBASE_SERVICE_ACCOUNT_JSON in your environment configuration."
        )
    return path


def _init_firestore(settings: Settings) -> FirestoreClient:
    if not firebase_admin._apps:
        if settings.firebase_service_account_json and Path(settings.firebase_service_account_json).exists():
            # Local development: Use the file
            cred = credentials.Certificate(settings.firebase_service_account_json)
            firebase_admin.initialize_app(cred)
            logger.info("Firebase initialized with JSON file.")
        else:
            # Production (Cloud Run): Use automatic Google Login
            firebase_admin.initialize_app()
            logger.info("Firebase initialized with Default Credentials.")
            
    return firestore.client()


db: FirestoreClient = _init_firestore(settings)

__all__ = [
    "LeadRecord",
    "LeadStatus",
    "OutreachHistoryEntry",
    "db",
    "settings",
]
