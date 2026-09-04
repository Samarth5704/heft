/**
 * storage.js — schema, validation, migration, and persistence.
 *
 * The pure half (defaultState, migrate, parseState, validateTransaction) has
 * no globals and is directly testable. The impure half (load/save) takes the
 * storage backend as an argument, so tests can hand it a fake Map-backed
 * object instead of localStorage.
 *
 * v2 vocabulary, and it is load-bearing:
 *   - a *transaction* is money leaving or entering an account. It carries a
 *     POSITIVE amountPaise and a separate `direction` of 'expense' | 'income'.
 *     A signed amount is never stored; the sign is applied when aggregating.
 *   - a *transfer* is money moving between two of your own accounts. It is
 *     neither income nor expense, has no category, and must never appear in
 *     any total other than an account balance.
 *   - an *account* is a money account — Cash, Bank, Card, Wallet. Its balance
 *     is DERIVED from its opening balance plus its transactions. There is no
 *     balance field, and nothing increments one in place.
 *   - a *budget* belongs to a month and a category, not to the category. v2
 *     hung one `budgetPaise` off `Category`, which meant the same figure
 *     applied to every month that had ever existed and to every month still to
 *     come. v3 moves it into `budgets['YYYY-MM'][categoryId]`, where an absent
 *     entry means *untracked* and is not the same fact as a budget of zero.
 */

import { isValid, monthKey, today as todayISO } from './dates.js';

export const STORAGE_KEY = 'heft:v1';
export const CURRENT_SCHEMA_VERSION = 3;

export const ACCOUNT_TYPES = Object.freeze(['bank', 'cash', 'card', 'wallet']);
export const TRANSACTION_KINDS = Object.freeze(['transaction', 'transfer']);
export const DIRECTIONS = Object.freeze(['expense', 'income']);
export const CATEGORY_KINDS = Object.freeze(['expense', 'income']);

/** v1 payment methods. Kept only so the v1 -> v2 migration can read them. */
export const PAYMENT_METHODS = Object.freeze(['cash', 'upi', 'card']);

/**
 * Seed categories. The ids are stable slugs and are what the parser's synonym
 * table points at, so renaming a category in the UI never breaks quick-add.
 * colorToken indexes the colourblind-safe palette in tokens.css.
 */
export const SEED_CATEGORIES = Object.freeze([
  { id: 'food', name: 'Food & Dining', kind: 'expense', colorToken: 'cat-1', icon: 'food', archived: false },
  { id: 'groceries', name: 'Groceries', kind: 'expense', colorToken: 'cat-2', icon: 'groceries', archived: false },
  { id: 'transport', name: 'Transport', kind: 'expense', colorToken: 'cat-3', icon: 'transport', archived: false },
  { id: 'rent', name: 'Rent & Bills', kind: 'expense', colorToken: 'cat-4', icon: 'rent', archived: false },
  { id: 'shopping', name: 'Shopping', kind: 'expense', colorToken: 'cat-5', icon: 'shopping', archived: false },
  { id: 'health', name: 'Health', kind: 'expense', colorToken: 'cat-6', icon: 'health', archived: false },
  { id: 'entertainment', name: 'Entertainment', kind: 'expense', colorToken: 'cat-7', icon: 'entertainment', archived: false },
  { id: 'education', name: 'Education', kind: 'expense', colorToken: 'cat-8', icon: 'education', archived: false },
  { id: 'other', name: 'Other', kind: 'expense', colorToken: 'cat-neutral', icon: 'other', archived: false },
]);

/** Income has its own category set; an income category is never an expense one. */
export const SEED_INCOME_CATEGORIES = Object.freeze([
  { id: 'salary', name: 'Salary', kind: 'income', colorToken: 'cat-5', icon: 'salary', archived: false },
  { id: 'refunds', name: 'Refunds', kind: 'income', colorToken: 'cat-6', icon: 'refunds', archived: false },
  { id: 'returns', name: 'Returns', kind: 'income', colorToken: 'cat-7', icon: 'returns', archived: false },
  { id: 'interest-dividends', name: 'Interest & Dividends', kind: 'income', colorToken: 'cat-4', icon: 'interest', archived: false },
  { id: 'gifts', name: 'Gifts', kind: 'income', colorToken: 'cat-9', icon: 'gifts', archived: false },
  { id: 'other-income', name: 'Other Income', kind: 'income', colorToken: 'cat-neutral', icon: 'other', archived: false },
]);

