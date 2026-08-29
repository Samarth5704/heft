/**
 * store.js — the only thing that mutates state, and the only thing that talks
 * to localStorage.
 *
 * Views subscribe, get a snapshot, and re-derive. No view writes to storage,
 * and no view mutates another view's DOM.
 *
 * Snapshot shape:
 *   { data: { schemaVersion, transactions, accounts, categories, settings },
 *     ui:   { filters, saveError, loadWarning, readOnly, pendingDelete } }
 */

import {
  CURRENT_SCHEMA_VERSION, EXPENSE_SINK_ID, INCOME_SINK_ID, STORAGE_KEY,
  canDeleteAccount, canDeleteCategory, countTransactionsFor, countTransactionsIn,
  defaultState, dropTransactionsFor, dropTransactionsIn, loadState, makeAccountId,
  makeCategoryId, makeValidationContext, reassignAccount, reassignCategory,
  saveState, validateAccount, validateCategory, validateTransaction, SEED_ACCOUNTS,
} from './lib/storage.js';
import { clearedState, mergeStates, replaceWith } from './lib/backup.js';
import { DEFAULT_FILTERS, makeFilters } from './lib/filters.js';
import { today as todayISO } from './lib/dates.js';
import { generateSampleTransactions } from './lib/sample-data.js';

const SAVE_DEBOUNCE_MS = 400;
export const UNDO_WINDOW_MS = 8000;

