import type { HomeworkDateKey } from "#types/homework-types";
import i18next from "i18next";

/** Converts a date into its local `YYYY-MM-DD` key. */
export function toDateKey(date: Date): HomeworkDateKey {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The local calendar day right now. */
export function todayKey(): HomeworkDateKey {
  return toDateKey(new Date());
}

/** Parses a `YYYY-MM-DD` key back into a local {@linkcode Date} at midnight. */
export function parseDateKey(key: HomeworkDateKey): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

/** Whether the given string is a well-formed, real calendar date key. */
export function isDateKey(key: unknown): key is HomeworkDateKey {
  if (typeof key !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return false;
  }
  return toDateKey(parseDateKey(key)) === key;
}

/** Returns the key of the day `amount` days after `key` (negative values move backwards). */
export function addDays(key: HomeworkDateKey, amount: number): HomeworkDateKey {
  const date = parseDateKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

/**
 * Whole days from `from` to `to`.
 *
 * Compares midnight-to-midnight in UTC so that daylight-saving transitions cannot produce
 * fractional days.
 */
export function daysBetween(from: HomeworkDateKey, to: HomeworkDateKey): number {
  const start = parseDateKey(from);
  const end = parseDateKey(to);
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86_400_000);
}

/** The Monday of the week containing `key`. */
export function startOfWeek(key: HomeworkDateKey): HomeworkDateKey {
  const weekday = parseDateKey(key).getDay();
  // getDay() is Sunday-based; shift so that Monday is the first day of the week.
  return addDays(key, -((weekday + 6) % 7));
}

/** Short localized weekday label, e.g. `一` for Monday. */
export function getWeekdayLabel(key: HomeworkDateKey): string {
  return i18next.t(`homework:weekday.${parseDateKey(key).getDay()}`);
}

/** Localized `月/日` label for a date key. */
export function formatShortDate(key: HomeworkDateKey): string {
  const date = parseDateKey(key);
  return i18next.t("homework:shortDate", { month: date.getMonth() + 1, day: date.getDate() });
}

/** Localized full label for a date key, tagging today and yesterday by name. */
export function formatDateLabel(key: HomeworkDateKey, today: HomeworkDateKey = todayKey()): string {
  const offset = daysBetween(today, key);
  if (offset === 0) {
    return i18next.t("homework:today");
  }
  if (offset === -1) {
    return i18next.t("homework:yesterday");
  }
  if (offset === 1) {
    return i18next.t("homework:tomorrow");
  }
  return formatShortDate(key);
}
