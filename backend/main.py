"""FastAPI application exposing authentication, lead management, and outreach endpoints."""
from __future__ import annotations

import re
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

import requests
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from google.api_core import exceptions as gcloud_exceptions
from google.cloud import firestore
from pydantic import BaseModel, Field

from auth import TOKEN_COOKIE_NAME, create_access_token, get_current_user
from config import LeadStatus, db, settings
from poll_crm import main as run_poller

logger = logging.getLogger("crmrebs.api")

GRAPH_API_BASE_URL = "https://graph.facebook.com/v20.0"

app = FastAPI(title="CRMREBS Backend", version="0.1.0")
# Split the string into a list right here
allowed_origins_list = settings.cors_allowed_origins.split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins_list, # Pass the new list
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class LoginRequest(BaseModel):
    password: str = Field(min_length=1)


class LoginResponse(BaseModel):
    success: bool


class LeadOut(BaseModel):
    property_id: str
    display_id: str
    title: str
    date_added: datetime
    lister_name: str
    lister_phone: Optional[str]
    status: LeadStatus
    outreach_history: List[Dict[str, Any]]
    crm_raw: Dict[str, Any]
    last_message_excerpt: Optional[str] = None
    last_message_at: Optional[datetime] = None
    unread_count: int = 0


class MessagePayload(BaseModel):
    id: Optional[str] = None
    direction: Literal["inbound", "outbound"]
    message: str
    message_type: str
    timestamp: datetime
    status: Optional[str] = None


class MessagesResponse(BaseModel):
    messages: List[MessagePayload]


class ReplyRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4096)


class MarkReadRequest(BaseModel):
    read: bool = True


class LeadsResponse(BaseModel):
    leads: List[LeadOut]


class SendWhatsAppRequest(BaseModel):
    property_id: str = Field(min_length=1)
    template_name: Optional[str] = Field(default=None, description="Template to use, falls back to default if not provided")


class TemplateOut(BaseModel):
    name: str
    display_name: str


class TemplatesResponse(BaseModel):
    templates: List[TemplateOut]


# Hardcoded available templates
AVAILABLE_TEMPLATES = [
    {"name": "new_leads", "display_name": "Template 1"},
    {"name": "new_leads2", "display_name": "Template 2"},
]


class ActionResponse(BaseModel):
    success: bool
    message: Optional[str] = None


def _ensure_password_configured() -> str:
    secret = (
        settings.dashboard_password.get_secret_value()
        if settings.dashboard_password
        else None
    )
    if not secret:
        raise RuntimeError(
            "DASHBOARD_PASSWORD is not configured. Populate it in backend/.env."
        )
    return secret


def _serialize_lead(doc_snapshot) -> LeadOut:
    data = doc_snapshot.to_dict() or {}
    try:
        status_value = LeadStatus(data.get("status", LeadStatus.LEAD.value))
    except ValueError:
        status_value = LeadStatus.LEAD

    outreach_history = data.get("outreach_history") or []

    return LeadOut(
        property_id=doc_snapshot.id,
        display_id=data.get("display_id") or doc_snapshot.id,
        title=data.get("title") or "Untitled property",
        date_added=data.get("date_added") or datetime.now(timezone.utc),
        lister_name=data.get("lister_name") or "N/A",
        lister_phone=data.get("lister_phone"),
        status=status_value,
        outreach_history=outreach_history,
        crm_raw=data.get("crm_raw") or {},
        last_message_excerpt=data.get("last_message_excerpt"),
        last_message_at=data.get("last_message_at"),
        unread_count=int(data.get("unread_count") or 0),
    )


def _query_leads_by_status(status_value: LeadStatus) -> List[LeadOut]:
    query = (
        db.collection("leads")
        .where("status", "==", status_value.value)
        .order_by("date_added", direction=firestore.Query.DESCENDING)
    )
    try:
        return [_serialize_lead(doc) for doc in query.stream()]
    except gcloud_exceptions.FailedPrecondition as exc:
        logger.error("Firestore index missing: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Firestore index missing for leads query. Create a composite index on status asc, date_added desc and retry.",
        ) from exc


