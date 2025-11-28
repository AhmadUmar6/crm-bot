"""CRMREBS polling script.

This module fetches the latest property listings from the CRMREBS API,
detects newly-added listings, enriches them with contact information,
and persists them into Firestore using the shared backend configuration.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from functools import lru_cache
from typing import Any, Dict, Optional

import requests
from requests import Response, Session

from config import LeadRecord, LeadStatus, db, settings

logger = logging.getLogger("crmrebs.poller")

DEFAULT_TIMEOUT = 30  # seconds


def _configure_logging() -> None:
    """Initialise a basic logging configuration if none is active."""
    if not logging.getLogger().handlers:
        logging.basicConfig(
            level=logging.INFO,
            format="%(asctime)s %(levelname)s [%(name)s] %(message)s",
        )


def _create_session() -> Session:
    """Return a requests session with the required CRM authentication headers."""
    token = settings.crm_api_key.get_secret_value() if settings.crm_api_key else None
    if not token:
        raise RuntimeError(
            "CRM_API_KEY is not configured. Populate it in backend/.env before polling."
        )

    session = requests.Session()
    session.headers.update(
        {
            "Authorization": f"Token {token}",
            "Accept": "application/json",
            "User-Agent": "CRMREBS-Poller/2.0",
        }
    )
    return session


def _parse_iso_datetime(value: Optional[str]) -> datetime:
    """Convert an ISO-formatted string to an aware UTC datetime for Firestore."""
    if not value:
        logger.warning("Missing date_added value; defaulting to current UTC time.")
        return datetime.now(timezone.utc)

    normalised = value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalised)
    except ValueError:
        logger.exception("Unable to parse date_added '%s'; defaulting to current UTC.", value)
        return datetime.now(timezone.utc)

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


@lru_cache(maxsize=1)
def _get_cutoff_datetime() -> Optional[datetime]:
    """Return the configured cutoff datetime (UTC) or None if not set."""
    raw_value = settings.crm_ignore_before
    if not raw_value:
        return None

    normalised = raw_value.replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalised)
    except ValueError:
        logger.error(
            "Invalid crm_ignore_before value '%s'; ignoring cutoff configuration.",
            raw_value,
        )
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _extract_contact_metadata(contact: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Simplify the CRM contact payload into the fields required for leads."""
    first_name = (contact or {}).get("first_name") or ""
    last_name = (contact or {}).get("last_name") or ""
    name_parts = [part.strip() for part in [first_name, last_name] if part]
    lister_name = " ".join(name_parts) if name_parts else "N/A"

    phones = contact.get("phones") if isinstance(contact, dict) else None
    primary_phone: Optional[str] = None
    if isinstance(phones, list):
        for phone_entry in phones:
            number = (phone_entry or {}).get("phone")
            if number:
                primary_phone = number
                break

    return {"lister_name": lister_name, "lister_phone": primary_phone}


def _fetch_contacts(session: Session, property_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve the first contact record for a property."""
    contacts_url = f"{settings.crm_base_url.rstrip('/')}/api/properties/{property_id}/contacts/"

    try:
        response: Response = session.get(contacts_url, timeout=DEFAULT_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        logger.exception("Failed to fetch contacts for property %s", property_id)
        return None

    try:
        payload = response.json()
    except ValueError:
        logger.exception("Contacts response for property %s was not valid JSON", property_id)
        return None

    if isinstance(payload, list) and payload:
        return payload[0]

    logger.warning("No contacts returned for property %s; skipping lead creation.", property_id)
    return None


def _persist_lead(
    property_id: str,
    property_data: Dict[str, Any],
    contact_data: Dict[str, Any],
    date_added: datetime,
) -> None:
    """Normalise and write the lead document into Firestore."""
    contact_meta = _extract_contact_metadata(contact_data)

    lead_record = LeadRecord(
        property_id=int(property_data["id"]),
        display_id=str(property_data.get("display_id") or property_id),
        title=property_data.get("title") or "Untitled property",
        date_added=date_added,
        lister_name=contact_meta["lister_name"],
        lister_phone=contact_meta["lister_phone"],
        status=LeadStatus.LEAD,
        outreach_history=[],
        crm_raw=property_data,
    )

    doc_ref = db.collection("leads").document(property_id)
    doc_ref.set(lead_record.model_dump(mode="python"))
    logger.info("Persisted new lead %s (%s) to Firestore.", property_id, lead_record.display_id)


def process_listings_page(session: Session, api_url: str) -> None:
    """Fetch a page of listings and persist new leads; recurse through pagination."""
    logger.info("Fetching listings page: %s", api_url)

    try:
        response: Response = session.get(api_url, timeout=DEFAULT_TIMEOUT)
        response.raise_for_status()
    except requests.RequestException:
        logger.exception("Failed to fetch properties from %s", api_url)
        return

    try:
        payload = response.json()
    except ValueError:
        logger.exception("Listings response from %s was not valid JSON.", api_url)
        return

    results = payload.get("results") or []
    found_old_listing = False

    for property_data in results:
        prop_id_raw = property_data.get("id")
        if prop_id_raw is None:
            logger.warning("Skipping property without an ID: %s", property_data)
            continue

        property_id = str(prop_id_raw)
        doc_ref = db.collection("leads").document(property_id)
        if doc_ref.get().exists:
            logger.info("Encountered existing lead %s; stopping further pagination.", property_id)
            found_old_listing = True
            break

        date_added = _parse_iso_datetime(property_data.get("date_added"))
        cutoff = _get_cutoff_datetime()
        if cutoff and date_added < cutoff:
            logger.info(
                "Listing %s dated %s is before cutoff %s; stopping pagination.",
                property_id,
                date_added.isoformat(),
                cutoff.isoformat(),
            )
            found_old_listing = True
            break

        logger.info("Discovered new property %s; fetching contact data.", property_id)
        contact_data = _fetch_contacts(session, property_id)
        if contact_data is None:
            continue

        try:
            _persist_lead(property_id, property_data, contact_data, date_added)
        except Exception:
            logger.exception("Failed to persist lead for property %s", property_id)

    if not found_old_listing:
        next_page = payload.get("next")
        if next_page:
            process_listings_page(session, next_page)
        else:
            logger.info("No additional pages to process.")


def main() -> None:
    """Entry point for the polling script."""
    _configure_logging()
    logger.info("Starting CRM polling run.")

    try:
        session = _create_session()
    except RuntimeError:
        logger.exception("Unable to create CRM session; aborting poll.")
        return

    base_url = settings.crm_base_url.rstrip("/")
    initial_url = f"{base_url}/api/properties/?ordering=-date_added"
    process_listings_page(session, initial_url)

    logger.info("CRM polling run complete.")


if __name__ == "__main__":
    main()

