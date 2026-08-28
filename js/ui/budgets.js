/**
 * budgets.js — per-category monthly budgets, and how you are tracking.
 *
 * All the arithmetic lives in lib/analytics.js and is tested there; this
 * module decides what to say and draws it.
 *
 * A deliberate difference from the charts: budgets ignore the narrowing
 * filters. "Food & Dining: ₹0 of ₹5,000" while you happen to be filtered to
 * Transport would be a lie. A budget is a fact about the month, not about
 * whatever you are currently looking at.
 *
 * The bars are aria-hidden. Every number they encode — spent, budget,
 * percentage, pace, projection — is already adjacent readable text, so a
 * progressbar role would only repeat it.
 */

import { formatAmount, formatINR } from '../lib/money.js';
import { formatMonth } from '../lib/dates.js';
import { budgetReport } from '../lib/analytics.js';

const NEAR_THRESHOLD = 0.85;

/** How much of the budget is consumed, as a word. Never colour alone. */
function consumptionState(ratio) {
  if (ratio === null) return 'none';
  if (ratio > 1) return 'over';
  if (ratio >= NEAR_THRESHOLD) return 'near';
  return 'under';
}

/**
 * The sentence under the bar.
 *
 * Pace is only meaningful while a month is still running. For a finished
 * month there is nothing to keep up with, so report the result instead.
 */
export function paceSentence(row) {
  const {
    status, deltaPaise, remainingPaise, projectedPaise, budgetPaise, spentPaise,
    daysElapsed, daysInMonth,
  } = row;

  if (status === 'no-budget') return 'Untracked';
  if (status === 'upcoming') return 'Not started yet';

  if (status === 'over') {
    return `Finished ${formatINR(spentPaise - budgetPaise)} over budget`;
  }
  if (status === 'under') {
    return `Finished ${formatINR(budgetPaise - spentPaise)} under budget`;
  }

  const projection = projectedPaise === null
    ? ''
    : ` · on this pace, ${formatINR(projectedPaise)} by month end`;

  const left = remainingPaise >= 0
    ? `${formatINR(remainingPaise)} left`
    : `${formatINR(-remainingPaise)} over`;

  if (status === 'on-track') {
    return `On track · ${left}${projection}`;
  }
  const direction = status === 'ahead' ? 'ahead of pace' : 'behind pace';
  const day = `day ${daysElapsed} of ${daysInMonth}`;
  return `${formatINR(Math.abs(deltaPaise))} ${direction} on ${day} · ${left}${projection}`;
}

export function createBudgets({
  root, rowTemplate, emptyNode, scopeNode, onEdit,
}) {
  function buildRow({ label, colorToken, row, isOverall }) {
    const item = rowTemplate.content.firstElementChild.cloneNode(true);
    const ratio = row.ratio;
    const state = consumptionState(ratio);

    item.dataset.state = state;
    if (isOverall) item.dataset.overall = 'true';

    const dot = item.querySelector('.cat-dot');
    if (colorToken) dot.style.setProperty('--cat', `var(--${colorToken})`);
    else dot.remove();

    item.querySelector('.budget-label').textContent = label;

    const figures = item.querySelector('.budget-figures');
    const spent = document.createElement('span');
    spent.className = 'budget-spent';
    spent.textContent = formatINR(row.spentPaise);
    const of = document.createElement('span');
    of.className = 'budget-of';
    of.textContent = ` of ${formatINR(row.budgetPaise)}`;
    const share = document.createElement('span');
    share.className = 'budget-percent';
    share.textContent = `${Math.round((ratio ?? 0) * 100)}%`;
    figures.replaceChildren(spent, of, share);

    const fill = item.querySelector('.budget-fill');
    fill.style.inlineSize = `${Math.min(1, Math.max(0, ratio ?? 0)) * 100}%`;

    // A tick showing where the budget says you should be today. Pace becomes
    // something you can see, not only something the sentence claims.
    const mark = item.querySelector('.budget-pace-mark');
    if (row.status === 'ahead' || row.status === 'behind' || row.status === 'on-track') {
      const expectedRatio = row.budgetPaise ? row.expectedPaise / row.budgetPaise : 0;
      mark.style.insetInlineStart = `${Math.min(100, expectedRatio * 100)}%`;
    } else {
      mark.remove();
    }

    item.querySelector('.budget-status').textContent = paceSentence(row);
    return item;
  }

  function unbudgetedRow(paise, categoryCount) {
    const item = document.createElement('li');
    item.className = 'budget-row budget-unbudgeted';
    const head = document.createElement('div');
    head.className = 'budget-head';

    const label = document.createElement('span');
    label.className = 'budget-name';
    label.textContent = 'Outside any budget';

    const value = document.createElement('span');
    value.className = 'budget-figures num';
    value.textContent = formatINR(paise);

    head.append(label, value);

    const note = document.createElement('p');
    note.className = 'budget-status';
    note.textContent = paise === 0
      ? 'Everything this month fell inside a budget.'
      : `Spent in ${categoryCount} untracked ${categoryCount === 1 ? 'category' : 'categories'}. Give them budgets and this becomes visible in the totals above.`;

    item.append(head, note);
    return item;
  }

  /**
   * @param {{expenses: object[], categories: object[], monthKey: string,
   *          today: string}} ctx
   */
  function render({ expenses, categories, monthKey: key, today }) {
    const report = budgetReport(expenses, categories, key, today);
    const hasBudgets = report.budgeted.length > 0;

    scopeNode.textContent = formatMonth(key);
    emptyNode.hidden = hasBudgets;
    root.hidden = !hasBudgets;

    if (!hasBudgets) {
      root.replaceChildren();
      return;
    }

    const untrackedWithSpend = report.rows
      .filter((r) => r.budgetPaise === null && r.spentPaise > 0).length;

    root.replaceChildren(
      buildRow({
        label: 'All budgeted categories',
        colorToken: null,
        row: report.overall,
        isOverall: true,
      }),
      ...report.budgeted
        .slice()
        .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0))
        .map((row) => {
          const category = categories.find((c) => c.id === row.categoryId);
          return buildRow({
            label: row.name,
            colorToken: category?.colorToken ?? 'cat-neutral',
            row,
          });
        }),
      unbudgetedRow(report.unbudgetedPaise, untrackedWithSpend),
    );
  }

  if (onEdit) {
    for (const button of document.querySelectorAll('[data-action="edit-budgets"]')) {
      button.addEventListener('click', () => onEdit(button));
    }
  }

  return { render };
}

