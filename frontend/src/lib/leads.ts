import { parseISO } from "date-fns";

import type { Lead } from "@/types/leads";
import { formatDayHeader } from "@/lib/dates";

export interface LeadGroup {
  label: string;
  leads: Lead[];
}

export function groupByDateAdded(leads: Lead[]): LeadGroup[] {
  const sorted = [...leads].sort((a, b) => {
    const aTime = parseISO(a.date_added).getTime();
    const bTime = parseISO(b.date_added).getTime();
    return bTime - aTime;
  });

  const map = new Map<string, Lead[]>();

  for (const lead of sorted) {
    const label = formatDayHeader(lead.date_added);
    const bucket = map.get(label);
    if (bucket) {
      bucket.push(lead);
    } else {
      map.set(label, [lead]);
    }
  }

  return Array.from(map.entries()).map(([label, groupedLeads]) => ({
    label,
    leads: groupedLeads,
  }));
}

export interface OptionItem {
  value: number;
  label: string;
}

export interface LeadFilters {
  propertyTypes: number[];
  regionId?: number;
  zoneId?: number;
  transaction: {
    sale: boolean;
    rent: boolean;
  };
  rooms: "all" | "1" | "2" | "3" | "4" | "5+";
  minBudget?: number;
  maxBudget?: number;
  dateFrom?: string;
  dateTo?: string;
}

export const DEFAULT_LEAD_FILTERS: LeadFilters = {
  propertyTypes: [],
  transaction: { sale: false, rent: false },
  rooms: "all",
};

export const PROPERTY_TYPE_OPTIONS: OptionItem[] = [
  { value: 1, label: "Apartament" },
  { value: 2, label: "Casă / Vilă" },
  { value: 3, label: "Teren" },
  { value: 4, label: "Spațiu de birouri" },
  { value: 5, label: "Spațiu comercial" },
  { value: 6, label: "Spațiu industrial" },
  { value: 7, label: "Hotel / Pensiune" },
  { value: 8, label: "Proprietate specială" },
];

export interface FilterOptions {
  propertyTypes: OptionItem[];
  regions: OptionItem[];
  zones: OptionItem[];
}

const toNumber = (value: unknown): number | undefined => {
  if (value === null || value === undefined || value === "") {
    return undefined;
  }
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : undefined;
};

const getFromRaw = (lead: Lead, field: string): unknown => {
  const raw = lead.crm_raw ?? {};
  return (raw as Record<string, unknown>)[field];
};

const extractLabel = (
  raw: Record<string, unknown>,
  ...keys: string[]
): string | undefined => {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
};

export function deriveFilterOptions(leads: Lead[]): FilterOptions {
  const propertyTypeSet = new Set<number>();
  const regionMap = new Map<number, string>();
  const zoneMap = new Map<number, string>();

  leads.forEach((lead) => {
    const raw = (lead.crm_raw ?? {}) as Record<string, unknown>;
    const propertyType = toNumber(raw.property_type);
    if (propertyType !== undefined) {
      propertyTypeSet.add(propertyType);
    }

    const regionId = toNumber(raw.region_obj_id);
    if (regionId !== undefined) {
      const label =
        extractLabel(raw, "region_name", "region", "county") ??
        `Județ #${regionId}`;
      if (!regionMap.has(regionId)) {
        regionMap.set(regionId, label);
      }
    }

    const zoneId = toNumber(raw.zone_id);
    if (zoneId !== undefined) {
      const label =
        extractLabel(raw, "zone_name", "zone") ?? `Zonă #${zoneId}`;
      if (!zoneMap.has(zoneId)) {
        zoneMap.set(zoneId, label);
      }
    }
  });

  const propertyTypes =
    propertyTypeSet.size === 0
      ? PROPERTY_TYPE_OPTIONS
      : PROPERTY_TYPE_OPTIONS.filter((option) =>
          propertyTypeSet.has(option.value)
        );

  const mapToOptions = (map: Map<number, string>): OptionItem[] =>
    Array.from(map.entries())
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }));

  return {
    propertyTypes,
    regions: mapToOptions(regionMap),
    zones: mapToOptions(zoneMap),
  };
}