def _append_history(
    existing_data: Dict[str, Any],
    success: bool,
    note: Optional[str] = None,
) -> List[Dict[str, Any]]:
    history = list(existing_data.get("outreach_history") or [])
    history.append(
        {
            "date": datetime.now(timezone.utc),
            "success": success,
            **({"note": note} if note else {}),
        }
    )
    return history


def _normalize_phone(phone: Optional[str]) -> str:
    """Strip all non-digit characters from phone number."""
    if not phone:
        return ""
    return re.sub(r"\D", "", phone)


def _normalize_phone_with_country_code(phone: Optional[str]) -> str:
    """Normalize phone number and ensure country code prefix is present."""
    normalized = _normalize_phone(phone)
    if not normalized:
        return ""
    # Remove international prefix if present (e.g., "0040" -> "40")
    if normalized.startswith("00"):
        normalized = normalized[2:]
    default_code = settings.default_country_dial_code or ""
    if default_code and not normalized.startswith(default_code):
        # Handle local format starting with 0 (e.g., "0712345678" -> "40712345678")
        if normalized.startswith("0"):
            normalized = default_code + normalized[1:]
        # Handle short numbers without country code
        elif len(normalized) <= 10:
            normalized = default_code + normalized
    return normalized


def _format_whatsapp_recipient(phone: Optional[str]) -> Optional[str]:
    normalized = _normalize_phone_with_country_code(phone)
    if not normalized:
        return None
    return normalized


def _parse_whatsapp_timestamp(raw_ts: Optional[str]) -> datetime:
    try:
        return datetime.fromtimestamp(int(raw_ts), tz=timezone.utc)
    except (TypeError, ValueError):
        return datetime.now(timezone.utc)


def _record_message(
    property_id: str,
    *,
    direction: Literal["inbound", "outbound"],
    message: str,
    message_type: str,
    timestamp: Optional[datetime] = None,
    status: Optional[str] = None,
    message_id: Optional[str] = None,
    raw: Optional[Dict[str, Any]] = None,
    reset_unread: bool = False,
) -> None:
    ts = timestamp or datetime.now(timezone.utc)
    doc_ref = db.collection("leads").document(property_id)
    message_doc_ref = doc_ref.collection("messages").document()
    payload = {
        "direction": direction,
        "message": message,
        "message_type": message_type,
        "timestamp": ts,
        "status": status,
        "message_id": message_id,
        "raw": raw,
    }
    message_doc_ref.set(payload)

    updates: Dict[str, Any] = {
        "last_message_excerpt": message[:200],
        "last_message_at": ts,
    }
    if direction == "inbound":
        updates["unread_count"] = firestore.Increment(1)
    elif reset_unread:
        updates["unread_count"] = 0
    doc_ref.update(updates)

    if message_id:
        db.collection("message_index").document(message_id).set(
            {
                "property_id": property_id,
                "message_doc_id": message_doc_ref.id,
                "direction": direction,
                "created_at": ts,
            }
        )


def _update_message_status(
    message_id: Optional[str],
    status_value: Optional[str],
    timestamp: Optional[datetime],
) -> None:
    if not message_id or not status_value:
        return
    index_doc = db.collection("message_index").document(message_id).get()
    if not index_doc.exists:
        logger.debug("No message index entry found for status update %s", message_id)
        return

    index_data = index_doc.to_dict() or {}
    property_id = index_data.get("property_id")
    message_doc_id = index_data.get("message_doc_id")
    if not property_id or not message_doc_id:
        return

    msg_doc_ref = (
        db.collection("leads")
        .document(property_id)
        .collection("messages")
        .document(message_doc_id)
    )
    updates: Dict[str, Any] = {"status": status_value}
    if timestamp:
        updates["status_updated_at"] = timestamp

    try:
        msg_doc_ref.update(updates)
    except Exception as exc:  # pragma: no cover
        logger.warning(
            "Failed to update message status for %s: %s", message_doc_id, exc
        )


