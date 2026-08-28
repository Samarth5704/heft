/**
 * store.js — the only thing that mutates state, and the only thing that talks
 * to localStorage.
 *
 * Views subscribe, get a snapshot, and re-derive. No view writes to storage,
 * and no view mutates another view's DOM.
 *
 * Snapshot shape:
 *   { data: { schemaVersion, expenses, categories, settings },
 *     ui:   { filters, saveError, pendingDelete } }
 */

import {
  CURRENT_SCHEMA_VERSION, STORAGE_KEY, canDeleteCategory, defaultState,
  dropExpensesIn, loadState, makeCategoryId, reassignExpenses, saveState,
  validateCategory, validateExpense,
} from './lib/storage.js';
import { clearedState, mergeStates, replaceWith } from './lib/transfer.js';
import { DEFAULT_FILTERS, makeFilters } from './lib/filters.js';
import { today as todayISO } from './lib/dates.js';
import { generateSampleExpenses } from './lib/sample-data.js';

const SAVE_DEBOUNCE_MS = 400;
export const UNDO_WINDOW_MS = 8000;

const newId = () => (
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `e-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

export function createStore({
  backend = globalThis.localStorage,
  key = STORAGE_KEY,
  now = todayISO,
} = {}) {
  const listeners = new Set();

  let data = defaultState();
  let filters = makeFilters(DEFAULT_FILTERS);
  let saveError = null;
  let loadWarning = null;

  /** { expense, index, timer } — one at a time; a second delete commits the first. */
  let pendingDelete = null;

  let saveTimer = null;

  /* ------------------------------------------------------------ plumbing */

  function snapshot() {
    return {
      data,
      ui: {
        filters,
        saveError,
        loadWarning,
        pendingDelete: pendingDelete ? pendingDelete.expense : null,
      },
    };
  }

  function notify() {
    const snap = snapshot();
    for (const fn of listeners) fn(snap);
  }

  function persistNow() {
    saveTimer = null;
    const result = saveState(backend, data, key);
    const next = result.ok ? null : result.reason;
    if (next !== saveError) {
      saveError = next;
      notify();
    }
  }

  /** Debounced: typing in a note should not hit storage on every keystroke. */
  function persist() {
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
  }

  function commit() {
    persist();
    notify();
  }

  /* ---------------------------------------------------------- lifecycle */

  function init() {
    const result = loadState(backend, key);
    data = result.state;
    loadWarning = result.ok ? null : result.reason;
    notify();
    return snapshot();
  }

  /* ------------------------------------------------------------ queries */

  const categoryById = (id) => data.categories.find((c) => c.id === id) ?? null;

  /* ---------------------------------------------------------- mutations */

  /**
   * @param {{amountPaise, date, categoryId, note?, paymentMethod?}} draft
   * @returns {{ok: boolean, expense?: object, reason?: string}}
   */
  function addExpense(draft) {
    const ids = new Set(data.categories.map((c) => c.id));
    const expense = validateExpense({
      id: newId(),
      note: '',
      createdAt: new Date().toISOString(),
      ...draft,
    }, ids);
    if (!expense) return { ok: false, reason: 'invalid' };

    data = { ...data, expenses: [...data.expenses, expense] };
    commit();
    return { ok: true, expense };
  }

  function updateExpense(id, patch) {
    const current = data.expenses.find((e) => e.id === id);
    if (!current) return { ok: false, reason: 'not-found' };

    const ids = new Set(data.categories.map((c) => c.id));
    const next = validateExpense({ ...current, ...patch, id }, ids);
    if (!next) return { ok: false, reason: 'invalid' };

    data = {
      ...data,
      expenses: data.expenses.map((e) => (e.id === id ? next : e)),
    };
    commit();
    return { ok: true, expense: next };
  }

  /**
   * Remove the row now, keep the record in memory, and commit the removal
   * after the undo window closes. The row disappears immediately — an undo
   * that leaves the row on screen is not an undo, it is a confirmation.
   */
  function deleteExpense(id) {
    const index = data.expenses.findIndex((e) => e.id === id);
    if (index === -1) return { ok: false, reason: 'not-found' };

    if (pendingDelete) commitPendingDelete();

    const expense = data.expenses[index];
    data = { ...data, expenses: data.expenses.filter((e) => e.id !== id) };
    pendingDelete = {
      expense,
      index,
      timer: setTimeout(() => {
        pendingDelete = null;
        notify();
      }, UNDO_WINDOW_MS),
    };
    commit();
    return { ok: true, expense, undoWindowMs: UNDO_WINDOW_MS };
  }

  function commitPendingDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    pendingDelete = null;
  }

  function undoDelete() {
    if (!pendingDelete) return { ok: false, reason: 'nothing-pending' };
    const { expense, index } = pendingDelete;
    clearTimeout(pendingDelete.timer);
    pendingDelete = null;

    const expenses = [...data.expenses];
    expenses.splice(Math.min(index, expenses.length), 0, expense);
    data = { ...data, expenses };
    commit();
    return { ok: true, expense };
  }

  /* ------------------------------------------------------------- filters */

  function setFilters(patch) {
    filters = makeFilters({ ...filters, ...patch });
    notify();
  }

  function resetFilters(month = 'all') {
    filters = makeFilters({ ...DEFAULT_FILTERS, month });
    notify();
  }

  /* -------------------------------------------------------- categories */

  function updateCategory(id, patch) {
    data = {
      ...data,
      categories: data.categories.map((c) => (c.id === id ? { ...c, ...patch, id } : c)),
    };
    commit();
    return { ok: true };
  }

  function addCategory({ name, colorToken }) {
    const clean = String(name ?? '').trim();
    if (!clean) return { ok: false, reason: 'no-name' };
    if (data.categories.some((c) => c.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, reason: 'duplicate-name' };
    }
    const category = validateCategory({
      id: makeCategoryId(clean, data.categories),
      name: clean,
      colorToken,
      budgetPaise: null,
      icon: 'dot',
    }, data.categories.length);
    if (!category) return { ok: false, reason: 'invalid' };

    data = { ...data, categories: [...data.categories, category] };
    commit();
    return { ok: true, category };
  }

  /**
   * Remove a category without ever orphaning its expenses.
   * `mode` is required and explicit: 'reassign' moves them to `toId`,
   * 'delete' removes them along with the category. There is no third path
   * where expenses quietly point at a category that no longer exists.
   */
  function deleteCategory(id, { mode, toId } = {}) {
    const allowed = canDeleteCategory(data.categories, id);
    if (!allowed.ok) return allowed;

    let expenses;
    if (mode === 'reassign') {
      const target = toId && data.categories.some((c) => c.id === toId) ? toId : null;
      if (!target || target === id) return { ok: false, reason: 'bad-target' };
      expenses = reassignExpenses(data.expenses, id, target);
    } else if (mode === 'delete') {
      expenses = dropExpensesIn(data.expenses, id);
    } else {
      return { ok: false, reason: 'no-mode' };
    }

    const categories = data.categories.filter((c) => c.id !== id);
    const settings = data.settings.defaultCategoryId === id
      ? { ...data.settings, defaultCategoryId: 'other' }
      : data.settings;

    const moved = data.expenses.length - expenses.length;
    data = { ...data, expenses, categories, settings };
    commit();
    return { ok: true, removedExpenses: moved };
  }

  /* ------------------------------------------------------------- data */

  function loadSampleData({ months = 3, seed } = {}) {
    const expenses = generateSampleExpenses({
      today: now(),
      makeId: newId,
      months,
      ...(seed === undefined ? {} : { seed }),
    });
    data = { ...data, expenses };
    commit();
    return { ok: true, count: expenses.length };
  }

  /** Empty the ledger, keeping categories, budgets and settings. */
  function clearAll() {
    commitPendingDelete();
    const removed = data.expenses.length;
    data = clearedState(data);
    commit();
    return { ok: true, removed };
  }

  function replaceAll(nextData) {
    commitPendingDelete();
    data = { ...nextData, schemaVersion: CURRENT_SCHEMA_VERSION };
    commit();
    return { ok: true };
  }

  /** @param {'merge'|'replace'} mode */
  function importState(incoming, mode) {
    commitPendingDelete();
    if (mode !== 'merge' && mode !== 'replace') return { ok: false, reason: 'no-mode' };
    data = mode === 'merge' ? mergeStates(data, incoming) : replaceWith(data, incoming);
    commit();
    return { ok: true, expenses: data.expenses.length };
  }

  function setSetting(name, value) {
    data = { ...data, settings: { ...data.settings, [name]: value } };
    commit();
  }

  function dismissSaveError() {
    if (saveError === null) return;
    saveError = null;
    notify();
  }

  /* ------------------------------------------------------------- public */

  return {
    init,
    getState: snapshot,
    subscribe(fn) {
      listeners.add(fn);
      fn(snapshot());
      return () => listeners.delete(fn);
    },
    categoryById,
    addExpense,
    updateExpense,
    deleteExpense,
    undoDelete,
    commitPendingDelete,
    setFilters,
    resetFilters,
    updateCategory,
    addCategory,
    deleteCategory,
    importState,
    loadSampleData,
    clearAll,
    replaceAll,
    setSetting,
    dismissSaveError,
    /** Flush the debounce — used on pagehide so nothing is lost on close. */
    flush() {
      if (saveTimer !== null) {
        clearTimeout(saveTimer);
        persistNow();
      }
    },
  };
}