export const SEED_ACCOUNTS = Object.freeze([
  { id: 'cash', name: 'Cash', type: 'cash', openingBalancePaise: 0, colorToken: 'acct-1', icon: 'cash', archived: false },
  { id: 'bank', name: 'Bank', type: 'bank', openingBalancePaise: 0, colorToken: 'acct-2', icon: 'bank', archived: false },
  { id: 'card', name: 'Card', type: 'card', openingBalancePaise: 0, colorToken: 'acct-3', icon: 'card', archived: false },
]);

/** The reassignment targets of last resort, one per category kind. */
export const EXPENSE_SINK_ID = 'other';
export const INCOME_SINK_ID = 'other-income';

export function defaultState() {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    transactions: [],
    accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
    categories: [
      ...SEED_CATEGORIES.map((c) => ({ ...c })),
      ...SEED_INCOME_CATEGORIES.map((c) => ({ ...c })),
    ],
    /** 'YYYY-MM' -> categoryId -> paise. An absent key is untracked, not zero. */
    budgets: {},
    settings: {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      theme: 'system',
      weekStartsOn: 1,
      viewMode: 'monthly',
      showTotal: true,
      showDecimals: true,
      carryOver: false,
      defaultAccountId: 'cash',
      defaultExpenseCategoryId: EXPENSE_SINK_ID,
      defaultIncomeCategoryId: INCOME_SINK_ID,
      // Uniform rows are the default: they scan better down a long ledger.
      // The topographic mode is opt-in, from Preferences.
      heftView: false,
    },
  };
}

/* ------------------------------------------------------------- validation */

const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/**
 * The lookups every transaction check needs, built once per load instead of
 * once per record. `sinks` are the never-orphan fallbacks, resolved from the
 * categories that actually exist rather than assumed to be the seed ids.
 */
export function makeValidationContext({ categories = [], accounts = [], settings = {} } = {}) {
  const categoryKind = new Map(categories.map((c) => [c.id, c.kind ?? 'expense']));
  const accountIds = new Set(accounts.map((a) => a.id));
  const firstOfKind = (kind) => categories.find((c) => (c.kind ?? 'expense') === kind)?.id ?? null;

  return {
    categoryKind,
    accountIds,
    sinks: {
      expense: categoryKind.get(EXPENSE_SINK_ID) === 'expense'
        ? EXPENSE_SINK_ID
        : firstOfKind('expense'),
      income: categoryKind.get(INCOME_SINK_ID) === 'income'
        ? INCOME_SINK_ID
        : firstOfKind('income'),
    },
    defaultAccountId: accountIds.has(settings.defaultAccountId)
      ? settings.defaultAccountId
      : (accounts[0]?.id ?? null),
  };
}

/**
 * Returns a clean Transaction, or null if the record cannot be trusted.
 *
 * Lenient where a guess cannot go wrong (a missing kind is a transaction, a
 * missing direction is an expense, a category that no longer exists lands in
 * the sink for its kind), strict where it can: a non-positive or non-integer
 * amount, an unreal date, and a transfer with no valid destination are all
 * refused outright rather than quietly repaired into a wrong number.
 */
export function validateTransaction(raw, ctx) {
  if (!raw || typeof raw !== 'object') return null;
  const { categoryKind, accountIds, sinks, defaultAccountId } = ctx;

  const amountPaise = raw.amountPaise;
  if (!Number.isSafeInteger(amountPaise) || amountPaise <= 0) return null;
  if (!isValid(raw.date)) return null;
  if (!isNonEmptyString(raw.id)) return null;

  const kind = raw.kind === 'transfer' ? 'transfer' : 'transaction';
  const accountId = accountIds.has(raw.accountId) ? raw.accountId : defaultAccountId;
  if (!isNonEmptyString(accountId)) return null;

  const base = {
    id: raw.id,
    kind,
    amountPaise,
    date: raw.date,
    accountId,
    note: typeof raw.note === 'string' ? raw.note : '',
    createdAt: isNonEmptyString(raw.createdAt) ? raw.createdAt : new Date(0).toISOString(),
  };

  if (kind === 'transfer') {
    // A transfer with no real destination is not a transfer. There is nothing
    // safe to guess, and a self-transfer would double-count on one balance.
    if (!accountIds.has(raw.toAccountId) || raw.toAccountId === accountId) return null;
    return { ...base, direction: null, toAccountId: raw.toAccountId, categoryId: null };
  }

  const direction = DIRECTIONS.includes(raw.direction) ? raw.direction : 'expense';
  // Categories are scoped by kind: an income record can only hold an income
  // category and vice versa. A mismatch falls back to that kind's sink.
  const categoryId = categoryKind.get(raw.categoryId) === direction
    ? raw.categoryId
    : sinks[direction];
  if (!isNonEmptyString(categoryId)) return null;

  return { ...base, direction, toAccountId: null, categoryId };
}

