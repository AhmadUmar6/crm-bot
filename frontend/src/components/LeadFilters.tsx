import { useEffect, useMemo, useState } from "react";

import {
  DEFAULT_LEAD_FILTERS,
  PROPERTY_TYPE_OPTIONS,
  deriveFilterOptions,
  LeadFilters,
  OptionItem,
} from "@/lib/leads";
import type { Lead } from "@/types/leads";

interface LeadFiltersProps {
  leads: Lead[];
  appliedFilters: LeadFilters;
  onApply: (filters: LeadFilters) => void;
  onReset: () => void;
}

const ROOMS_OPTIONS = [
  { value: "all", label: "Toate" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5+", label: "5+" },
] as const;

const formatOptionLabel = (option: OptionItem, prefix: string) =>
  `${option.label} (#${option.value})` ?? `${prefix} #${option.value}`;

export function LeadFiltersPanel({
  leads,
  appliedFilters,
  onApply,
  onReset,
}: LeadFiltersProps) {
  const [draft, setDraft] = useState<LeadFilters>(DEFAULT_LEAD_FILTERS);
  const [regionQuery, setRegionQuery] = useState("");
  const [zoneQuery, setZoneQuery] = useState("");

  const options = useMemo(() => deriveFilterOptions(leads), [leads]);

  useEffect(() => {
    setDraft(appliedFilters);
  }, [appliedFilters]);

  const filteredRegions = useMemo(() => {
    if (!regionQuery) return options.regions;
    return options.regions.filter((option) =>
      option.label.toLowerCase().includes(regionQuery.toLowerCase())
    );
  }, [options.regions, regionQuery]);

  const filteredZones = useMemo(() => {
    if (!zoneQuery) return options.zones;
    return options.zones.filter((option) =>
      option.label.toLowerCase().includes(zoneQuery.toLowerCase())
    );
  }, [options.zones, zoneQuery]);

  const togglePropertyType = (value: number) => {
    setDraft((prev) => {
      const next = prev.propertyTypes.includes(value)
        ? prev.propertyTypes.filter((type) => type !== value)
        : [...prev.propertyTypes, value];
      return { ...prev, propertyTypes: next };
    });
  };

  const handleTransactionChange = (key: "sale" | "rent") => {
    setDraft((prev) => ({
      ...prev,
      transaction: {
        ...prev.transaction,
        [key]: !prev.transaction[key],
      },
    }));
  };

  const handleApply = () => {
    onApply(draft);
  };

  const handleReset = () => {
    setDraft(DEFAULT_LEAD_FILTERS);
    setRegionQuery("");
    setZoneQuery("");
    onReset();
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        handleApply();
      }}
      className="mb-6 rounded-2xl border border-slate-200 bg-white px-4 py-5 shadow-sm sm:px-6"
    >
      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        <fieldset>
          <legend className="text-sm font-semibold text-black">
            Tip proprietate
          </legend>
          <div className="mt-3 grid gap-2">
            {PROPERTY_TYPE_OPTIONS.map((option) => (
              <label
                key={option.value}
                className="flex items-center gap-2 text-sm text-black/70"
              >
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-slate-300"
                  checked={draft.propertyTypes.includes(option.value)}
                  onChange={() => togglePropertyType(option.value)}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-black">Județ</legend>
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={regionQuery}
              onChange={(event) => setRegionQuery(event.target.value)}
              placeholder="Caută județ"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            <select
              value={draft.regionId ?? ""}
              onChange={(event) => {
                const value =
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value);
                setDraft((prev) => ({ ...prev, regionId: value }));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-black/70 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Toată Țara</option>
              {filteredRegions.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatOptionLabel(option, "Județ")}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-black">Zonă</legend>
          <div className="mt-3 space-y-2">
            <input
              type="text"
              value={zoneQuery}
              onChange={(event) => setZoneQuery(event.target.value)}
              placeholder="Caută zonă"
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            />
            <select
              value={draft.zoneId ?? ""}
              onChange={(event) => {
                const value =
                  event.target.value === ""
                    ? undefined
                    : Number(event.target.value);
                setDraft((prev) => ({ ...prev, zoneId: value }));
              }}
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-black/70 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              <option value="">Niciuna selectată</option>
              {filteredZones.map((option) => (
                <option key={option.value} value={option.value}>
                  {formatOptionLabel(option, "Zonă")}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-black">
            Tip tranzacție
          </legend>
          <div className="mt-3 grid gap-2">
            <label className="flex items-center gap-2 text-sm text-black/70">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={draft.transaction.sale}
                onChange={() => handleTransactionChange("sale")}
              />
              Cumpărare
            </label>
            <label className="flex items-center gap-2 text-sm text-black/70">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-slate-300"
                checked={draft.transaction.rent}
                onChange={() => handleTransactionChange("rent")}
              />
              Închiriere
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-black">Camere</legend>
          <div className="mt-3">
            <select
              value={draft.rooms}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  rooms: event.target.value as LeadFilters["rooms"],
                }))
              }
              className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-black/70 focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
            >
              {ROOMS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-black">
            Buget maxim
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-black/60">
                Min
              </label>
              <input
                type="number"
                min={0}
                placeholder="Min"
                value={draft.minBudget ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    minBudget:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-black/60">
                Max
              </label>
              <input
                type="number"
                min={0}
                placeholder="Max"
                value={draft.maxBudget ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    maxBudget:
                      event.target.value === ""
                        ? undefined
                        : Number(event.target.value),
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-semibold text-black">
            Data adăugării
          </legend>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-black/60">
                De la
              </label>
              <input
                type="date"
                value={draft.dateFrom ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    dateFrom:
                      event.target.value === "" ? undefined : event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-black/60">
                Până la
              </label>
              <input
                type="date"
                value={draft.dateTo ?? ""}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    dateTo:
                      event.target.value === "" ? undefined : event.target.value,
                  }))
                }
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-200"
              />
            </div>
          </div>
        </fieldset>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
        <button
          type="button"
          onClick={handleReset}
          className="rounded-full border border-slate-300 px-5 py-2 text-sm font-medium text-black transition-colors hover:border-slate-400 hover:text-black/70"
        >
          Reset
        </button>
        <button
          type="submit"
          className="rounded-full bg-slate-900 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-slate-800"
        >
          Caută
        </button>
      </div>
    </form>
  );
}