const newId = () => (
  globalThis.crypto?.randomUUID
    ? crypto.randomUUID()
    : `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
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

  /**
   * Set when the stored payload came from a newer build than this one. The
   * app then refuses every mutation rather than persisting a state it built
   * out of defaults — writing here would destroy the data it could not read.
   */
  let readOnly = false;

  /** { transaction, index, timer } — one at a time; a second delete commits the first. */
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
        readOnly,
        pendingDelete: pendingDelete ? pendingDelete.transaction : null,
      },
    };
  }

  function notify() {
    const snap = snapshot();
    for (const fn of listeners) fn(snap);
  }

  function persistNow() {
    saveTimer = null;
    if (readOnly) return;
    const result = saveState(backend, data, key);
    const next = result.ok ? null : result.reason;
    if (next !== saveError) {
      saveError = next;
      notify();
    }
  }

  /** Debounced: typing in a note should not hit storage on every keystroke. */
  function persist() {
    if (readOnly) return;
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistNow, SAVE_DEBOUNCE_MS);
  }

  function commit() {
    persist();
    notify();
  }

  /** Every mutation goes through this first. */
  const blocked = () => (readOnly ? { ok: false, reason: 'read-only' } : null);

  /* ---------------------------------------------------------- lifecycle */

  function init() {
    const result = loadState(backend, key);
    data = result.state;
    loadWarning = result.ok ? null : result.reason;
    readOnly = result.reason === 'future-schema';
    notify();
    return snapshot();
  }

  /* ------------------------------------------------------------ queries */

  const categoryById = (id) => data.categories.find((c) => c.id === id) ?? null;
  const accountById = (id) => data.accounts.find((a) => a.id === id) ?? null;
  const context = () => makeValidationContext(data);

  /* ---------------------------------------------------------- mutations */

  /**
   * Resolve a draft into something `validateTransaction` can accept, refusing
   * rather than repairing anything a user could have got wrong on purpose.
   *
   * The category-kind rule lives here, not in the form: an income transaction
   * takes an income category and an expense takes an expense one. The
   * validator's silent fallback to a sink is the right behaviour for a file
   * off disk and the wrong behaviour for a person filling in a form, who
   * should be told rather than quietly overruled.
   */
  function resolveDraft(draft) {
    const kind = draft.kind === 'transfer' ? 'transfer' : 'transaction';

    if (kind === 'transfer') {
      if (!accountById(draft.accountId)) return { ok: false, reason: 'unknown-account' };
      if (!accountById(draft.toAccountId)) return { ok: false, reason: 'unknown-account' };
      if (draft.accountId === draft.toAccountId) return { ok: false, reason: 'same-account' };
      return {
        ok: true,
        draft: { ...draft, kind, direction: null, categoryId: null },
      };
    }

    const direction = draft.direction === 'income' ? 'income' : 'expense';
    const accountId = draft.accountId ?? data.settings.defaultAccountId;
    if (!accountById(accountId)) return { ok: false, reason: 'unknown-account' };

    const fallback = direction === 'income'
      ? data.settings.defaultIncomeCategoryId
      : data.settings.defaultExpenseCategoryId;
    const categoryId = draft.categoryId ?? fallback;
    const category = categoryById(categoryId);
    if (!category) return { ok: false, reason: 'unknown-category' };
    if ((category.kind ?? 'expense') !== direction) {
      return { ok: false, reason: 'category-kind-mismatch' };
    }

    return {
      ok: true,
      draft: {
        ...draft, kind, direction, accountId, categoryId, toAccountId: null,
      },
    };
  }

  /**
   * @param {{kind?, direction?, amountPaise, date, accountId?, toAccountId?,
   *          categoryId?, note?}} draft
   * @returns {{ok: boolean, transaction?: object, reason?: string}}
   */
  function addTransaction(draft) {
    const stop = blocked();
    if (stop) return stop;

    const resolved = resolveDraft(draft ?? {});
    if (!resolved.ok) return resolved;

    const transaction = validateTransaction({
      id: newId(),
      note: '',
      createdAt: new Date().toISOString(),
      ...resolved.draft,
    }, context());
    if (!transaction) return { ok: false, reason: 'invalid' };

    data = { ...data, transactions: [...data.transactions, transaction] };
    commit();
    return { ok: true, transaction };
  }

  function updateTransaction(id, patch) {
    const stop = blocked();
    if (stop) return stop;

    const current = data.transactions.find((t) => t.id === id);
    if (!current) return { ok: false, reason: 'not-found' };

    const resolved = resolveDraft({ ...current, ...patch, id });
    if (!resolved.ok) return resolved;

    const next = validateTransaction({ ...resolved.draft, id }, context());
    if (!next) return { ok: false, reason: 'invalid' };

    data = {
      ...data,
      transactions: data.transactions.map((t) => (t.id === id ? next : t)),
    };
    commit();
    return { ok: true, transaction: next };
  }

  /* Convenience wrappers, so a caller that knows what it is adding says so. */
  const addExpense = (draft) => addTransaction({ ...draft, kind: 'transaction', direction: 'expense' });
  const addIncome = (draft) => addTransaction({ ...draft, kind: 'transaction', direction: 'income' });
  const addTransfer = (draft) => addTransaction({ ...draft, kind: 'transfer' });

  /**
   * Remove the row now, keep the record in memory, and commit the removal
   * after the undo window closes. The row disappears immediately — an undo
   * that leaves the row on screen is not an undo, it is a confirmation.
   */
  function deleteTransaction(id) {
    const stop = blocked();
    if (stop) return stop;

    const index = data.transactions.findIndex((t) => t.id === id);
    if (index === -1) return { ok: false, reason: 'not-found' };

    if (pendingDelete) commitPendingDelete();

    const transaction = data.transactions[index];
    data = { ...data, transactions: data.transactions.filter((t) => t.id !== id) };
    pendingDelete = {
      transaction,
      index,
      timer: setTimeout(() => {
        pendingDelete = null;
        notify();
      }, UNDO_WINDOW_MS),
    };
    commit();
    return { ok: true, transaction, undoWindowMs: UNDO_WINDOW_MS };
  }

  function commitPendingDelete() {
    if (!pendingDelete) return;
    clearTimeout(pendingDelete.timer);
    pendingDelete = null;
  }

  function undoDelete() {
    if (!pendingDelete) return { ok: false, reason: 'nothing-pending' };
    const { transaction, index } = pendingDelete;
    clearTimeout(pendingDelete.timer);
    pendingDelete = null;

    const transactions = [...data.transactions];
    transactions.splice(Math.min(index, transactions.length), 0, transaction);
    data = { ...data, transactions };
    commit();
    return { ok: true, transaction };
  }

  /* ------------------------------------------------------------- filters */

  function setFilters(patch) {
    filters = makeFilters({ ...filters, ...patch });
    notify();
  }

  function resetFilters(range = null) {
    filters = makeFilters({ ...DEFAULT_FILTERS, range });
    notify();
  }

  /* -------------------------------------------------------- categories */

  function updateCategory(id, patch) {
    const stop = blocked();
    if (stop) return stop;
    const current = categoryById(id);
    if (!current) return { ok: false, reason: 'not-found' };
    // A category's kind is fixed once it has history: flipping it would turn
    // every transaction under it into a kind mismatch in a single click.
    if (patch.kind && patch.kind !== current.kind
      && countTransactionsIn(data.transactions, id) > 0) {
      return { ok: false, reason: 'in-use' };
    }
    const next = validateCategory({ ...current, ...patch, id }, 0);
    if (!next) return { ok: false, reason: 'invalid' };

    data = {
      ...data,
      categories: data.categories.map((c) => (c.id === id ? next : c)),
    };
    commit();
    return { ok: true, category: next };
  }

  function addCategory({ name, kind = 'expense', colorToken, icon = 'dot' }) {
    const stop = blocked();
    if (stop) return stop;

    const clean = String(name ?? '').trim();
    if (!clean) return { ok: false, reason: 'no-name' };
    // Names only have to be unique within their kind: "Returns" can be both a
    // thing you spend on and a thing you earn from.
    const clash = data.categories.some(
      (c) => c.kind === kind && c.name.toLowerCase() === clean.toLowerCase(),
    );
    if (clash) return { ok: false, reason: 'duplicate-name' };

    const category = validateCategory({
      id: makeCategoryId(clean, data.categories),
      name: clean,
      kind,
      colorToken,
      budgetPaise: null,
      icon,
      archived: false,
    }, data.categories.length);
    if (!category) return { ok: false, reason: 'invalid' };

    data = { ...data, categories: [...data.categories, category] };
    commit();
    return { ok: true, category };
  }

  /**
   * Remove a category without ever orphaning its transactions.
   *
   * With nothing pointing at it, it just goes. With history behind it, `mode`
   * is required and explicit: 'reassign' moves them to `toId`, 'delete'
   * removes them along with the category. There is no third path where
   * transactions quietly point at a category that no longer exists — and
   * archiving remains the option that keeps the history intact.
   */
  function deleteCategory(id, { mode, toId } = {}) {
    const stop = blocked();
    if (stop) return stop;

    const allowed = canDeleteCategory(data.categories, id, data.transactions);
    if (!allowed.ok && allowed.reason !== 'in-use') return allowed;

    const target = categoryById(id);
    let transactions = data.transactions;

    if (allowed.reason === 'in-use') {
      if (mode === 'reassign') {
        const to = categoryById(toId);
        if (!to || to.id === id) return { ok: false, reason: 'bad-target' };
        if (to.kind !== target.kind) return { ok: false, reason: 'kind-mismatch' };
        transactions = reassignCategory(transactions, id, toId);
      } else if (mode === 'delete') {
        transactions = dropTransactionsIn(transactions, id);
      } else {
        return { ok: false, reason: 'no-mode', count: allowed.count };
      }
    }

    const categories = data.categories.filter((c) => c.id !== id);
    const settings = { ...data.settings };
    if (settings.defaultExpenseCategoryId === id) settings.defaultExpenseCategoryId = EXPENSE_SINK_ID;
    if (settings.defaultIncomeCategoryId === id) settings.defaultIncomeCategoryId = INCOME_SINK_ID;

    const removed = data.transactions.length - transactions.length;
    data = { ...data, transactions, categories, settings };
    commit();
    return { ok: true, removedTransactions: removed };
  }

  /** Keep the history, take it off the picker. The default for anything used. */
  const archiveCategory = (id) => updateCategory(id, { archived: true });
  const restoreCategory = (id) => updateCategory(id, { archived: false });

  /* ---------------------------------------------------------- accounts */

  function addAccount({
    name, type = 'cash', openingBalancePaise = 0, colorToken, icon = 'wallet',
  }) {
    const stop = blocked();
    if (stop) return stop;

    const clean = String(name ?? '').trim();
    if (!clean) return { ok: false, reason: 'no-name' };
    if (data.accounts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) {
      return { ok: false, reason: 'duplicate-name' };
    }

    const account = validateAccount({
      id: makeAccountId(clean, data.accounts),
      name: clean,
      type,
      openingBalancePaise,
      colorToken,
      icon,
      archived: false,
    }, data.accounts.length);
    if (!account) return { ok: false, reason: 'invalid' };

    data = { ...data, accounts: [...data.accounts, account] };
    commit();
    return { ok: true, account };
  }

  function updateAccount(id, patch) {
    const stop = blocked();
    if (stop) return stop;
    const current = accountById(id);
    if (!current) return { ok: false, reason: 'not-found' };

    const next = validateAccount({ ...current, ...patch, id }, 0);
    if (!next) return { ok: false, reason: 'invalid' };

    const accounts = data.accounts.map((a) => (a.id === id ? next : a));
    const settings = { ...data.settings };
    // The default account has to be one you can actually pick.
    if (next.archived && settings.defaultAccountId === id) {
      settings.defaultAccountId = accounts.find((a) => !a.archived)?.id ?? id;
    }

    data = { ...data, accounts, settings };
    commit();
    return { ok: true, account: next };
  }

  const archiveAccount = (id) => updateAccount(id, { archived: true });
  const restoreAccount = (id) => updateAccount(id, { archived: false });

  /**
   * The category rule, applied to accounts: delete outright only when nothing
   * points at it, otherwise an explicit reassign-or-delete. Reassigning moves
   * both ends of a transfer, and a transfer whose ends collapse onto one
   * account is dropped rather than left as a record that moves money nowhere.
   */
  function deleteAccount(id, { mode, toId } = {}) {
    const stop = blocked();
    if (stop) return stop;

    const allowed = canDeleteAccount(data.accounts, id, data.transactions);
    if (!allowed.ok && allowed.reason !== 'in-use') return allowed;

    let transactions = data.transactions;

    if (allowed.reason === 'in-use') {
      if (mode === 'reassign') {
        if (!accountById(toId) || toId === id) return { ok: false, reason: 'bad-target' };
        transactions = reassignAccount(transactions, id, toId);
      } else if (mode === 'delete') {
        transactions = dropTransactionsFor(transactions, id);
      } else {
        return { ok: false, reason: 'no-mode', count: allowed.count };
      }
    }

    const accounts = data.accounts.filter((a) => a.id !== id);
    const settings = { ...data.settings };
    if (settings.defaultAccountId === id) {
      settings.defaultAccountId = accounts.find((a) => !a.archived)?.id ?? accounts[0]?.id ?? null;
    }

    const removed = data.transactions.length - transactions.length;
    data = { ...data, transactions, accounts, settings };
    commit();
    return { ok: true, removedTransactions: removed };
  }

  /* ------------------------------------------------------------- data */

  function loadSampleData({ months = 3, seed } = {}) {
    const stop = blocked();
    if (stop) return stop;

    // The generated ledger spends from Cash, Bank and Card; a migrated user
    // may only have some of them, and a transaction pointed at an account
    // that is not there would be silently re-homed by the validator.
    const have = new Set(data.accounts.map((a) => a.id));
    const accounts = [
      ...data.accounts,
      ...SEED_ACCOUNTS.filter((a) => !have.has(a.id)).map((a) => ({ ...a })),
    ];

    const transactions = generateSampleTransactions({
      today: now(),
      makeId: newId,
      months,
      ...(seed === undefined ? {} : { seed }),
    });

    data = { ...data, accounts, transactions };
    commit();
    return { ok: true, count: transactions.length };
  }

  /** Empty the ledger, keeping accounts, categories, budgets and settings. */
  function clearAll() {
    const stop = blocked();
    if (stop) return stop;
    commitPendingDelete();
    const removed = data.transactions.length;
    data = clearedState(data);
    commit();
    return { ok: true, removed };
  }

  function replaceAll(nextData) {
    const stop = blocked();
    if (stop) return stop;
    commitPendingDelete();
    data = { ...nextData, schemaVersion: CURRENT_SCHEMA_VERSION };
    commit();
    return { ok: true };
  }

  /** @param {'merge'|'replace'} mode */
  function importState(incoming, mode) {
    const stop = blocked();
    if (stop) return stop;
    commitPendingDelete();
    if (mode !== 'merge' && mode !== 'replace') return { ok: false, reason: 'no-mode' };
    data = mode === 'merge' ? mergeStates(data, incoming) : replaceWith(data, incoming);
    commit();
    return { ok: true, transactions: data.transactions.length };
  }

  function setSetting(name, value) {
    const stop = blocked();
    if (stop) return stop;
    data = { ...data, settings: { ...data.settings, [name]: value } };
    commit();
    return { ok: true };
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
    accountById,
    countTransactionsIn: (id) => countTransactionsIn(data.transactions, id),
    countTransactionsFor: (id) => countTransactionsFor(data.transactions, id),
    addTransaction,
    addExpense,
    addIncome,
    addTransfer,
    updateTransaction,
    deleteTransaction,
    undoDelete,
    commitPendingDelete,
    setFilters,
    resetFilters,
    updateCategory,
    addCategory,
    deleteCategory,
    archiveCategory,
    restoreCategory,
    addAccount,
    updateAccount,
    deleteAccount,
    archiveAccount,
    restoreAccount,
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
