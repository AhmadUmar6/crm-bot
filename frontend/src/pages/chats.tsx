import clsx from "clsx";
import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { ConversationPanel } from "@/components/ConversationPanel";
import { InlineNotice } from "@/components/InlineNotice";
import { LeadFiltersPanel } from "@/components/LeadFilters";
import { PageShell } from "@/components/PageShell";
import { fetchHistoryLeads } from "@/lib/api";
import { formatMessageTimestamp } from "@/lib/dates";
import {
  DEFAULT_LEAD_FILTERS,
  LeadFilters,
  applyLeadFilters,
} from "@/lib/leads";
import type { Lead } from "@/types/leads";

const refreshIntervalMs = 30_000;

function getLastTimelineEntry(lead: Lead) {
  const history = lead.outreach_history ?? [];
  return history[history.length - 1];
}

function getActivityTimestamp(lead: Lead) {
  return (
    lead.last_message_at ??
    getLastTimelineEntry(lead)?.date ??
    lead.date_added ??
    null
  );
}

function getActivityValue(lead: Lead) {
  const ts = getActivityTimestamp(lead);
  return ts ? Date.parse(ts) || 0 : 0;
}

function getInitials(lead: Lead) {
  const source = lead.lister_name || lead.title || lead.display_id || "";
  const words = source.trim().split(/\s+/);
  if (words.length === 0) {
    return "L";
  }
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return (words[0][0] + words[1][0]).toUpperCase();
}

function getPreviewText(lead: Lead) {
  if (lead.last_message_excerpt) {
    return lead.last_message_excerpt;
  }
  const last = getLastTimelineEntry(lead);
  if (last?.note) {
    return last.note;
  }
  if (lead.status) {
    return `Status: ${lead.status}`;
  }
  return "No messages yet. Tap to start chatting.";
}

function matchesSearch(lead: Lead, query: string) {
  if (!query) return true;
  const lowered = query.toLowerCase();
  return [
    lead.lister_name,
    lead.title,
    lead.lister_phone,
    lead.display_id,
    lead.last_message_excerpt,
  ]
    .flatMap((value) => (value ? [value.toString().toLowerCase()] : []))
    .some((value) => value.includes(lowered));
}

export default function ChatsPage() {
  const router = useRouter();
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [appliedFilters, setAppliedFilters] =
    useState<LeadFilters>(DEFAULT_LEAD_FILTERS);
  const [searchTerm, setSearchTerm] = useState("");
  const [showFilters, setShowFilters] = useState(false);

  const { data, error, isLoading, mutate } = useSWR(
    "/api/leads/history",
    () => fetchHistoryLeads(),
    {
      refreshInterval: refreshIntervalMs,
      revalidateOnFocus: true,
    }
  );

  useEffect(() => {
    if (error && (error as { status?: number }).status === 401) {
      void router.replace("/login");
    }
  }, [error, router]);

  const filteredLeads = useMemo(() => {
    const leads = data?.leads ?? [];
    return applyLeadFilters(leads, appliedFilters);
  }, [data?.leads, appliedFilters]);

  const searchedLeads = useMemo(() => {
    if (!searchTerm) return filteredLeads;
    return filteredLeads.filter((lead) => matchesSearch(lead, searchTerm));
  }, [filteredLeads, searchTerm]);

  const sortedLeads = useMemo(() => {
    return [...searchedLeads].sort(
      (a, b) => getActivityValue(b) - getActivityValue(a)
    );
  }, [searchedLeads]);

  const hasLeads = sortedLeads.length > 0;
  const resultsCount = sortedLeads.length;

  return (
    <>
      <Head>
        <title>Chats · CRMREBS</title>
      </Head>

      <PageShell
        title="Chats"
        subtitle="Stay on top of every conversation with sellers."
      >
        <div className="space-y-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1 sm:max-w-xs">
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                placeholder="Search chats"
                className="w-full rounded-full border border-slate-200 bg-white px-4 py-2 text-sm text-black placeholder:text-black/40 focus:border-slate-400 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <button
              type="button"
              onClick={() => setShowFilters((prev) => !prev)}
              className="inline-flex items-center justify-center rounded-full border border-slate-200 px-5 py-2 text-sm font-medium text-black transition-colors hover:border-slate-300 hover:text-black/70"
            >
              {showFilters ? "Hide filters" : "Show filters"}
            </button>
          </div>

          {showFilters ? (
            <LeadFiltersPanel
              leads={data?.leads ?? []}
              appliedFilters={appliedFilters}
              onApply={(filters) => setAppliedFilters(filters)}
              onReset={() => setAppliedFilters(DEFAULT_LEAD_FILTERS)}
            />
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium text-black">
            <span>Rezultate: {resultsCount}</span>
            {searchTerm ? (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                className="text-sm font-medium text-slate-500 underline-offset-4 hover:text-slate-700"
              >
                Clear search
              </button>
            ) : null}
          </div>

          {isLoading ? (
            <InlineNotice tone="info" description="Loading conversations…" />
          ) : null}

          {error && !isLoading ? (
            <InlineNotice
              tone="error"
              title="We couldn’t load your chats."
              description={
                (error as Error).message ??
                "Please refresh or sign in again."
              }
            />
          ) : null}

          {!isLoading && !error && !hasLeads ? (
            <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-slate-500">
              No conversations yet. Messages will appear here as they come in.
            </div>
          ) : null}

          {hasLeads ? (
            <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              {sortedLeads.map((lead) => {
                const isActive = lead.property_id === activeLead?.property_id;
                const timestamp = getActivityTimestamp(lead);
                const readableTime = timestamp
                  ? formatMessageTimestamp(timestamp)
                  : null;
                return (
                  <button
                    key={lead.property_id}
                    type="button"
                    onClick={() => setActiveLead(lead)}
                    className={clsx(
                      "flex w-full gap-4 px-4 py-4 text-left transition-colors sm:px-5",
                      isActive
                        ? "bg-slate-100"
                        : "hover:bg-slate-50 focus:bg-slate-100"
                    )}
                  >
                    <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-slate-900 text-sm font-semibold uppercase tracking-wide text-white">
                      {getInitials(lead)}
                    </div>
                    <div className="flex flex-1 flex-col overflow-hidden">
                      <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-black sm:text-base">
                            {lead.lister_name || lead.title || lead.display_id}
                          </p>
                          <p className="truncate text-xs text-black/50">
                            {lead.lister_phone ?? "No phone"}
                          </p>
                        </div>
                        {readableTime ? (
                          <span className="text-xs font-medium text-black/40">
                            {readableTime}
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-2 truncate text-sm text-black/70">
                        {getPreviewText(lead)}
                      </p>
                    </div>
                    {lead.unread_count ? (
                      <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-slate-900 px-2 text-xs font-semibold text-white">
                        {lead.unread_count}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : null}
        </div>

        {activeLead ? (
          <ConversationPanel
            lead={activeLead}
            onClose={() => setActiveLead(null)}
            onRefreshLeads={async () => {
              await mutate();
            }}
          />
        ) : null}
      </PageShell>
    </>
  );
}


