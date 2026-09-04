/**
 * backup.js — export, import, and the honest answer to "what will this do to
 * my data?"
 *
 * (This was `transfer.js` until v2, where a *transfer* became a kind of
 * transaction — money moving between two of your own accounts. One word, two
 * meanings, in a codebase where one of them must never end up in a total, is
 * a bug waiting to be written. Backup and restore is what this file is.)
 *
 * Import never silently overwrites. Reading a file and applying it are two
 * separate steps: `readImport` parses and migrates, `summariseImport` says
 * exactly what merging or replacing would change, and only then does the
 * caller pick one.
 *
 * Pure: no File, no Blob, no DOM. Strings in, plain objects out.
 */

import { CURRENT_SCHEMA_VERSION, defaultState, migrate, normalise } from './storage.js';

export const EXPORT_FORMAT = 'heft.export';
export const EXPORT_FORMAT_VERSION = 3;

/**
 * Wrap state for export. The envelope carries provenance; `data` is exactly
 * the shape the app stores, so a hand-edited file still imports.
 */
export function buildExport(state, { exportedAt = new Date().toISOString() } = {}) {
  return {
    format: EXPORT_FORMAT,
    formatVersion: EXPORT_FORMAT_VERSION,
    app: 'Heft',
    exportedAt,
    data: {
      schemaVersion: state.schemaVersion ?? CURRENT_SCHEMA_VERSION,
      transactions: state.transactions ?? [],
      accounts: state.accounts ?? [],
      categories: state.categories ?? [],
      budgets: state.budgets ?? {},
      settings: state.settings ?? {},
    },
  };
}

export function exportFilename(exportedAt = new Date().toISOString()) {
  return `heft-${exportedAt.slice(0, 10)}.json`;
}

/**
 * Parse an uploaded file into usable state.
 * Accepts either the export envelope or a bare state object, so a file
 * someone edited by hand or pulled straight out of localStorage still works.
 * A v1 file is recognised by its `expenses` array and migrated on the way in.
 *
 * @returns {{ok: true, state: object, exportedAt: string|null}
 *          | {ok: false, reason: string}}
 */
export function readImport(text) {
  if (typeof text !== 'string' || text.trim() === '') {
    return { ok: false, reason: 'empty-file' };
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'malformed-json' };
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, reason: 'not-an-object' };
  }

  const isEnvelope = parsed.format === EXPORT_FORMAT;
  const payload = isEnvelope ? parsed.data : parsed;

  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return { ok: false, reason: 'no-data' };
  }
  const looksLikeHeft = Array.isArray(payload.transactions)
    || Array.isArray(payload.expenses)
    || Array.isArray(payload.categories)
    || Array.isArray(payload.accounts);
  if (!looksLikeHeft) return { ok: false, reason: 'not-heft-data' };

  const result = migrate(payload);
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    state: result.data,
    exportedAt: isEnvelope && typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
  };
}

const idsOf = (list = []) => new Set(list.map((x) => x.id));

/**
 * What each choice would actually do. Nothing is applied here.
 *
 * Merge keeps every existing record and adds what is genuinely new, matching
 * on id. Replace swaps the whole ledger — so it reports how much would be
 * lost, which is the number people need before they click.
 */
export function summariseImport(current, incoming) {
  const currentTransactionIds = idsOf(current.transactions);
  const currentCategoryIds = idsOf(current.categories);
  const currentAccountIds = idsOf(current.accounts);

  const newTransactions = incoming.transactions.filter((t) => !currentTransactionIds.has(t.id));
  // A conflict is one id in both files. It is the number the preview has to
  // lead with, because it is the only one where the two modes disagree about
  // what happens to a record that already exists: merge keeps yours, replace
  // takes theirs. Everything else is addition either way.
  const conflicts = incoming.transactions.length - newTransactions.length;
  const newCategories = incoming.categories.filter((c) => !currentCategoryIds.has(c.id));
  const newAccounts = (incoming.accounts ?? []).filter((a) => !currentAccountIds.has(a.id));

  return {
    conflicts,
    incoming: {
      transactions: incoming.transactions.length,
      categories: incoming.categories.length,
      accounts: (incoming.accounts ?? []).length,
      budgetMonths: Object.keys(incoming.budgets ?? {}).length,
    },
    current: {
      transactions: current.transactions.length,
      categories: current.categories.length,
      accounts: (current.accounts ?? []).length,
      budgetMonths: Object.keys(current.budgets ?? {}).length,
    },
    // `transactionsUpdated` is 0 for merge and says so out loud rather than
    // being left out. "Nothing you already have will change" is the promise
    // this whole module exists to keep, and a preview that omits the figure
    // is not making the promise, it is just not mentioning it.
    merge: {
      transactionsAdded: newTransactions.length,
      transactionsUpdated: 0,
      transactionsSkipped: conflicts,
      categoriesAdded: newCategories.length,
      accountsAdded: newAccounts.length,
      transactionsAfter: current.transactions.length + newTransactions.length,
      transactionsRemoved: 0,
    },
    replace: {
      transactionsAdded: newTransactions.length,
      transactionsUpdated: conflicts,
      transactionsSkipped: 0,
      categoriesAdded: newCategories.length,
      accountsAdded: newAccounts.length,
      transactionsAfter: incoming.transactions.length,
      // What replace destroys: everything here that is not in the file. The
      // conflicting ones are overwritten rather than lost, which is a
      // different fact and gets a different line.
      transactionsRemoved: current.transactions.length - conflicts,
    },
  };
}

/**
 * Budgets merge month by month and category by category, and the existing
 * figure wins — the same rule as every other record here. A budget the user
 * changed this morning must not be reverted by a file exported last week.
 */
function mergeBudgets(current = {}, incoming = {}) {
  const out = { ...(incoming ?? {}) };
  for (const [key, month] of Object.entries(current ?? {})) {
    out[key] = { ...(out[key] ?? {}), ...month };
  }
  return out;
}

/**
 * Merge incoming into current. Existing records win on an id collision: the
 * file is older than what is on screen unless the user says otherwise, and
 * quietly overwriting an edit someone just made is the worse failure.
 *
 * Accounts merge alongside categories — an imported transaction whose account
 * did not come with it would be re-homed onto the default account by the
 * validator, which is a silent loss of exactly the kind this file exists to
 * prevent.
 */
export function mergeStates(current, incoming) {
  const existingTransactionIds = idsOf(current.transactions);
  const existingCategoryIds = idsOf(current.categories);
  const existingAccountIds = idsOf(current.accounts);

  return normalise({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    accounts: [
      ...current.accounts,
      ...(incoming.accounts ?? []).filter((a) => !existingAccountIds.has(a.id)),
    ],
    categories: [
      ...current.categories,
      ...incoming.categories.filter((c) => !existingCategoryIds.has(c.id)),
    ],
    transactions: [
      ...current.transactions,
      ...incoming.transactions.filter((t) => !existingTransactionIds.has(t.id)),
    ],
    budgets: mergeBudgets(current.budgets, incoming.budgets),
    settings: current.settings,
  });
}

/** Replace everything, keeping only the current theme choice. */
export function replaceWith(current, incoming) {
  return normalise({
    ...incoming,
    settings: { ...incoming.settings, theme: current.settings.theme },
  });
}

/** An empty ledger, keeping the user's accounts, categories and settings. */
export function clearedState(current) {
  return normalise({
    ...defaultState(),
    transactions: [],
    accounts: current.accounts,
    categories: current.categories,
    // The plan survives the ledger being emptied: budgets are what you intend
    // to spend, not a record of what you did.
    budgets: current.budgets,
    settings: current.settings,
  });
}
