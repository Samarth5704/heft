/**
 * storage.js — schema, validation, migration, and persistence.
 *
 * The pure half (defaultState, migrate, parseState, validateExpense) has no
 * globals and is directly testable. The impure half (load/save) takes the
 * storage backend as an argument, so tests can hand it a fake Map-backed
 * object instead of localStorage.
 */

import { isValid } from './dates.js';

export const STORAGE_KEY = 'heft:v1';
export const CURRENT_SCHEMA_VERSION = 1;

/**
 * Seed categories. The ids are stable slugs and are what the parser's synonym
 * table points at, so renaming a category in the UI never breaks quick-add.
 * colorToken indexes the colourblind-safe palette in tokens.css.
 */
export const SEED_CATEGORIES = Object.freeze([
  { id: 'food', name: 'Food & Dining', colorToken: 'cat-1', budgetPaise: null, icon: 'bowl' },
  { id: 'groceries', name: 'Groceries', colorToken: 'cat-2', budgetPaise: null, icon: 'basket' },
  { id: 'transport', name: 'Transport', colorToken: 'cat-3', budgetPaise: null, icon: 'route' },
  { id: 'rent', name: 'Rent & Bills', colorToken: 'cat-4', budgetPaise: null, icon: 'roof' },
  { id: 'shopping', name: 'Shopping', colorToken: 'cat-5', budgetPaise: null, icon: 'tag' },
  { id: 'health', name: 'Health', colorToken: 'cat-6', budgetPaise: null, icon: 'pulse' },
  { id: 'entertainment', name: 'Entertainment', colorToken: 'cat-7', budgetPaise: null, icon: 'ticket' },
  { id: 'education', name: 'Education', colorToken: 'cat-8', budgetPaise: null, icon: 'book' },
  { id: 'other', name: 'Other', colorToken: 'cat-neutral', budgetPaise: null, icon: 'dot' },
]);

export const PAYMENT_METHODS = Object.freeze(['cash', 'upi', 'card']);

export function defaultState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    expenses: [],
    categories: SEED_CATEGORIES.map((c) => ({ ...c })),
    settings: {
      theme: 'system',
      weekStartsOn: 1,
      defaultCategoryId: 'other',
      schemaVersion: CURRENT_SCHEMA_VERSION,
    },
  };
}

/* ------------------------------------------------------------- validation */

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** Returns a clean Expense, or null if the record cannot be trusted. */
export function validateExpense(raw, categoryIds) {
  if (!raw || typeof raw !== 'object') return null;
  const amountPaise = raw.amountPaise;
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return null;
  if (!isValid(raw.date)) return null;
  if (!isNonEmptyString(raw.id)) return null;

  const categoryId = categoryIds.has(raw.categoryId) ? raw.categoryId : 'other';
  const method = PAYMENT_METHODS.includes(raw.paymentMethod) ? raw.paymentMethod : undefined;

  const expense = {
    id: raw.id,
    amountPaise,
    date: raw.date,
    categoryId,
    note: typeof raw.note === 'string' ? raw.note : '',
    createdAt: isNonEmptyString(raw.createdAt) ? raw.createdAt : new Date(0).toISOString(),
  };
  if (method) expense.paymentMethod = method;
  return expense;
}

export function validateCategory(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) return null;
  const budget = raw.budgetPaise;
  return {
    id: raw.id,
    name: raw.name,
    colorToken: isNonEmptyString(raw.colorToken) ? raw.colorToken : `cat-${(index % 8) + 1}`,
    budgetPaise: Number.isSafeInteger(budget) && budget >= 0 ? budget : null,
    icon: isNonEmptyString(raw.icon) ? raw.icon : 'dot',
  };
}

/* ------------------------------------------------------------ categories */

/** Move every expense in `fromId` to `toId`. Pure. */
export function reassignExpenses(expenses = [], fromId, toId) {
  return expenses.map((e) => (e.categoryId === fromId ? { ...e, categoryId: toId } : e));
}

/** Drop every expense in a category. Pure, and deliberately explicit. */
export function dropExpensesIn(expenses = [], categoryId) {
  return expenses.filter((e) => e.categoryId !== categoryId);
}

export function countExpensesIn(expenses = [], categoryId) {
  return expenses.reduce((n, e) => n + (e.categoryId === categoryId ? 1 : 0), 0);
}

/**
 * Can this category be removed at all?
 * 'Other' stays: it is the reassignment target of last resort, and the
 * validator falls back to it whenever a category cannot be resolved.
 */
export function canDeleteCategory(categories = [], id) {
  if (id === 'other') return { ok: false, reason: 'protected' };
  if (!categories.some((c) => c.id === id)) return { ok: false, reason: 'not-found' };
  if (categories.length <= 1) return { ok: false, reason: 'last-category' };
  return { ok: true };
}

