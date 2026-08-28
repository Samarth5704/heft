/**
 * expense-form.js — the structured expense dialog, in add and edit modes.
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

export function createExpenseForm({ dialog, onSave, announce }) {
  const form = dialog.querySelector('#expense-form');
  const titleEl = dialog.querySelector('#expense-dialog-title');
  const amountEl = form.querySelector('#f-amount');
  const amountError = form.querySelector('#f-amount-error');
  const dateEl = form.querySelector('#f-date');
  const dateError = form.querySelector('#f-date-error');
  const categoryEl = form.querySelector('#f-category');
  const noteEl = form.querySelector('#f-note');
  const methodWrap = form.querySelector('#f-methods');
  const saveButton = form.querySelector('#expense-save');

  let editingId = null;
  let returnFocusTo = null;
  let method = '';

  for (const button of methodWrap.querySelectorAll('.chip')) {
    button.addEventListener('click', () => setMethod(button.dataset.method));
  }

  function setMethod(next) {
    method = next ?? '';
    for (const button of methodWrap.querySelectorAll('.chip')) {
      button.setAttribute('aria-checked', String((button.dataset.method ?? '') === method));
    }
  }

  function setError(input, node, message, tone = 'error') {
    node.textContent = message ?? '';
    node.dataset.tone = tone;
    input.setAttribute('aria-invalid', message && tone === 'error' ? 'true' : 'false');
  }

  function clearErrors() {
    setError(amountEl, amountError, '');
    setError(dateEl, dateError, '');
  }

  function fillCategories(categories, selectedId) {
    categoryEl.replaceChildren(...categories.map((c) => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.name;
      return option;
    }));
    categoryEl.value = selectedId;
  }

  function show({ id, title, action, values, categories, trigger }) {
    editingId = id;
    returnFocusTo = trigger ?? null;

    titleEl.textContent = title;
    saveButton.textContent = action;
    amountEl.value = values.amountPaise ? toRupeeString(values.amountPaise) : '';
    dateEl.value = values.date;
    noteEl.value = values.note ?? '';
    fillCategories(categories, values.categoryId);
    setMethod(values.paymentMethod ?? '');
    clearErrors();

    dialog.showModal();
    amountEl.focus();
    amountEl.select();
  }

  /** @param {{expense: object, categories: object[], trigger?: Element}} opts */
  function openEdit({ expense, categories, trigger }) {
    show({
      id: expense.id,
      title: 'Edit expense',
      action: 'Save changes',
      values: expense,
      categories,
      trigger,
    });
  }

  /**
   * Add mode. `draft` carries whatever the quick-add line already parsed, so a
   * half-typed entry is promoted into the full form rather than retyped.
   */
  function openAdd({ draft = {}, categories, defaultCategoryId, trigger } = {}) {
    show({
      id: null,
      title: 'Add expense',
      action: 'Add expense',
      values: {
        amountPaise: draft.amountPaise ?? null,
        date: draft.date ?? todayISO(),
        categoryId: draft.categoryId ?? defaultCategoryId ?? categories[0]?.id,
        note: draft.note ?? '',
        paymentMethod: draft.paymentMethod ?? '',
      },
      categories,
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

    if (!ok) {
      const firstBad = form.querySelector('[aria-invalid="true"]');
      if (firstBad) firstBad.focus();
      return { ok: false };
    }

    return {
      ok: true,
      values: {
        amountPaise: paise,
        date: dateEl.value,
        categoryId: categoryEl.value,
        note: noteEl.value.trim(),
        paymentMethod: method || undefined,
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

  for (const id of ['expense-cancel', 'expense-cancel-2']) {
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