def _find_lead_by_phone(phone: Optional[str]):
    """Find a lead by phone number with backward-compatible search."""
    normalized_with_code = _normalize_phone_with_country_code(phone)
    if not normalized_with_code:
        return None
    
    # First try: exact match with country code (for new leads stored correctly)
    query = (
        db.collection("leads")
        .where("lister_phone_normalized", "==", normalized_with_code)
        .limit(1)
        .stream()
    )
    for doc in query:
        return doc
    
    # Fallback: Try searching without country code (for old leads stored as local format)
    normalized_raw = _normalize_phone(phone)
    default_code = settings.default_country_dial_code or ""
    
    # Try removing country code prefix if present (e.g., "4078123456" -> "078123456")
    normalized_without_code = normalized_raw
    if default_code and normalized_raw.startswith(default_code):
        normalized_without_code = "0" + normalized_raw[len(default_code):]
    
    if normalized_without_code and normalized_without_code != normalized_with_code:
        query = (
            db.collection("leads")
            .where("lister_phone_normalized", "==", normalized_without_code)
            .limit(1)
            .stream()
        )
        for doc in query:
            # Auto-fix: Update the stored normalized number to include country code
            doc.reference.update({"lister_phone_normalized": normalized_with_code})
            return doc
    
    # Last resort: Scan leads that might not have normalized field set correctly
    # Check leads without normalized field or with different format (for backward compatibility)
    all_leads = db.collection("leads").stream()
    for doc in all_leads:
        lead_data = doc.to_dict() or {}
        stored_normalized = lead_data.get("lister_phone_normalized")
        raw_phone = lead_data.get("lister_phone")
        
        if not raw_phone:
            continue
            
        # If normalized field matches what we're looking for, we would have found it already
        # So only check if it's different or missing
        if stored_normalized == normalized_with_code:
            continue  # Already checked in first query
            
        # Try normalizing the stored raw phone and compare
        stored_normalized_with_code = _normalize_phone_with_country_code(raw_phone)
        if stored_normalized_with_code == normalized_with_code:
            # Found match by raw phone - update normalized field for future searches
            doc.reference.update({"lister_phone_normalized": normalized_with_code})
            return doc
    
    return None


def _ensure_whatsapp_configured() -> Dict[str, Optional[str]]:
    missing = []
    phone_number_id = settings.whatsapp_phone_number_id
    template_name = settings.whatsapp_template_name
    access_token = (
        settings.whatsapp_access_token.get_secret_value()
        if settings.whatsapp_access_token
        else None
    )

    if not phone_number_id:
        missing.append("WHATSAPP_PHONE_NUMBER_ID")
    if not template_name:
        missing.append("WHATSAPP_TEMPLATE_NAME")
    if not access_token:
        missing.append("WHATSAPP_ACCESS_TOKEN")

    if missing:
        raise RuntimeError(
            "WhatsApp Cloud API is not fully configured. Missing: "
            + ", ".join(missing)
        )

    return {
        "phone_number_id": phone_number_id,
        "template_name": template_name,
        "access_token": access_token,
        "language": settings.whatsapp_template_language or "en_US",
        "personal_link": settings.personal_whatsapp_link,
        "parameter_count": settings.whatsapp_template_parameter_count,
    }


def _build_template_components(
    lead_data: Dict[str, Any],
    personal_link: Optional[str],
    parameter_count: int,
) -> List[Dict[str, Any]]:
    if parameter_count <= 0:
        return []

    parameters: List[Dict[str, str]] = []

    if parameter_count >= 1:
        parameters.append(
            {"type": "text", "text": lead_data.get("lister_name") or "there"}
        )

    if parameter_count >= 2:
        parameters.append(
            {"type": "text", "text": lead_data.get("title") or "your property"}
        )

    if parameter_count >= 3:
        link_value = personal_link or lead_data.get("crm_raw", {}).get(
            "listing_link", ""
        )
        parameters.append({"type": "text", "text": str(link_value or "")})

    while len(parameters) < parameter_count:
        parameters.append({"type": "text", "text": ""})

    return [{"type": "body", "parameters": parameters}]


@app.post("/api/login", response_model=LoginResponse)
async def login(payload: LoginRequest, response: Response) -> LoginResponse:
    configured_password = _ensure_password_configured()
    if payload.password != configured_password:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid password."
        )

    token = create_access_token(subject="dashboard_admin")
    response.set_cookie(
        key=TOKEN_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=60 * 60 * 12,
    )
    return LoginResponse(success=True)


