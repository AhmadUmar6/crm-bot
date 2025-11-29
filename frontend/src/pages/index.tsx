import Head from "next/head";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { InlineNotice } from "@/components/InlineNotice";
import { LeadFiltersPanel } from "@/components/LeadFilters";
import { ConversationPanel } from "@/components/ConversationPanel";
import { PageShell } from "@/components/PageShell";
import { fetchNewLeads, sendWhatsApp } from "@/lib/api";
import { formatFullDateTime, formatMessageTimestamp } from "@/lib/dates";
import {
  DEFAULT_LEAD_FILTERS,
  LeadFilters,
  applyLeadFilters,
  groupByDateAdded,
} from "@/lib/leads";
import type { Lead } from "@/types/leads";

const refreshIntervalMs = 15_000;

type Banner =
  | { tone: "info" | "success" | "error"; message: string }
  | null;

export default function DashboardPage() {
  const router = useRouter();
  const [multiSelectMode, setMultiSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());
  const [banner, setBanner] = useState<Banner>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [appliedFilters, setAppliedFilters] =
    useState<LeadFilters>(DEFAULT_LEAD_FILTERS);
  const [showFilters, setShowFilters] = useState(false);

  const { data, error, isLoading, mutate, isValidating } = useSWR(
    "/api/leads/new",
    () => fetchNewLeads(),
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

  const groupedLeads = useMemo(
    () => groupByDateAdded(filteredLeads),
    [filteredLeads]
  );

  useEffect(() => {
    if (!isValidating && !isLoading) {
      setPendingIds(new Set());
    }
  }, [isValidating, isLoading]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const allowedIds = new Set(filteredLeads.map((lead) => lead.property_id));
      const next = new Set<string>();
      prev.forEach((id) => {
        if (allowedIds.has(id)) {
          next.add(id);
        }
      });
      return next;
    });
  }, [filteredLeads]);

  useEffect(() => {
    if (!activeLead) return;
    const updated = filteredLeads.find(
      (lead) => lead.property_id === activeLead.property_id
    );
    if (updated && updated !== activeLead) {
      setActiveLead(updated);
    }
  }, [filteredLeads, activeLead?.property_id]);

  const toggleSelect = useCallback(
    (propertyId: string) => {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(propertyId)) {
          next.delete(propertyId);
        } else {
          next.add(propertyId);
        }
        return next;
      });
    },
    [setSelectedIds]
  );

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setMultiSelectMode(false);
  }, []);

  const handleSingleSend = useCallback(
    async (propertyId: string) => {
      setPendingIds((prev) => new Set(prev).add(propertyId));
      setBanner(null);
      try {
        await sendWhatsApp(propertyId);
        setBanner({ tone: "success", message: "WhatsApp message sent." });
        await mutate();
      } catch (err) {
        setBanner({
          tone: "error",
          message:
            err instanceof Error ? err.message : "Failed to send WhatsApp.",
        });
      } finally {
        setPendingIds((prev) => {
          const next = new Set(prev);
          next.delete(propertyId);
          return next;
        });
      }
    },
    [mutate]
  );

  const handleBulkSend = useCallback(async () => {
    if (selectedIds.size === 0) {
      return;
    }

    setBanner(null);
    const ids = Array.from(selectedIds);
    setPendingIds((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    let successCount = 0;
    let failureCount = 0;

    for (const id of ids) {
      try {
        await sendWhatsApp(id);
        successCount += 1;
      } catch {
        failureCount += 1;
      }
    }

    if (successCount > 0) {
      await mutate();
    }

    setPendingIds(new Set());
    setSelectedIds(new Set());
    setMultiSelectMode(false);

    if (failureCount === 0) {
      setBanner({
        tone: "success",
        message: `Sent ${successCount} WhatsApp message${
          successCount === 1 ? "" : "s"
        }.`,
      });
    } else {
      setBanner({
        tone: "error",
        message: `Sent ${successCount} messages, ${failureCount} failed.`,
      });
    }
  }, [selectedIds, mutate]);

  const handleCopy = useCallback((lead: Lead) => {
    if (!lead.lister_phone) return;
    void navigator.clipboard.writeText(lead.lister_phone);
    setCopiedId(lead.property_id);
    setTimeout(() => setCopiedId(null), 2000);
  }, []);

  const hasLeads = filteredLeads.length > 0;

  const actions = multiSelectMode ? (
    <>
      <button
        type="button"
        onClick={handleBulkSend}
        disabled={selectedIds.size === 0 || pendingIds.size > 0}
        className="rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        Send WhatsApp to Selected ({selectedIds.size})
      </button>
      <button
        type="button"
        onClick={clearSelection}
        className="rounded-full border border-black/20 px-5 py-2 text-sm font-medium text-black transition-colors hover:border-black/40 hover:bg-black/5"
      >
        Cancel selection
      </button>
    </>
  ) : (
    <button
      type="button"
      onClick={() => setMultiSelectMode(true)}
      disabled={!hasLeads}
      className="rounded-full border border-black/20 px-5 py-2 text-sm font-medium text-black transition-colors hover:border-black/40 hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-60"
    >
      Select multiple
    </button>
  );

  return (
    <>
      <Head>
        <title>Lead Queue · CRMREBS</title>
      </Head>

      <PageShell
        title="Lead Queue"
        subtitle="Review the newest properties and reach out instantly."
        actions={hasLeads ? actions : undefined}
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="text-sm font-medium text-black">
            Rezultate: {filteredLeads.length}
          </div>
          <button
            type="button"
            onClick={() => setShowFilters((prev) => !prev)}
            className="rounded-full border border-black/20 px-4 py-2 text-sm font-medium text-black transition-colors hover:border-black/40 hover:bg-black/5"
          >
            {showFilters ? "Hide filters" : "Show filters"}
          </button>
        </div>

        {showFilters && data?.leads ? (
          <div className="mb-6">
            <LeadFiltersPanel
              leads={data.leads}
              appliedFilters={appliedFilters}
              onApply={(filters) => setAppliedFilters(filters)}
              onReset={() => setAppliedFilters(DEFAULT_LEAD_FILTERS)}
            />
          </div>
        ) : null}


        {banner ? (
          <div className="mb-6">
            <InlineNotice tone={banner.tone} description={banner.message} />
          </div>
        ) : null}

        {isLoading ? (
          <InlineNotice
            tone="info"
            description="Checking for new leads…"
          />
        ) : null}

        {error && !isLoading ? (
          <InlineNotice
            tone="error"
            title="We couldn’t load the queue."
            description={
              (error as Error).message ??
              "Please refresh or sign in again."
            }
          />
        ) : null}

        {!isLoading && !error && !hasLeads ? (
          <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-6 py-10 text-center text-slate-500">
            Queue is empty! 🎉
          </div>
        ) : null}

        <div className="space-y-10">
          {groupedLeads.map((group) => (
            <section key={group.label}>
              <div className="flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs font-semibold uppercase tracking-[0.3rem] text-slate-400">
                  {group.label.toUpperCase()}
                </span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <div className="mt-6 space-y-4">
                {group.leads.map((lead) => {
                  const isSelected = selectedIds.has(lead.property_id);
                  const isSending = pendingIds.has(lead.property_id);
                  return (
                    <article
                      key={lead.property_id}
                      className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md"
                    >
                      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                        <div className="flex flex-1 items-start gap-4">
                          {multiSelectMode ? (
                            <input
                              type="checkbox"
                              aria-label={`Select lead ${lead.display_id}`}
                              checked={isSelected}
                              onChange={() => toggleSelect(lead.property_id)}
                              className="h-5 w-5 rounded border-slate-300 text-slate-900 focus:ring-slate-200"
                            />
                          ) : null}
                          <div>
                            <p className="text-xs font-medium uppercase tracking-[0.3rem] text-slate-400">
                              {lead.display_id}
                            </p>
                            <h2 className="mt-2 text-lg font-semibold text-slate-900">
                              {lead.title || "Untitled property"}
                            </h2>
                            <dl className="mt-4 grid gap-3 text-sm text-slate-600 md:grid-cols-2">
                              <div>
                                <dt className="font-medium text-black">
                                  Added
                                </dt>
                                <dd className="text-black/70">
                                  {formatFullDateTime(lead.date_added)}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium text-black">
                                  Seller
                                </dt>
                                <dd className="text-black/70">
                                  {lead.lister_name}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium text-black">
                                  Phone
                                </dt>
                                <dd className="flex items-center gap-2 text-black/70">
                                  {lead.lister_phone ?? "Unavailable"}
                                  {lead.lister_phone ? (
                                    <button
                                      type="button"
                                      onClick={() => handleCopy(lead)}
                                      className="text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-700"
                                    >
                                      {copiedId === lead.property_id
                                        ? "Copied"
                                        : "Copy"}
                                    </button>
                                  ) : null}
                                </dd>
                              </div>
                              <div>
                                <dt className="font-medium text-black">
                                  Status
                                </dt>
                                <dd>
                                  <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                                    {lead.status}
                                  </span>
                                </dd>
                              </div>
                              {lead.last_message_excerpt ? (
                                <div className="md:col-span-2">
                                  <dt className="font-medium text-black">
                                    Last message
                                  </dt>
                                  <dd className="text-black/70">
                                    {lead.last_message_excerpt}
                                    {lead.last_message_at ? (
                                      <span className="ml-2 text-xs text-black/40">
                                        {formatMessageTimestamp(
                                          lead.last_message_at
                                        )}
                                      </span>
                                    ) : null}
                                  </dd>
                                </div>
                              ) : null}
                            </dl>
                          </div>
                        </div>
                        <div className="flex flex-col gap-3 self-stretch sm:flex-row sm:flex-wrap sm:items-center md:w-48 md:flex-col md:items-end">
                          {!multiSelectMode && (
                            <button
                              type="button"
                              onClick={() => handleSingleSend(lead.property_id)}
                              disabled={
                                isSending || pendingIds.size > 0 || !lead.lister_phone
                              }
                              className="w-full rounded-full bg-black px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-black/90 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto md:w-full"
                            >
                              {isSending ? "Sending…" : "Send WhatsApp"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setActiveLead(lead)}
                            className="w-full rounded-full border border-black/20 px-5 py-2 text-sm font-medium text-black transition-colors hover:border-black/40 hover:bg-black/5 sm:w-auto md:w-full"
                          >
                            Open conversation
                          </button>
                          {lead.unread_count ? (
                            <span className="rounded-full bg-black px-3 py-1 text-xs font-semibold uppercase tracking-wide text-white">
                              {lead.unread_count} new
                            </span>
                          ) : null}
                          <p className="text-xs text-slate-400 sm:text-left md:text-right">
                            {multiSelectMode
                              ? "Tap to include in the batch."
                              : "Sends the approved WhatsApp template instantly."}
                          </p>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </div>
            </section>
          ))}
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