export function validateCategory(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) return null;
  // No budget field: a budget belongs to a month, and lives in `budgets`.
  return {
    id: raw.id,
    name: raw.name,
    kind: CATEGORY_KINDS.includes(raw.kind) ? raw.kind : 'expense',
    colorToken: isNonEmptyString(raw.colorToken) ? raw.colorToken : `cat-${(index % 8) + 1}`,
    icon: isNonEmptyString(raw.icon) ? raw.icon : 'other',
    archived: raw.archived === true,
  };
}

const MONTH_KEY_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Clean the budgets map: real month keys, real category ids, non-negative
 * integer paise.
 *
 * A budget of zero is kept — "I plan to spend nothing on this" is a real
 * intention and is not the same as not tracking the category at all, which is
 * the absence of the key. A month left with no entries is dropped rather than
 * stored as `{}`, so "is anything budgeted here" stays a simple question.
 *
 * @param {unknown} raw
 * @param {Set<string>} categoryIds ids that still exist
 */
export function validateBudgets(raw, categoryIds) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, entries] of Object.entries(raw)) {
    if (!MONTH_KEY_RE.test(key)) continue;
    if (!entries || typeof entries !== 'object' || Array.isArray(entries)) continue;
    const month = {};
    for (const [categoryId, paise] of Object.entries(entries)) {
      if (!categoryIds.has(categoryId)) continue;
      if (!Number.isSafeInteger(paise) || paise < 0) continue;
      month[categoryId] = paise;
    }
    if (Object.keys(month).length) out[key] = month;
  }
  return out;
}

/**
 * An account. `openingBalancePaise` may be negative — that is what a credit
 * card with an outstanding bill looks like on the day you start using Heft.
 */
export function validateAccount(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  if (!isNonEmptyString(raw.id) || !isNonEmptyString(raw.name)) return null;
  const opening = raw.openingBalancePaise;
  return {
    id: raw.id,
    name: raw.name,
    type: ACCOUNT_TYPES.includes(raw.type) ? raw.type : 'cash',
    openingBalancePaise: Number.isSafeInteger(opening) ? opening : 0,
    colorToken: isNonEmptyString(raw.colorToken) ? raw.colorToken : `acct-${(index % 6) + 1}`,
    icon: isNonEmptyString(raw.icon) ? raw.icon : 'wallet',
    archived: raw.archived === true,
  };
}

/* ------------------------------------------------- categories & accounts */

/** Move every transaction in `fromId` to `toId`. Pure. */
export function reassignCategory(transactions = [], fromId, toId) {
  return transactions.map((t) => (t.categoryId === fromId ? { ...t, categoryId: toId } : t));
}

/** Drop every transaction in a category. Pure, and deliberately explicit. */
export function dropTransactionsIn(transactions = [], categoryId) {
  return transactions.filter((t) => t.categoryId !== categoryId);
}

export function countTransactionsIn(transactions = [], categoryId) {
  return transactions.reduce((n, t) => n + (t.categoryId === categoryId ? 1 : 0), 0);
}

/** A transaction touches an account as its source or as a transfer's target. */
export const touchesAccount = (t, accountId) => (
  t.accountId === accountId || t.toAccountId === accountId
);

export function countTransactionsFor(transactions = [], accountId) {
  return transactions.reduce((n, t) => n + (touchesAccount(t, accountId) ? 1 : 0), 0);
}