@app.post("/api/poll")
async def trigger_poller() -> ActionResponse:
    """Trigger the CRM polling script. Used by Cloud Scheduler."""
    try:
        run_poller()
        return ActionResponse(success=True, message="Polling completed.")
    except Exception as exc:
        logger.exception("Polling failed")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Polling failed: {str(exc)}",
        ) from exc


@app.get("/api/templates", response_model=TemplatesResponse)
async def get_templates(
    user: Dict[str, Any] = Depends(get_current_user),
) -> TemplatesResponse:
    """Return available WhatsApp message templates."""
    return TemplatesResponse(
        templates=[TemplateOut(**t) for t in AVAILABLE_TEMPLATES]
    )


@app.get("/api/leads/new", response_model=LeadsResponse)
async def get_new_leads(
    request: Request, user: Dict[str, Any] = Depends(get_current_user)
) -> LeadsResponse:
    leads = _query_leads_by_status(LeadStatus.LEAD)
    return LeadsResponse(leads=leads)


@app.get("/api/leads/history", response_model=LeadsResponse)
async def get_history_leads(
    request: Request, user: Dict[str, Any] = Depends(get_current_user)
) -> LeadsResponse:
    leads = _query_leads_by_status(LeadStatus.REACHED_OUT)
    return LeadsResponse(leads=leads)


@app.post("/api/send-whatsapp", response_model=ActionResponse)
async def send_whatsapp(
    payload: SendWhatsAppRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> JSONResponse | ActionResponse:
    doc_ref = db.collection("leads").document(payload.property_id)
    doc_snapshot = doc_ref.get()

    if not doc_snapshot.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found.")

    lead_data = doc_snapshot.to_dict() or {}
    if lead_data.get("status") != LeadStatus.LEAD.value:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Lead already processed."},
        )

    lister_phone = lead_data.get("lister_phone")
    if not lister_phone:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Lead is missing a phone number."},
        )

    recipient = _format_whatsapp_recipient(lister_phone)
    if not recipient:
        return JSONResponse(
            status_code=status.HTTP_400_BAD_REQUEST,
            content={"error": "Lead phone number is invalid."},
        )

    try:
        whatsapp_config = _ensure_whatsapp_configured()
    except RuntimeError as exc:
        logger.error(str(exc))
        history = _append_history(lead_data, success=False, note="WhatsApp not configured")
        doc_ref.update({"outreach_history": history})
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "WhatsApp Cloud API not configured."},
        )

    # Use provided template or fall back to default from config
    template_to_use = payload.template_name or whatsapp_config["template_name"]
    
    # Validate template exists in our list (optional safety check)
    valid_template_names = [t["name"] for t in AVAILABLE_TEMPLATES]
    if template_to_use not in valid_template_names:
        logger.warning("Template '%s' not in allowed list, using default", template_to_use)
        template_to_use = whatsapp_config["template_name"]

    payload_template: Dict[str, Any] = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "template",
        "template": {
            "name": template_to_use,
            "language": {"code": whatsapp_config["language"]},
        },
    }

    components = _build_template_components(
        lead_data,
        whatsapp_config.get("personal_link"),
        int(whatsapp_config.get("parameter_count") or 0),
    )
    if components:
        payload_template["template"]["components"] = components

    headers = {
        "Authorization": f"Bearer {whatsapp_config['access_token']}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            f"{GRAPH_API_BASE_URL}/{whatsapp_config['phone_number_id']}/messages",
            headers=headers,
            json=payload_template,
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.exception("WhatsApp API request failed for property %s", payload.property_id)
        history = _append_history(lead_data, success=False, note="WhatsApp API request failed")
        doc_ref.update(
            {
                "status": LeadStatus.ERROR.value,
                "outreach_history": history,
            }
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "WhatsApp API request failed."},
        )

    if not response.ok:
        logger.error(
            "WhatsApp API responded with %s: %s",
            response.status_code,
            response.text,
        )
        history = _append_history(lead_data, success=False, note="WhatsApp API error")
        doc_ref.update(
            {
                "status": LeadStatus.ERROR.value,
                "outreach_history": history,
            }
        )
        return JSONResponse(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            content={"error": "WhatsApp API returned an error."},
        )

    try:
        response_body = response.json()
    except ValueError:
        response_body = {}
    message_id: Optional[str] = None
    try:
        message_id = (response_body.get("messages") or [{}])[0].get("id")
    except Exception:  # pragma: no cover
        message_id = None

    parameter_count = int(whatsapp_config.get("parameter_count") or 0)

    if parameter_count == 0:
        preview_text = f"Template sent: {template_to_use}"
    else:
        preview_text = (
            f"Hi {lead_data.get('lister_name', 'there')}, we saw your new listing "
            f"for {lead_data.get('title', 'your property')} is live!"
        )
        personal_link = whatsapp_config.get("personal_link")
        if parameter_count >= 3 and personal_link:
            preview_text = f"{preview_text} {personal_link}"

    _record_message(
        payload.property_id,
        direction="outbound",
        message=preview_text,
        message_type="template",
        timestamp=datetime.now(timezone.utc),
        status="sent",
        message_id=message_id,
        raw={"request": payload_template, "response": response_body},
        reset_unread=True,
    )

    history = _append_history(lead_data, success=True)
    doc_ref.update(
        {
            "status": LeadStatus.REACHED_OUT.value,
            "outreach_history": history,
            "lister_phone_normalized": _normalize_phone_with_country_code(lister_phone),
        }
    )

    return ActionResponse(success=True, message="WhatsApp message sent.")


