import type {
  LeadsResponse,
  MessagesResponse,
} from "@/types/leads";

// Smart URL: browser uses relative path (via proxy), server uses absolute path (direct)
const BASE_URL =
  typeof window === 'undefined'
    ? process.env.NEXT_PUBLIC_BACKEND_URL ?? "https://crmrebs-backend-746815019501.europe-west1.run.app"
    : process.env.NEXT_PUBLIC_BACKEND_URL ?? "";

interface ApiError extends Error {
  status?: number;
  payload?: unknown;
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    ...init,
  });

  if (!response.ok) {
    let payload: unknown = undefined;
    try {
      payload = await response.json();
    } catch {
      // ignore
    }
    const error: ApiError = new Error(
      (payload as { error?: string })?.error ??
        response.statusText ??
        "Request failed"
    );
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export async function fetchNewLeads(): Promise<LeadsResponse> {
  return request<LeadsResponse>("/api/leads/new");
}

export async function fetchHistoryLeads(): Promise<LeadsResponse> {
  return request<LeadsResponse>("/api/leads/history");
}

export async function sendWhatsApp(propertyId: string): Promise<void> {
  await request("/api/send-whatsapp", {
    method: "POST",
    body: JSON.stringify({ property_id: propertyId }),
  });
}

export async function login(password: string): Promise<void> {
  await request("/api/login", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

export async function fetchLeadMessages(
  propertyId: string
): Promise<MessagesResponse> {
  return request<MessagesResponse>(`/api/leads/${propertyId}/messages`);
}

export async function sendLeadReply(
  propertyId: string,
  message: string
): Promise<void> {
  await request(`/api/leads/${propertyId}/reply`, {
    method: "POST",
    body: JSON.stringify({ message }),
  });
}

export async function markConversationRead(
  propertyId: string
): Promise<void> {
  await request(`/api/leads/${propertyId}/mark-read`, {
    method: "POST",
    body: JSON.stringify({ read: true }),
  });
}

