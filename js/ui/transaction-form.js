/**
 * transaction-form.js — the structured transaction dialog, in add and edit
 * modes, for all three kinds.
 *
 * The kind control comes first because it decides what the rest of the form
 * means: an expense and an income differ only in direction, and a transfer
 * has no category at all — it has a destination account instead.
 *
 * Focus goes to the amount field on open, Enter submits, Escape closes, and
 * focus returns to whatever opened it. Errors are tied to their input with
 * aria-describedby and aria-invalid, so they are announced rather than merely
 * coloured red.
 *
 * onSave is called with (id, values); id is null when adding.
 */

import { toPaise, toRupeeString } from '../lib/money.js';
import { isValid, today as todayISO } from '../lib/dates.js';

/** Above this, warn — do not block. People really do spend ₹10,00,000. */
const ABSURD_PAISE = 100000000;

const KINDS = ['expense', 'income', 'transfer'];

const TITLES = {
  expense: { add: 'Add expense', edit: 'Edit expense' },
  income: { add: 'Add income', edit: 'Edit income' },
  transfer: { add: 'Add transfer', edit: 'Edit transfer' },
};

/** What the model calls a record, given what the form calls its kind. */
export function draftShapeFor(kind) {
  return kind === 'transfer'
    ? { kind: 'transfer', direction: null }
    : { kind: 'transaction', direction: kind };
}

/** And back again, for edit mode. */
export function kindOf(transaction) {
  return transaction.kind === 'transfer' ? 'transfer' : transaction.direction;
}