@app.get("/api/leads/{property_id}/messages", response_model=MessagesResponse)
async def get_lead_messages(
    property_id: str, user: Dict[str, Any] = Depends(get_current_user)
) -> MessagesResponse:
    doc_ref = db.collection("leads").document(property_id)
    doc_snapshot = doc_ref.get()
    if not doc_snapshot.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found.")

    message_docs = (
        doc_ref.collection("messages")
        .order_by("timestamp", direction=firestore.Query.ASCENDING)
        .stream()
    )

    messages: List[MessagePayload] = []
    for msg_doc in message_docs:
        msg_data = msg_doc.to_dict() or {}
        messages.append(
            MessagePayload(
                id=msg_doc.id,
                direction=msg_data.get("direction", "outbound"),
                message=msg_data.get("message", ""),
                message_type=msg_data.get("message_type", "text"),
                timestamp=msg_data.get("timestamp", datetime.now(timezone.utc)),
                status=msg_data.get("status"),
            )
        )

    return MessagesResponse(messages=messages)


@app.post("/api/leads/{property_id}/reply", response_model=ActionResponse)
async def send_manual_reply(
    property_id: str,
    payload: ReplyRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ActionResponse:
    doc_ref = db.collection("leads").document(property_id)
    doc_snapshot = doc_ref.get()
    if not doc_snapshot.exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found.")

    lead_data = doc_snapshot.to_dict() or {}
    recipient = _format_whatsapp_recipient(lead_data.get("lister_phone"))
    if not recipient:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Lead phone number is invalid.",
        )

    try:
        whatsapp_config = _ensure_whatsapp_configured()
    except RuntimeError as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)
        ) from exc

    request_payload = {
        "messaging_product": "whatsapp",
        "to": recipient,
        "type": "text",
        "text": {"preview_url": False, "body": payload.message},
    }
    headers = {
        "Authorization": f"Bearer {whatsapp_config['access_token']}",
        "Content-Type": "application/json",
    }

    try:
        response = requests.post(
            f"{GRAPH_API_BASE_URL}/{whatsapp_config['phone_number_id']}/messages",
            headers=headers,
            json=request_payload,
            timeout=15,
        )
    except requests.RequestException as exc:
        logger.exception("Failed to send manual reply for %s", property_id)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Failed to reach WhatsApp API.",
        ) from exc

    if not response.ok:
        logger.error(
            "WhatsApp API error when sending manual reply %s: %s",
            response.status_code,
            response.text,
        )
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="WhatsApp API returned an error.",
        )

    try:
        response_body = response.json()
    except ValueError:
        response_body = {}
    message_id: Optional[str] = None
    try:
        message_id = (response_body.get("messages") or [{}])[0].get("id")
    except Exception:  # pragma: no cover
        message_id = None

    _record_message(
        property_id,
        direction="outbound",
        message=payload.message,
        message_type="text",
        timestamp=datetime.now(timezone.utc),
        status="sent",
        message_id=message_id,
        raw={"request": request_payload, "response": response_body},
        reset_unread=True,
    )

    doc_ref.update(
        {
            "status": LeadStatus.REACHED_OUT.value,
            "lister_phone_normalized": _normalize_phone_with_country_code(lead_data.get("lister_phone")),
        }
    )

    return ActionResponse(success=True, message="Reply sent.")