export function applyLeadFilters(
  leads: Lead[],
  filters: LeadFilters
): Lead[] {
  if (!leads.length) {
    return leads;
  }

  const saleSelected = filters.transaction.sale;
  const rentSelected = filters.transaction.rent;

  return leads.filter((lead) => {
    const raw = (lead.crm_raw ?? {}) as Record<string, unknown>;

    // Property type
    if (filters.propertyTypes.length > 0) {
      const propType = toNumber(raw.property_type);
      if (!propType || !filters.propertyTypes.includes(propType)) {
        return false;
      }
    }

    // Region
    if (filters.regionId !== undefined) {
      const regionId = toNumber(raw.region_obj_id);
      if (!regionId || regionId !== filters.regionId) {
        return false;
      }
    }

    // Zone
    if (filters.zoneId !== undefined) {
      const zoneId = toNumber(raw.zone_id);
      if (!zoneId || zoneId !== filters.zoneId) {
        return false;
      }
    }

    // Transaction type
    if (saleSelected || rentSelected) {
      const isSale = Boolean(raw.for_sale);
      const isRent = Boolean(raw.for_rent);

      if (saleSelected && !rentSelected && !isSale) {
        return false;
      }
      if (!saleSelected && rentSelected && !isRent) {
        return false;
      }
      if (saleSelected && rentSelected && !isSale && !isRent) {
        return false;
      }
    }

    // Rooms
    if (filters.rooms !== "all") {
      const rooms = toNumber(raw.rooms);
      if (rooms === undefined) {
        return false;
      }
      if (filters.rooms === "5+") {
        if (rooms < 5) {
          return false;
        }
      } else {
        if (rooms !== Number(filters.rooms)) {
          return false;
        }
      }
    }

    // Budget
    const hasBudget =
      filters.minBudget !== undefined || filters.maxBudget !== undefined;
    if (hasBudget) {
      const priceSale = toNumber(raw.price_sale);
      const priceRent = toNumber(raw.price_rent);
      const withinRange = (price?: number) => {
        if (price === undefined) {
          return false;
        }
        if (
          filters.minBudget !== undefined &&
          price < filters.minBudget
        ) {
          return false;
        }
        if (
          filters.maxBudget !== undefined &&
          price > filters.maxBudget
        ) {
          return false;
        }
        return true;
      };

      let matchesBudget = false;

      if (saleSelected && !rentSelected) {
        matchesBudget = withinRange(priceSale);
      } else if (!saleSelected && rentSelected) {
        matchesBudget = withinRange(priceRent);
      } else if (saleSelected && rentSelected) {
        matchesBudget =
          withinRange(priceSale) || withinRange(priceRent);
      } else {
        // No transaction filter selected, accept price in either field
        matchesBudget =
          withinRange(priceSale) || withinRange(priceRent);
      }

      if (!matchesBudget) {
        return false;
      }
    }

    // Lead source
    // Date range
    if (filters.dateFrom || filters.dateTo) {
      const addedDate = new Date(lead.date_added);
      if (Number.isNaN(addedDate.getTime())) {
        return false;
      }
      if (filters.dateFrom) {
        const fromDate = new Date(`${filters.dateFrom}T00:00:00`);
        if (addedDate < fromDate) {
          return false;
        }
      }
      if (filters.dateTo) {
        const toDate = new Date(`${filters.dateTo}T23:59:59`);
        if (addedDate > toDate) {
          return false;
        }
      }
    }

    return true;
  });
}

export function groupByLastOutreach(leads: Lead[]): LeadGroup[] {
  const sorted = [...leads].sort((a, b) => {
    const aEntries = a.outreach_history ?? [];
    const bEntries = b.outreach_history ?? [];
    const aDate =
      aEntries.length > 0
        ? parseISO(aEntries[aEntries.length - 1].date ?? a.date_added)
        : parseISO(a.date_added);
    const bDate =
      bEntries.length > 0
        ? parseISO(bEntries[bEntries.length - 1].date ?? b.date_added)
        : parseISO(b.date_added);
    return bDate.getTime() - aDate.getTime();
  });

  const map = new Map<string, Lead[]>();
  for (const lead of sorted) {
    const entries = lead.outreach_history ?? [];
    const last = entries[entries.length - 1];
    const label = formatDayHeader(last?.date ?? lead.date_added);
    const bucket = map.get(label);
    if (bucket) {
      bucket.push(lead);
    } else {
      map.set(label, [lead]);
    }
  }

  return Array.from(map.entries()).map(([label, groupedLeads]) => ({
    label,
    leads: groupedLeads,
  }));
}

