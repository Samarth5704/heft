/**
 * transfer.js — export, import, and the honest answer to "what will this do
 * to my data?"
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
export const EXPORT_FORMAT_VERSION = 1;

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
      expenses: state.expenses ?? [],
      categories: state.categories ?? [],
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
  if (!Array.isArray(payload.expenses) && !Array.isArray(payload.categories)) {
    return { ok: false, reason: 'not-heft-data' };
  }

  const result = migrate(payload);
  if (!result.ok) return { ok: false, reason: result.reason };

  return {
    ok: true,
    state: result.data,
    exportedAt: isEnvelope && typeof parsed.exportedAt === 'string' ? parsed.exportedAt : null,
  };
}

/**
 * What each choice would actually do. Nothing is applied here.
 *
 * Merge keeps every existing record and adds what is genuinely new, matching
 * on id. Replace swaps the whole ledger — so it reports how much would be
 * lost, which is the number people need before they click.
 */
export function summariseImport(current, incoming) {
  const currentExpenseIds = new Set(current.expenses.map((e) => e.id));
  const currentCategoryIds = new Set(current.categories.map((c) => c.id));

  const newExpenses = incoming.expenses.filter((e) => !currentExpenseIds.has(e.id));
  const duplicateExpenses = incoming.expenses.length - newExpenses.length;
  const newCategories = incoming.categories.filter((c) => !currentCategoryIds.has(c.id));

  return {
    incoming: {
      expenses: incoming.expenses.length,
      categories: incoming.categories.length,
    },
    current: {
      expenses: current.expenses.length,
      categories: current.categories.length,
    },
    merge: {
      expensesAdded: newExpenses.length,
      expensesSkipped: duplicateExpenses,
      categoriesAdded: newCategories.length,
      expensesAfter: current.expenses.length + newExpenses.length,
      expensesRemoved: 0,
    },
    replace: {
      expensesAdded: incoming.expenses.length,
      expensesSkipped: 0,
      categoriesAdded: newCategories.length,
      expensesAfter: incoming.expenses.length,
      expensesRemoved: current.expenses.length,
    },
  };
}

/**
 * Merge incoming into current. Existing records win on an id collision: the
 * file is older than what is on screen unless the user says otherwise, and
 * quietly overwriting an edit someone just made is the worse failure.
 */
export function mergeStates(current, incoming) {
  const existingExpenseIds = new Set(current.expenses.map((e) => e.id));
  const existingCategoryIds = new Set(current.categories.map((c) => c.id));

  return normalise({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    expenses: [
      ...current.expenses,
      ...incoming.expenses.filter((e) => !existingExpenseIds.has(e.id)),
    ],
    categories: [
      ...current.categories,
      ...incoming.categories.filter((c) => !existingCategoryIds.has(c.id)),
    ],
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

/** An empty ledger, keeping the user's categories and settings. */
export function clearedState(current) {
  return normalise({
    ...defaultState(),
    expenses: [],
    categories: current.categories,
    settings: current.settings,
  });
}