export function createTransactionForm({ dialog, onSave, announce }) {
  const form = dialog.querySelector('#transaction-form');
  const titleEl = dialog.querySelector('#transaction-dialog-title');
  const amountEl = form.querySelector('#f-amount');
  const amountError = form.querySelector('#f-amount-error');
  const dateEl = form.querySelector('#f-date');
  const dateError = form.querySelector('#f-date-error');
  const categoryField = form.querySelector('#f-category-field');
  const categoryEl = form.querySelector('#f-category');
  const accountLabel = form.querySelector('#f-account-label');
  const accountEl = form.querySelector('#f-account');
  const toAccountField = form.querySelector('#f-to-account-field');
  const toAccountEl = form.querySelector('#f-to-account');
  const toAccountError = form.querySelector('#f-to-account-error');
  const noteEl = form.querySelector('#f-note');
  const kindWrap = form.querySelector('#f-kinds');
  const saveButton = form.querySelector('#transaction-save');

  const kindButtons = [...kindWrap.querySelectorAll('.seg')];

  let editingId = null;
  let returnFocusTo = null;
  let kind = 'expense';
  /** Both category lists, kept so switching kind does not need a re-open. */
  let allCategories = [];
  let allAccounts = [];

  /* ------------------------------------------------ the kind radiogroup */

  /**
   * A radio group is one tab stop, not three. The checked button holds the
   * only tabindex="0"; arrows move the selection and the focus together,
   * which is what makes it behave like the native control it is claiming
   * to be.
   */
  function setKind(next, { focus = false } = {}) {
    kind = KINDS.includes(next) ? next : 'expense';
    for (const button of kindButtons) {
      const on = button.dataset.kind === kind;
      button.setAttribute('aria-checked', String(on));
      button.tabIndex = on ? 0 : -1;
      if (on && focus) button.focus();
    }
    applyKind();
  }

  /** Show the fields this kind actually has, and name them for this kind. */
  function applyKind() {
    const transfer = kind === 'transfer';
    categoryField.hidden = transfer;
    toAccountField.hidden = !transfer;
    accountLabel.textContent = transfer ? 'From account' : kind === 'income' ? 'Into account' : 'Account';
    fillCategories(categoryEl.value);
    if (!transfer) setError(toAccountEl, toAccountError, '');
    titleEl.textContent = TITLES[kind][editingId ? 'edit' : 'add'];
    saveButton.textContent = editingId ? 'Save changes' : TITLES[kind].add;
  }

  for (const button of kindButtons) {
    button.addEventListener('click', () => setKind(button.dataset.kind));
  }

  kindWrap.addEventListener('keydown', (event) => {
    const index = kindButtons.indexOf(document.activeElement);
    if (index === -1) return;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (index + 1) % kindButtons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (index - 1 + kindButtons.length) % kindButtons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = kindButtons.length - 1;
    else return;
    event.preventDefault();
    setKind(kindButtons[next].dataset.kind, { focus: true });
  });

  /* ------------------------------------------------------------- fields */

  function setError(input, node, message, tone = 'error') {
    node.textContent = message ?? '';
    node.dataset.tone = tone;
    input.setAttribute('aria-invalid', message && tone === 'error' ? 'true' : 'false');
  }

  function clearErrors() {
    setError(amountEl, amountError, '');
    setError(dateEl, dateError, '');
    setError(toAccountEl, toAccountError, '');
  }

  function fillSelect(select, items, selectedId) {
    select.replaceChildren(...items.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      return option;
    }));
    // Keep the current choice where it is still offered, so switching kind
    // and switching back does not silently move the record.
    if (selectedId && items.some((i) => i.id === selectedId)) select.value = selectedId;
    else if (items.length) select.value = items[0].id;
  }

  /**
   * Only the categories belonging to this kind. An expense cannot be filed
   * under Salary; offering it and rejecting it afterwards is worse than not
   * offering it.
   */
  function fillCategories(selectedId) {
    if (kind === 'transfer') return;
    const wanted = allCategories.filter((c) => (c.kind ?? 'expense') === kind && !c.archived);
    fillSelect(categoryEl, wanted, selectedId);
  }

  function show({ id, values, categories, accounts, trigger }) {
    editingId = id;
    returnFocusTo = trigger ?? null;
    allCategories = categories ?? [];
    allAccounts = (accounts ?? []).filter((a) => !a.archived);

    amountEl.value = values.amountPaise ? toRupeeString(values.amountPaise) : '';
    dateEl.value = values.date;
    noteEl.value = values.note ?? '';
    fillSelect(accountEl, allAccounts, values.accountId);
    fillSelect(toAccountEl, allAccounts, values.toAccountId);
    categoryEl.value = values.categoryId ?? '';
    setKind(values.kind);
    fillCategories(values.categoryId);
    clearErrors();

    dialog.showModal();
    amountEl.focus();
    amountEl.select();
  }

  /** @param {{transaction: object, categories, accounts, trigger?: Element}} opts */
  function openEdit({ transaction, categories, accounts, trigger }) {
    show({
      id: transaction.id,
      values: { ...transaction, kind: kindOf(transaction) },
      categories,
      accounts,
      trigger,
    });
  }

  /**
   * Add mode. `draft` carries whatever the quick-add line already parsed, so a
   * half-typed entry is promoted into the full form rather than retyped.
   */
  function openAdd({
    draft = {}, categories, accounts, defaultCategoryId, defaultAccountId, kind: startKind, trigger,
  } = {}) {
    show({
      id: null,
      values: {
        kind: startKind ?? draft.kind ?? 'expense',
        amountPaise: draft.amountPaise ?? null,
        date: draft.date ?? todayISO(),
        categoryId: draft.categoryId ?? defaultCategoryId ?? null,
        accountId: draft.accountId ?? defaultAccountId ?? null,
        toAccountId: null,
        note: draft.note ?? '',
      },
      categories,
      accounts,
      trigger,
    });
  }

  function close() {
    if (dialog.open) dialog.close();
  }

  /** @returns {{ok: boolean, values?: object}} */
  function validate() {
    clearErrors();
    let ok = true;

    const paise = toPaise(amountEl.value);
    if (paise === null) {
      setError(amountEl, amountError, 'Enter an amount, like 250 or 1,200.50.');
      ok = false;
    } else if (paise <= 0) {
      setError(amountEl, amountError, 'Amount must be more than zero.');
      ok = false;
    } else if (paise > ABSURD_PAISE) {
      // A warning, not a block.
      setError(amountEl, amountError, 'That is over ₹10,00,000 — saving anyway.', 'warn');
    }

    if (!isValid(dateEl.value)) {
      setError(dateEl, dateError, 'Pick a valid date.');
      ok = false;
    }

    if (kind === 'transfer' && toAccountEl.value === accountEl.value) {
      setError(toAccountEl, toAccountError, 'Pick a different account to move the money into.');
      ok = false;
    }

    if (!ok) {
      const firstBad = form.querySelector('[aria-invalid="true"]');
      if (firstBad) firstBad.focus();
      return { ok: false };
    }

    return {
      ok: true,
      values: {
        ...draftShapeFor(kind),
        amountPaise: paise,
        date: dateEl.value,
        accountId: accountEl.value,
        toAccountId: kind === 'transfer' ? toAccountEl.value : null,
        categoryId: kind === 'transfer' ? null : categoryEl.value,
        note: noteEl.value.trim(),
      },
    };
  }

  form.addEventListener('submit', (event) => {
    // The form is method="dialog"; take the submit ourselves so validation
    // can veto it, and close explicitly once the save succeeds.
    event.preventDefault();
    const result = validate();
    if (!result.ok) return;
    onSave(editingId, result.values);
    close();
  });

  for (const id of ['transaction-cancel', 'transaction-cancel-2']) {
    dialog.querySelector(`#${id}`).addEventListener('click', () => close());
  }

  // Covers Escape, the close button, and any programmatic close.
  dialog.addEventListener('close', () => {
    editingId = null;
    if (returnFocusTo && document.contains(returnFocusTo)) {
      returnFocusTo.focus();
    }
    returnFocusTo = null;
  });

  // Live-clear the amount error as soon as the value becomes parseable.
  amountEl.addEventListener('input', () => {
    if (amountEl.getAttribute('aria-invalid') !== 'true') return;
    if (toPaise(amountEl.value) !== null) setError(amountEl, amountError, '');
  });

  return { openEdit, openAdd, close, get isOpen() { return dialog.open; } };
}