/** Move every transaction touching `fromId` — both legs of a transfer. */
export function reassignAccount(transactions = [], fromId, toId) {
  return transactions
    .map((t) => {
      if (!touchesAccount(t, fromId)) return t;
      const next = { ...t };
      if (next.accountId === fromId) next.accountId = toId;
      if (next.toAccountId === fromId) next.toAccountId = toId;
      return next;
    })
    // A transfer whose two ends collapse onto one account is no longer a
    // transfer. Keeping it would leave a record that moves money nowhere.
    .filter((t) => !(t.kind === 'transfer' && t.accountId === t.toAccountId));
}

export function dropTransactionsFor(transactions = [], accountId) {
  return transactions.filter((t) => !touchesAccount(t, accountId));
}

/**
 * Can this category be hard-deleted?
 *
 * Archiving is the default for anything with history — deleting is offered
 * only when nothing points at it. A category still in use returns 'in-use'
 * with its count, and the caller must then pass an explicit reassign-or-delete
 * choice. The two sinks stay: they are the reassignment target of last resort
 * and the validator's fallback for their kind.
 */
export function canDeleteCategory(categories = [], id, transactions = null) {
  if (id === EXPENSE_SINK_ID || id === INCOME_SINK_ID) return { ok: false, reason: 'protected' };
  const target = categories.find((c) => c.id === id);
  if (!target) return { ok: false, reason: 'not-found' };
  if (categories.length <= 1) return { ok: false, reason: 'last-category' };
  const kind = target.kind ?? 'expense';
  if (categories.filter((c) => (c.kind ?? 'expense') === kind).length <= 1) {
    return { ok: false, reason: 'last-of-kind' };
  }
  if (transactions) {
    const count = countTransactionsIn(transactions, id);
    if (count > 0) return { ok: false, reason: 'in-use', count };
  }
  return { ok: true };
}

/** The same rule for accounts: archive what has history, delete what does not. */
export function canDeleteAccount(accounts = [], id, transactions = null) {
  if (!accounts.some((a) => a.id === id)) return { ok: false, reason: 'not-found' };
  if (accounts.length <= 1) return { ok: false, reason: 'last-account' };
  if (transactions) {
    const count = countTransactionsFor(transactions, id);
    if (count > 0) return { ok: false, reason: 'in-use', count };
  }
  return { ok: true };
}

