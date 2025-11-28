import {
  format,
  isSameYear,
  parseISO,
  differenceInCalendarDays,
} from "date-fns";

const TODAY = new Date();

function ensureDate(value: string | Date | undefined): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  try {
    return parseISO(value);
  } catch {
    return null;
  }
}

export function formatDayHeader(value: string | Date): string {
  const date = ensureDate(value);
  if (!date) {
    return "Unknown date";
  }

  if (differenceInCalendarDays(TODAY, date) === 0) {
    return "Today";
  }
  if (differenceInCalendarDays(TODAY, date) === 1) {
    return "Yesterday";
  }

  const pattern = isSameYear(date, TODAY) ? "d MMM" : "d MMM yyyy";
  return format(date, pattern);
}

export function formatFullDateTime(value: string | Date): string {
  const date = ensureDate(value);
  if (!date) {
    return "Unknown time";
  }

  return format(date, "d MMM yyyy • HH:mm");
}

export function formatMessageTimestamp(value: string | Date): string {
  const date = ensureDate(value);
  if (!date) {
    return "";
  }

  const now = new Date();
  if (differenceInCalendarDays(now, date) === 0) {
    return format(date, "HH:mm");
  }

  const pattern = isSameYear(date, now) ? "d MMM • HH:mm" : "d MMM yyyy • HH:mm";
  return format(date, pattern);
}





