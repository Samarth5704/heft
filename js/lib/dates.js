/**
 * dates.js — a date here is a 'YYYY-MM-DD' local-date string, never a Date.
 *
 * An expense happens on a calendar day, not at an instant. Timestamps drag in
 * timezone and DST arithmetic and produce off-by-one-day bugs. Every helper
 * below is pure and string-in / string-out. `Date` appears only inside
 * today() and the UTC arithmetic used to roll dates over month boundaries —
 * UTC because it has no DST, so adding 86400000ms is always exactly one day.
 */

export const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
export const WEEKDAY_NAMES = [
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
];

const pad = (n, w = 2) => String(n).padStart(w, '0');

/** Is `y` a leap year? Gregorian rule: 2000 yes, 1900 no. */
export function isLeapYear(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/** Days in month, 1-indexed month. daysInMonthOf(2024, 2) === 29 */
export function daysInMonthOf(year, month) {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** Split 'YYYY-MM-DD' into parts, or null if it is not a real calendar date. */
export function parts(iso) {
  if (typeof iso !== 'string') return null;
  const m = ISO_RE.exec(iso);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > daysInMonthOf(year, month)) return null;
  return { year, month, day };
}

export function isValid(iso) {
  return parts(iso) !== null;
}

/** Build 'YYYY-MM-DD' from numbers, without validating. */
export function toISO(year, month, day) {
  return `${pad(year, 4)}-${pad(month)}-${pad(day)}`;
}

/** The only place a clock is read. Normalised to a local-date string at once. */
export function today(now = new Date()) {
  return toISO(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

/** Days in the month containing `iso`. */
export function daysInMonth(iso) {
  const p = parts(iso) ?? parts(`${iso}-01`);
  return p ? daysInMonthOf(p.year, p.month) : 0;
}

/** Add (or subtract) whole days. Rolls across months, years and leap days. */
export function addDays(iso, n) {
  const p = parts(iso);
  if (!p) return null;
  const t = Date.UTC(p.year, p.month - 1, p.day) + n * 86400000;
  const d = new Date(t);
  return toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/** Whole days from `a` to `b`; negative when `b` is earlier. */
export function diffDays(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  if (!pa || !pb) return 0;
  const ta = Date.UTC(pa.year, pa.month - 1, pa.day);
  const tb = Date.UTC(pb.year, pb.month - 1, pb.day);
  return Math.round((tb - ta) / 86400000);
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(iso) {
  const p = parts(iso);
  if (!p) return 0;
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

export function startOfMonth(iso) {
  const p = parts(iso);
  return p ? toISO(p.year, p.month, 1) : null;
}

export function endOfMonth(iso) {
  const p = parts(iso);
  return p ? toISO(p.year, p.month, daysInMonthOf(p.year, p.month)) : null;
}

/** 'YYYY-MM-DD' -> 'YYYY-MM'. Also passes a 'YYYY-MM' through unchanged. */
export function monthKey(iso) {
  if (typeof iso !== 'string') return null;
  if (/^\d{4}-\d{2}$/.test(iso)) return iso;
  const p = parts(iso);
  return p ? `${pad(p.year, 4)}-${pad(p.month)}` : null;
}

export function monthKeyParts(key) {
  if (typeof key !== 'string' || !/^\d{4}-\d{2}/.test(key)) return null;
  const year = Number(key.slice(0, 4));
  const month = Number(key.slice(5, 7));
  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** Shift a 'YYYY-MM' key by n months. */
export function addMonths(key, n) {
  const p = monthKeyParts(key);
  if (!p) return null;
  const total = p.year * 12 + (p.month - 1) + n;
  return `${pad(Math.floor(total / 12), 4)}-${pad((total % 12) + 1)}`;
}

/** Every date string in a month key, in order. */
export function datesInMonth(key) {
  const p = monthKeyParts(key);
  if (!p) return [];
  const n = daysInMonthOf(p.year, p.month);
  return Array.from({ length: n }, (_, i) => toISO(p.year, p.month, i + 1));
}

/**
 * Compare two date strings. ISO strings sort lexicographically in
 * chronological order, which is the whole reason for this format.
 */
export function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a, b) => compare(a, b) < 0;
export const isAfter = (a, b) => compare(a, b) > 0;
export const isSameMonth = (a, b) => monthKey(a) === monthKey(b);

/** Clamp a date into [min, max]; either bound may be null. */
export function clampDate(iso, min, max) {
  if (min && isBefore(iso, min)) return min;
  if (max && isAfter(iso, max)) return max;
  return iso;
}

/* --- display helpers (still pure: strings in, strings out) --- */

export function formatDay(iso, { weekday = false } = {}) {
  const p = parts(iso);
  if (!p) return '';
  const base = `${p.day} ${MONTH_NAMES[p.month - 1]}`;
  return weekday ? `${WEEKDAY_NAMES[dayOfWeek(iso)]}, ${base}` : base;
}

export function formatMonth(key, { short = false } = {}) {
  const p = monthKeyParts(monthKey(key) ?? '');
  if (!p) return '';
  const name = MONTH_NAMES[p.month - 1];
  return `${short ? name.slice(0, 3) : name} ${p.year}`;
}

/** 'Today' / 'Yesterday' / '12 August' — for day headers in the ledger. */
export function formatRelativeDay(iso, todayISO) {
  if (iso === todayISO) return 'Today';
  if (iso === addDays(todayISO, -1)) return 'Yesterday';
  const p = parts(iso);
  const t = parts(todayISO);
  if (p && t && p.year !== t.year) return `${formatDay(iso)} ${p.year}`;
  return formatDay(iso);
}