/** A stable, readable id for a new user-made category or account. */
export function makeSlugId(name, existing = [], fallback = 'item') {
  const taken = new Set(existing.map((c) => c.id));
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    || fallback;
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

export const makeCategoryId = (name, existing = []) => makeSlugId(name, existing, 'category');
export const makeAccountId = (name, existing = []) => makeSlugId(name, existing, 'account');

/* -------------------------------------------------------------- migration */

/**
 * Upgrade an older payload to the current schema.
 *
 * v0 is the shape this app would have had if it had been written carelessly:
 * rupees as floats, category by name, no createdAt, no version field. v1 is
 * the shipped expenses-only schema. v2 adds accounts, income and transfers.
 * v3 moves budgets off the category and onto the month.
 *
 * `today` is passed rather than read, because v2 -> v3 has to decide *which*
 * month inherits an old category budget and that must be reproducible in a
 * test.
 *
 * @returns {{ok: true, data: object} | {ok: false, reason: string}}
 */
export function migrate(input, { today = null } = {}) {
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
  if (version <= 1) data = migrateV1toV2(data);
  if (version <= 2) data = migrateV2toV3(data, today);

  return { ok: true, data: normalise(data) };
}

function migrateV0toV1(v0) {
  const nameToId = new Map(SEED_CATEGORIES.map((c) => [c.name.toLowerCase(), c.id]));
  const expenses = Array.isArray(v0.expenses) ? v0.expenses : [];
  return {
    schemaVersion: 1,
    categories: SEED_CATEGORIES.map((c) => ({ ...c })),
    settings: { ...(v0.settings ?? {}) },
    expenses: expenses.map((e, i) => ({
      id: isNonEmptyString(e?.id) ? e.id : `v0-${i}`,
      // v0 stored rupees as a float; round at the boundary, once.
      amountPaise: Math.round((Number(e?.amount) || 0) * 100),
      date: e?.date,
      categoryId: nameToId.get(String(e?.category ?? '').toLowerCase()) ?? EXPENSE_SINK_ID,
      note: typeof e?.note === 'string' ? e.note : '',
      createdAt: isNonEmptyString(e?.createdAt) ? e.createdAt : new Date(0).toISOString(),
      ...(isNonEmptyString(e?.paymentMethod) ? { paymentMethod: e.paymentMethod } : {}),
    })),
  };
}

/**
 * v1 -> v2. Every v1 record is an expense out of a real account.
 *
 * A default Cash account always exists. 'card' maps onto a Card account
 * because a card *is* an account type; 'upi' does not — UPI is a rail that can
 * be pointed at any account, so mapping it would invent a fact the data does
 * not contain. It goes into the note instead, where it stays visible and
 * correctable. No amount, date, category or id is changed by this migration.
 */
export function migrateV1toV2(v1) {
  const expenses = Array.isArray(v1.expenses) ? v1.expenses : [];
  const methods = new Set(expenses.map((e) => e?.paymentMethod).filter(Boolean));

  const accounts = [{ ...SEED_ACCOUNTS[0] }];
  if (methods.has('card')) accounts.push({ ...SEED_ACCOUNTS[2] });

  const accountFor = (method) => (method === 'card' ? 'card' : 'cash');
  const noteFor = (note, method) => {
    if (method !== 'upi') return note;
    return note ? `${note} (UPI)` : 'UPI';
  };

  const rawCategories = Array.isArray(v1.categories) && v1.categories.length
    ? v1.categories
    : SEED_CATEGORIES.map((c) => ({ ...c }));

  // Every v1 category is an expense category by construction: v1 had no income.
  const categories = rawCategories.map((c) => ({ ...c, kind: 'expense' }));

  // Seed the income set, re-slugging any id a user's expense category already
  // holds — someone who made a "Returns" expense category must not have it
  // silently turned into an income category.
  const incomeIdMap = new Map();
  for (const seed of SEED_INCOME_CATEGORIES) {
    const id = makeSlugId(seed.id, categories, 'income');
    incomeIdMap.set(seed.id, id);
    categories.push({ ...seed, id });
  }

  //  is superseded by a default per kind; carrying the dead
  // key forward would leave two sources of truth for the same choice.
  const { defaultCategoryId, ...v1Settings } = v1.settings ?? {};
  const expenseIds = new Set(categories.filter((c) => c.kind === 'expense').map((c) => c.id));

  return {
    schemaVersion: 2,
    accounts,
    categories,
    transactions: expenses.map((e) => {
      const method = e?.paymentMethod;
      const { paymentMethod, ...rest } = e ?? {};
      return {
        ...rest,
        kind: 'transaction',
        direction: 'expense',
        accountId: accountFor(method),
        toAccountId: null,
        categoryId: e?.categoryId ?? EXPENSE_SINK_ID,
        note: noteFor(typeof e?.note === 'string' ? e.note : '', method),
      };
    }),
    settings: {
      ...v1Settings,
      schemaVersion: 2,
      viewMode: v1Settings.viewMode ?? 'monthly',
      showTotal: v1Settings.showTotal ?? true,
      carryOver: v1Settings.carryOver ?? false,
      heftView: v1Settings.heftView ?? false,
      defaultAccountId: 'cash',
      defaultExpenseCategoryId: expenseIds.has(defaultCategoryId)
        ? defaultCategoryId
        : EXPENSE_SINK_ID,
      defaultIncomeCategoryId: incomeIdMap.get(INCOME_SINK_ID) ?? INCOME_SINK_ID,
    },
  };
}

/**
 * v2 -> v3. A category's single budget becomes a budget for one month.
 *
 * The old field applied to every month there had ever been and every month
 * still to come. Writing it into all of them would invent a history the user
 * never set — a budget they added last week would suddenly have been in force
 * since 2019, and last year's "over budget" would be a fact about this week's
 * decision. So it lands in the current month only, which is the one month it
 * was demonstrably about, and every earlier month is left honestly untracked.
 *
 * Nothing else changes: no amount, date, category, account or transaction is
 * touched.
 */
export function migrateV2toV3(v2, today = null) {
  const key = monthKey(today ?? todayISO());
  const categories = Array.isArray(v2.categories) ? v2.categories : [];

  const current = {};
  for (const c of categories) {
    const paise = c?.budgetPaise;
    // A category that was never budgeted stays untracked rather than becoming
    // a budget of zero, which would read as "I planned to spend nothing".
    if (Number.isSafeInteger(paise) && paise >= 0 && (c.kind ?? 'expense') === 'expense') {
      current[c.id] = paise;
    }
  }

  const budgets = { ...(v2.budgets ?? {}) };
  if (Object.keys(current).length) budgets[key] = { ...current, ...(budgets[key] ?? {}) };

  return {
    ...v2,
    schemaVersion: 3,
    // The field goes, rather than lingering as a second place a budget could
    // be read from. Two sources of truth for one number is how they diverge.
    categories: categories.map(({ budgetPaise, ...rest }) => rest),
    budgets,
    settings: { ...(v2.settings ?? {}), schemaVersion: 3 },
  };
}

/**
 * Drop anything unusable and fill in anything missing. Never throws.
 *
 * This runs at the end of every migration, so it has to know about every field
 * v2 added: it rebuilds each record explicitly, and anything it has not been
 * taught about is gone. Harmless for junk, fatal for a field added upstream of
 * it — which is why it is made version-aware before the migration that needs it.
 */
export function normalise(input) {
  const base = defaultState();

  const rawCategories = Array.isArray(input.categories) && input.categories.length
    ? input.categories
    : base.categories;
  const categories = rawCategories.map((c, i) => validateCategory(c, i)).filter(Boolean);
  if (categories.length === 0) categories.push(...base.categories);

  // Both sinks must exist: they are the fallback for their kind, and a ledger
  // with no income category at all could not record income.
  const byId = new Map(categories.map((c) => [c.id, c]));
  if (byId.get(EXPENSE_SINK_ID)?.kind !== 'expense') {
    categories.push({ ...SEED_CATEGORIES[SEED_CATEGORIES.length - 1] });
  }
  if (!categories.some((c) => c.kind === 'income')) {
    categories.push(...SEED_INCOME_CATEGORIES.map((c) => ({ ...c })));
  }

  const rawAccounts = Array.isArray(input.accounts) && input.accounts.length
    ? input.accounts
    : base.accounts;
  const accounts = rawAccounts.map((a, i) => validateAccount(a, i)).filter(Boolean);
  if (accounts.length === 0) accounts.push(...base.accounts);

  const settings = { ...base.settings, ...(input.settings ?? {}) };
  const ctx = makeValidationContext({ categories, accounts, settings });

  const transactions = (Array.isArray(input.transactions) ? input.transactions : [])
    .map((t) => validateTransaction(t, ctx))
    .filter(Boolean);

  settings.defaultAccountId = ctx.defaultAccountId;
  if (ctx.categoryKind.get(settings.defaultExpenseCategoryId) !== 'expense') {
    settings.defaultExpenseCategoryId = ctx.sinks.expense;
  }
  if (ctx.categoryKind.get(settings.defaultIncomeCategoryId) !== 'income') {
    settings.defaultIncomeCategoryId = ctx.sinks.income;
  }
  settings.schemaVersion = CURRENT_SCHEMA_VERSION;

  // Budgets are scoped to categories that still exist: a budget pointing at a
  // deleted category would be money planned against nothing, and would show up
  // in the "budgeted" total without ever appearing as a row.
  const budgets = validateBudgets(input.budgets, new Set(categories.map((c) => c.id)));

  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    transactions,
    accounts,
    categories,
    budgets,
    settings,
  };
}

/**
 * Parse a raw JSON string into state.
 * Malformed JSON falls back to defaults instead of throwing.
 * @returns {{state: object, ok: boolean, reason: string|null}}
 */
export function parseState(text, options = {}) {
  if (text === null || text === undefined || text === '') {
    return { state: defaultState(), ok: true, reason: null };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: defaultState(), ok: false, reason: 'malformed-json' };
  }
  const result = migrate(parsed, options);
  if (!result.ok) return { state: defaultState(), ok: false, reason: result.reason };
  return { state: result.data, ok: true, reason: null };
}

/* ------------------------------------------------------------ persistence */

/** Read state from a Storage-like backend. Never throws. */
export function loadState(backend, key = STORAGE_KEY, options = {}) {
  let text = null;
  try {
    text = backend.getItem(key);
  } catch {
    return { state: defaultState(), ok: false, reason: 'unreadable' };
  }
  return parseState(text, options);
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