@app.post("/api/leads/{property_id}/mark-read", response_model=ActionResponse)
async def mark_conversation_read(
    property_id: str,
    payload: MarkReadRequest,
    user: Dict[str, Any] = Depends(get_current_user),
) -> ActionResponse:
    doc_ref = db.collection("leads").document(property_id)
    if not doc_ref.get().exists:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Lead not found.")

    doc_ref.update({"unread_count": 0})
    return ActionResponse(success=True, message="Conversation marked as read.")


@app.get("/api/webhooks/whatsapp")
async def whatsapp_webhook_verify(
    hub_mode: Optional[str] = Query(None, alias="hub.mode"),
    hub_verify_token: Optional[str] = Query(None, alias="hub.verify_token"),
    hub_challenge: Optional[str] = Query(None, alias="hub.challenge"),
):
    verify_token = settings.whatsapp_webhook_verify_token
    if hub_mode == "subscribe" and hub_verify_token:
        if verify_token and hub_verify_token == verify_token:
            return Response(content=hub_challenge or "", media_type="text/plain")
        logger.warning(
            "Webhook verification failed; provided token %s did not match expected token.",
            hub_verify_token,
        )

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN, detail="Verification failed."
    )


@app.post("/api/webhooks/whatsapp")
async def whatsapp_webhook_update(payload: Dict[str, Any]):
    logger.info("Received WhatsApp webhook payload: %s", payload)
    if settings.whatsapp_webhook_verify_token is None:
        logger.warning("Webhook received but verify token not configured.")

    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value") or {}
            contacts = value.get("contacts") or []
            wa_id = None
            if contacts:
                wa_id = contacts[0].get("wa_id")

            for message in value.get("messages") or []:
                sender_id = wa_id or message.get("from")
                lead_doc = _find_lead_by_phone(sender_id)
                if not lead_doc:
                    logger.warning("No lead found for incoming message from %s", sender_id)
                    continue

                property_id = lead_doc.id
                timestamp = _parse_whatsapp_timestamp(message.get("timestamp"))
                message_type = message.get("type", "text")
                body_text = ""

                if message_type == "text":
                    body_text = (message.get("text") or {}).get("body", "")
                elif message_type == "button":
                    body_text = (message.get("button") or {}).get("text", "")
                elif message_type == "interactive":
                    interactive = message.get("interactive") or {}
                    if "button_reply" in interactive:
                        body_text = interactive["button_reply"].get("title", "")
                    elif "list_reply" in interactive:
                        body_text = interactive["list_reply"].get("title", "")

                if not body_text:
                    logger.info(
                        "Received unsupported or empty message type %s for lead %s",
                        message_type,
                        property_id,
                    )
                    continue

                _record_message(
                    property_id,
                    direction="inbound",
                    message=body_text,
                    message_type=message_type,
                    timestamp=timestamp,
                    status="received",
                    message_id=message.get("id"),
                    raw=message,
                )

                normalized_sender = _normalize_phone_with_country_code(sender_id)
                if normalized_sender:
                    db.collection("leads").document(property_id).update(
                        {"lister_phone_normalized": normalized_sender}
                    )

            for status_obj in value.get("statuses") or []:
                status_id = status_obj.get("id")
                status_value = status_obj.get("status")
                status_ts = _parse_whatsapp_timestamp(status_obj.get("timestamp"))
                _update_message_status(status_id, status_value, status_ts)

    return {"success": True}