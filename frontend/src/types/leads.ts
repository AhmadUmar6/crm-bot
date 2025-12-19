export type LeadStatus = "LEAD" | "REACHED_OUT" | "ERROR";

export interface OutreachHistoryEntry {
  date?: string;
  success: boolean;
  note?: string | null;
}

export interface Lead {
  property_id: string;
  display_id: string;
  title: string;
  date_added: string;
  lister_name: string;
  lister_phone?: string | null;
  status: LeadStatus;
  outreach_history: OutreachHistoryEntry[];
  crm_raw: Record<string, unknown>;
  last_message_excerpt?: string | null;
  last_message_at?: string | null;
  unread_count?: number;
}

export interface LeadsResponse {
  leads: Lead[];
}

export interface ConversationMessage {
  id?: string | null;
  direction: "inbound" | "outbound";
  message: string;
  message_type: string;
  timestamp: string;
  status?: string | null;
}

export interface MessagesResponse {
  messages: ConversationMessage[];
}

export interface Template {
  name: string;
  display_name: string;
}

export interface TemplatesResponse {
  templates: Template[];
}