/* ------------------------------------------------------------- the dialog */

export function createBudgetDialog({ dialog, onSave, announce }) {
  const form = dialog.querySelector('#budget-form');
  const list = dialog.querySelector('#budget-fields');
  const errorNode = dialog.querySelector('#budget-form-error');
  let returnFocusTo = null;
  let fields = [];

  function open({ categories, trigger }) {
    returnFocusTo = trigger ?? null;
    errorNode.textContent = '';

    fields = categories.map((category, i) => {
      const row = document.createElement('div');
      row.className = 'budget-field';

      const label = document.createElement('label');
      label.className = 'budget-field-label';
      label.htmlFor = `budget-input-${i}`;

      const dot = document.createElement('span');
      dot.className = 'cat-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.style.setProperty('--cat', `var(--${category.colorToken})`);
      label.append(dot, category.name);

      const wrap = document.createElement('div');
      wrap.className = 'input-wrap';
      const prefix = document.createElement('span');
      prefix.className = 'input-prefix';
      prefix.setAttribute('aria-hidden', 'true');
      prefix.textContent = '₹';

      const input = document.createElement('input');
      input.type = 'text';
      input.inputMode = 'decimal';
      input.autocomplete = 'off';
      input.id = `budget-input-${i}`;
      input.placeholder = 'Untracked';
      input.value = category.budgetPaise === null || category.budgetPaise === undefined
        ? ''
        : String(Math.round(category.budgetPaise / 100));
      input.setAttribute('aria-describedby', 'budget-hint');

      wrap.append(prefix, input);
      row.append(label, wrap);
      return { category, row, input };
    });

    list.replaceChildren(...fields.map((f) => f.row));
    dialog.showModal();
    fields[0]?.input.focus();
    fields[0]?.input.select();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    const changes = [];
    let firstBad = null;
    for (const field of fields) {
      const raw = field.input.value.trim();
      field.input.setAttribute('aria-invalid', 'false');

      // Blank means untracked, which is not the same as a budget of zero.
      if (raw === '') {
        changes.push({ id: field.category.id, budgetPaise: null });
        continue;
      }
      // Budgets are whole rupees; nobody budgets to the paise.
      const rupees = Number(raw.replace(/[₹,\s]/g, ''));
      if (!Number.isFinite(rupees) || rupees < 0 || !Number.isInteger(rupees)) {
        field.input.setAttribute('aria-invalid', 'true');
        firstBad = firstBad ?? field.input;
        continue;
      }
      changes.push({ id: field.category.id, budgetPaise: rupees * 100 });
    }

    if (firstBad) {
      errorNode.textContent = 'Budgets must be whole rupees, or blank to leave a category untracked.';
      firstBad.focus();
      return;
    }

    onSave(changes);
    dialog.close();
  });

  for (const id of ['budget-cancel', 'budget-close']) {
    dialog.querySelector(`#${id}`).addEventListener('click', () => dialog.close());
  }

  dialog.addEventListener('close', () => {
    if (returnFocusTo && document.contains(returnFocusTo)) returnFocusTo.focus();
    returnFocusTo = null;
  });

  return { open };
}