/** A stable, readable id for a new user-made category. */
export function makeCategoryId(name, existing = []) {
  const taken = new Set(existing.map((c) => c.id));
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || 'category';
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/* -------------------------------------------------------------- migration */

/**
 * Upgrade an older payload to the current schema.
 *
 * v0 is the shape this app would have had if it had been written carelessly:
 * rupees as floats, category by name, no createdAt, no version field. The
 * migration exists even though only one version has ever shipped — the seam is
 * the point. Add a v1 -> v2 branch here when the shape next changes.
 *
 * @returns {{ok: true, data: object} | {ok: false, reason: string}}
 */
export function migrate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, reason: 'not-an-object' };
  }

  const version = Number.isInteger(input.schemaVersion) ? input.schemaVersion : 0;

  if (version > CURRENT_SCHEMA_VERSION) {
    // Written by a newer build. Fail safe: never rewrite data we cannot read.
    return { ok: false, reason: 'future-schema' };
  }

  let data = input;
  if (version === 0) data = migrateV0toV1(data);

  return { ok: true, data: normalise(data) };
}

function migrateV0toV1(v0) {
  const nameToId = new Map(SEED_CATEGORIES.map((c) => [c.name.toLowerCase(), c.id]));
  const expenses = Array.isArray(v0.expenses) ? v0.expenses : [];
  return {
    schemaVersion: 1,
    categories: SEED_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...defaultState().settings, ...(v0.settings ?? {}) },
    expenses: expenses.map((e, i) => ({
      id: isNonEmptyString(e?.id) ? e.id : `v0-${i}`,
      // v0 stored rupees as a float; round at the boundary, once.
      amountPaise: Math.round((Number(e?.amount) || 0) * 100),
      date: e?.date,
      categoryId: nameToId.get(String(e?.category ?? '').toLowerCase()) ?? 'other',
      note: typeof e?.note === 'string' ? e.note : '',
      createdAt: isNonEmptyString(e?.createdAt) ? e.createdAt : new Date(0).toISOString(),
    })),
  };
}

/** Drop anything unusable and fill in anything missing. Never throws. */
export function normalise(input) {
  const base = defaultState();
  const rawCategories = Array.isArray(input.categories) ? input.categories : base.categories;

  const categories = rawCategories
    .map((c, i) => validateCategory(c, i))
    .filter(Boolean);
  if (categories.length === 0) categories.push(...base.categories);
  const ids = new Set(categories.map((c) => c.id));
  if (!ids.has('other')) {
    categories.push({ ...SEED_CATEGORIES[SEED_CATEGORIES.length - 1] });
    ids.add('other');
  }

  const expenses = (Array.isArray(input.expenses) ? input.expenses : [])
    .map((e) => validateExpense(e, ids))
    .filter(Boolean);

  const settings = { ...base.settings, ...(input.settings ?? {}) };
  if (!ids.has(settings.defaultCategoryId)) settings.defaultCategoryId = 'other';
  settings.schemaVersion = CURRENT_SCHEMA_VERSION;

  return { schemaVersion: CURRENT_SCHEMA_VERSION, expenses, categories, settings };
}

/**
 * Parse a raw JSON string into state.
 * Malformed JSON falls back to defaults instead of throwing.
 * @returns {{state: object, ok: boolean, reason: string|null}}
 */
export function parseState(text) {
  if (text === null || text === undefined || text === '') {
    return { state: defaultState(), ok: true, reason: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: defaultState(), ok: false, reason: 'malformed-json' };
  }
  const result = migrate(parsed);
  if (!result.ok) return { state: defaultState(), ok: false, reason: result.reason };
  return { state: result.data, ok: true, reason: null };
}

/* ------------------------------------------------------------ persistence */

/** Read state from a Storage-like backend. Never throws. */
export function loadState(backend, key = STORAGE_KEY) {
  let text = null;
  try {
    text = backend.getItem(key);
  } catch {
    return { state: defaultState(), ok: false, reason: 'unreadable' };
  }
  return parseState(text);
}

/**
 * Write state. A full disk or a full quota is reported, never swallowed —
 * silently losing an expense is worse than telling the user we could not save.
 * @returns {{ok: boolean, reason: string|null}}
 */
export function saveState(backend, state, key = STORAGE_KEY) {
  try {
    backend.setItem(key, JSON.stringify(state));
    return { ok: true, reason: null };
  } catch (err) {
    const quota = err && (
      err.name === 'QuotaExceededError'
      || err.name === 'NS_ERROR_DOM_QUOTA_REACHED'
      || err.code === 22
    );
    return { ok: false, reason: quota ? 'quota-exceeded' : 'write-failed' };
  }
}
