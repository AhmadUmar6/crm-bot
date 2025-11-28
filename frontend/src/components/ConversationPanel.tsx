import clsx from "clsx";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import {
  fetchLeadMessages,
  markConversationRead,
  sendLeadReply,
} from "@/lib/api";
import { formatMessageTimestamp } from "@/lib/dates";
import type { ConversationMessage, Lead } from "@/types/leads";
import { InlineNotice } from "./InlineNotice";

interface ConversationPanelProps {
  lead: Lead;
  onClose: () => void;
  onRefreshLeads: () => Promise<void> | void;
}

export function ConversationPanel({
  lead,
  onClose,
  onRefreshLeads,
}: ConversationPanelProps) {
  const [draft, setDraft] = useState("");
  const [sendError, setSendError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const { data, error, isValidating, mutate } = useSWR(
    `/api/leads/${lead.property_id}/messages`,
    () => fetchLeadMessages(lead.property_id),
    {
      refreshInterval: 5000,
    }
  );

  useEffect(() => {
    void markConversationRead(lead.property_id).then(() => {
      void onRefreshLeads();
    });
  }, [lead.property_id, onRefreshLeads]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [data?.messages]);

  const messages = useMemo<ConversationMessage[]>(() => {
    return data?.messages ?? [];
  }, [data?.messages]);

  async function handleSend() {
    const trimmed = draft.trim();
    if (!trimmed) {
      return;
    }
    setSendError(null);
    try {
      await sendLeadReply(lead.property_id, trimmed);
      setDraft("");
      inputRef.current?.focus();
      await mutate();
      await onRefreshLeads();
    } catch (err) {
      setSendError(
        err instanceof Error
          ? err.message
          : "Failed to send message. Please try again."
      );
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 px-0 py-0 backdrop-blur-sm md:items-center md:px-4 md:py-6">
      <div className="flex h-full w-full max-w-3xl flex-col bg-white shadow-xl md:h-[90vh] md:rounded-2xl">
        <div className="flex items-start justify-between border-b border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3rem] text-black/60">
              {lead.display_id}
            </p>
            <h2 className="mt-1 text-lg font-semibold text-black sm:text-xl">
              {lead.title || "Untitled property"}
            </h2>
            <p className="mt-1 text-sm text-black/70">
              {lead.lister_name} · {lead.lister_phone ?? "No phone"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-slate-200 px-4 py-2 text-sm font-medium text-black transition-colors hover:border-slate-300 hover:text-black/70"
          >
            Close
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 space-y-3 overflow-y-auto bg-slate-50 px-3 py-4 sm:px-4 sm:py-6"
        >
          {error ? (
            <InlineNotice
              tone="error"
              description="We couldn’t load this conversation."
            />
          ) : null}

          {messages.length === 0 && !error ? (
            <InlineNotice
              tone="info"
              description="No messages yet. Start the conversation below."
            />
          ) : null}

          {messages.map((msg) => (
            <div
              key={msg.id ?? `${msg.timestamp}-${msg.direction}`}
              className={clsx("flex", {
                "justify-end": msg.direction === "outbound",
                "justify-start": msg.direction === "inbound",
              })}
            >
              <div
                className={clsx(
                  "max-w-[75%] rounded-2xl px-4 py-3 shadow-sm",
                  msg.direction === "outbound"
                    ? "bg-slate-900 text-white"
                    : "bg-white text-black"
                )}
              >
                <p className="text-sm leading-relaxed">{msg.message}</p>
                <div
                  className={clsx(
                    "mt-2 flex items-center justify-between text-xs md:text-[11px]",
                    msg.direction === "outbound"
                      ? "text-white/70"
                      : "text-black/50"
                  )}
                >
                  <span>{formatMessageTimestamp(msg.timestamp)}</span>
                  {msg.status ? <span>{msg.status}</span> : null}
                </div>
              </div>
            </div>
          ))}

          {isValidating && messages.length > 0 ? (
            <p className="text-center text-xs text-black/50">Updating…</p>
          ) : null}
        </div>

        <div className="border-t border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
          {sendError ? (
            <div className="mb-3">
              <InlineNotice tone="error" description={sendError} />
            </div>
          ) : null}
          <div className="space-y-3">
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type your reply…"
              rows={3}
              className="w-full rounded-xl border border-slate-300 px-4 py-3 text-sm text-black focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-black/50">
                Replies are sent via your approved WhatsApp template session.
              </p>
              <button
                type="button"
                onClick={handleSend}
                disabled={!draft.trim()}
                className="w-full rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
              >
                Send reply
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

