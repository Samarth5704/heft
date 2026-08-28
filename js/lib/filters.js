/**
 * filters.js — the visible set, and the URL that describes it.
 *
 * Filters compose: month AND category AND payment method AND note search.
 * Pure: no DOM, no `location`. main.js does the reading and writing of the
 * actual hash; everything here is string in, object out.
 */

import { monthKey } from './dates.js';

/** `month: 'all'` means every month; otherwise a 'YYYY-MM' key. */
export const DEFAULT_FILTERS = Object.freeze({
  month: 'all',
  categoryIds: [],
  methods: [],
  query: '',
});

export function makeFilters(patch = {}) {
  return {
    month: patch.month ?? DEFAULT_FILTERS.month,
    categoryIds: [...(patch.categoryIds ?? [])],
    methods: [...(patch.methods ?? [])],
    query: patch.query ?? '',
  };
}

/** Is anything narrowing the list, other than the month being looked at? */
export function hasNarrowingFilters(filters) {
  return filters.categoryIds.length > 0
    || filters.methods.length > 0
    || filters.query.trim() !== '';
}

export function isDefault(filters, defaultMonth) {
  return !hasNarrowingFilters(filters) && filters.month === (defaultMonth ?? 'all');
}

/**
 * The visible set. Order is newest first, with createdAt as the tiebreak
 * inside a day so rows never swap places on an unrelated re-render.
 */
export function applyFilters(expenses = [], filters = DEFAULT_FILTERS) {
  const { month, categoryIds, methods, query } = makeFilters(filters);
  const cats = categoryIds.length ? new Set(categoryIds) : null;
  const pays = methods.length ? new Set(methods) : null;
  const needle = query.trim().toLowerCase();

  return expenses.filter((e) => {
    if (month !== 'all' && monthKey(e.date) !== month) return false;
    if (cats && !cats.has(e.categoryId)) return false;
    if (pays && !pays.has(e.paymentMethod ?? 'unknown')) return false;
    if (needle && !e.note.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/* ------------------------------------------------------------ URL state */

const SEP = ',';

/**
 * Read a location hash into filters. Anything unrecognised is ignored rather
 * than throwing — a hand-edited URL should degrade, not break the app.
 */
export function parseFilterHash(hash, fallback = DEFAULT_FILTERS) {
  const out = makeFilters(fallback);
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return out;

  const params = new URLSearchParams(raw);
  const month = params.get('month');
  if (month === 'all' || (month && /^\d{4}-\d{2}$/.test(month))) out.month = month;

  const cat = params.get('cat');
  if (cat !== null) out.categoryIds = cat.split(SEP).map((s) => s.trim()).filter(Boolean);

  const pay = params.get('pay');
  if (pay !== null) out.methods = pay.split(SEP).map((s) => s.trim()).filter(Boolean);

  const q = params.get('q');
  if (q !== null) out.query = q;

  return out;
}

/** Serialise filters to a hash. Defaults are omitted so the URL stays clean. */
export function filtersToHash(filters, defaultMonth = 'all') {
  const f = makeFilters(filters);
  const params = new URLSearchParams();
  if (f.month !== defaultMonth) params.set('month', f.month);
  if (f.categoryIds.length) params.set('cat', f.categoryIds.join(SEP));
  if (f.methods.length) params.set('pay', f.methods.join(SEP));
  if (f.query.trim()) params.set('q', f.query.trim());
  const s = params.toString();
  return s ? `#${s}` : '';
}

/** Human sentence naming what is active — used by the empty state. */
export function describeFilters(filters, categoriesById = {}) {
  const f = makeFilters(filters);
  const parts = [];
  if (f.categoryIds.length) {
    parts.push(f.categoryIds.map((id) => categoriesById[id]?.name ?? id).join(', '));
  }
  if (f.methods.length) parts.push(f.methods.join(' or '));
  if (f.query.trim()) parts.push(`notes containing “${f.query.trim()}”`);
  return parts.join(' · ');
}
