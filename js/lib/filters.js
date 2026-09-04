/**
 * filters.js — the visible set, and the URL that describes it.
 *
 * Filters compose: period AND kind AND category AND account AND note search.
 * Pure: no DOM, no `location`. lib/router.js does the reading and writing of
 * the actual hash; everything here is string in, object out.
 *
 * The period is a `{start, end}` range, not a month. Every view mode the
 * period stepper offers — daily through yearly — reduces to a range in
 * `dates.periodRange`, so nothing downstream of here needs to know which mode
 * produced it, and month arithmetic does not leak into the filter layer.
 */

import { periodRange, isInRange } from './dates.js';

/** `range: null` means every date. */
export const DEFAULT_FILTERS = Object.freeze({
  range: null,
  kinds: [],
  categoryIds: [],
  accountIds: [],
  query: '',
});

/** A range is two date strings and nothing else; a half-open one is fine. */
function makeRange(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const start = typeof raw.start === 'string' ? raw.start : null;
  const end = typeof raw.end === 'string' ? raw.end : null;
  if (!start && !end) return null;
  return { start, end, label: typeof raw.label === 'string' ? raw.label : '' };
}

export function makeFilters(patch = {}) {
  return {
    range: makeRange(patch.range),
    kinds: [...(patch.kinds ?? [])],
    categoryIds: [...(patch.categoryIds ?? [])],
    accountIds: [...(patch.accountIds ?? [])],
    query: patch.query ?? '',
  };
}

/** The filters for one period of a view mode — the period stepper's output. */
export function filtersForPeriod(filters, viewMode, anchorDate, weekStartsOn = 1) {
  return makeFilters({ ...filters, range: periodRange(viewMode, anchorDate, weekStartsOn) });
}

/** Is anything narrowing the list, other than the period being looked at? */
export function hasNarrowingFilters(filters) {
  const f = makeFilters(filters);
  return f.kinds.length > 0
    || f.categoryIds.length > 0
    || f.accountIds.length > 0
    || f.query.trim() !== '';
}

export function isDefault(filters) {
  return !hasNarrowingFilters(filters) && makeFilters(filters).range === null;
}

/**
 * The visible set. Order is newest first, with createdAt as the tiebreak
 * inside a day so rows never swap places on an unrelated re-render.
 *
 * An account filter matches either end of a transfer: money arriving in the
 * account you are looking at is part of that account's story.
 */
export function applyFilters(transactions = [], filters = DEFAULT_FILTERS) {
  const {
    range, kinds, categoryIds, accountIds, query,
  } = makeFilters(filters);
  const wanted = kinds.length ? new Set(kinds) : null;
  const cats = categoryIds.length ? new Set(categoryIds) : null;
  const accts = accountIds.length ? new Set(accountIds) : null;
  const needle = query.trim().toLowerCase();

  return transactions.filter((t) => {
    if (range && !isInRange(t.date, range)) return false;
    // 'transfer' selects transfers; 'expense' and 'income' select a direction.
    if (wanted && !wanted.has(t.kind === 'transfer' ? 'transfer' : t.direction)) return false;
    if (cats && !cats.has(t.categoryId)) return false;
    if (accts && !(accts.has(t.accountId) || accts.has(t.toAccountId))) return false;
    if (needle && !t.note.toLowerCase().includes(needle)) return false;
    return true;
  });
}

/* ------------------------------------------------------------ URL state */

const SEP = ',';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Read a location hash into filters. Anything unrecognised is ignored rather
 * than throwing — a hand-edited URL should degrade, not break the app.
 */
export function parseFilterHash(hash, fallback = DEFAULT_FILTERS) {
  const out = makeFilters(fallback);
  const raw = String(hash ?? '').replace(/^#/, '');
  if (!raw) return out;

  const params = new URLSearchParams(raw);
  const list = (key) => {
    const v = params.get(key);
    return v === null ? null : v.split(SEP).map((s) => s.trim()).filter(Boolean);
  };

  const from = params.get('from');
  const to = params.get('to');
  if ((from && ISO.test(from)) || (to && ISO.test(to))) {
    out.range = makeRange({
      start: from && ISO.test(from) ? from : null,
      end: to && ISO.test(to) ? to : null,
    });
  }

  const kinds = list('kind');
  if (kinds) out.kinds = kinds;
  const cats = list('cat');
  if (cats) out.categoryIds = cats;
  const accts = list('acct');
  if (accts) out.accountIds = accts;

  const q = params.get('q');
  if (q !== null) out.query = q;

  return out;
}

/** Serialise filters to a hash. Defaults are omitted so the URL stays clean. */
export function filtersToHash(filters) {
  const f = makeFilters(filters);
  const params = new URLSearchParams();
  if (f.range?.start) params.set('from', f.range.start);
  if (f.range?.end) params.set('to', f.range.end);
  if (f.kinds.length) params.set('kind', f.kinds.join(SEP));
  if (f.categoryIds.length) params.set('cat', f.categoryIds.join(SEP));
  if (f.accountIds.length) params.set('acct', f.accountIds.join(SEP));
  if (f.query.trim()) params.set('q', f.query.trim());
  const s = params.toString();
  return s ? `#${s}` : '';
}

const KIND_NAMES = { expense: 'expenses', income: 'income', transfer: 'transfers' };

/** Human sentence naming what is active — used by the empty state. */
export function describeFilters(filters, categoriesById = {}, accountsById = {}) {
  const f = makeFilters(filters);
  const parts = [];
  if (f.kinds.length) parts.push(f.kinds.map((k) => KIND_NAMES[k] ?? k).join(' or '));
  if (f.categoryIds.length) {
    parts.push(f.categoryIds.map((id) => categoriesById[id]?.name ?? id).join(', '));
  }
  if (f.accountIds.length) {
    parts.push(f.accountIds.map((id) => accountsById[id]?.name ?? id).join(' or '));
  }
  if (f.query.trim()) parts.push(`notes containing “${f.query.trim()}”`);
  return parts.join(' · ');
}
