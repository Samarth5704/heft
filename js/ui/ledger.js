/**
 * ledger.js — the reconciling renderer.
 *
 * Never rebuilds the list with innerHTML. Rows are cloned once from a
 * <template>, kept in a Map keyed by expense id, and updated field by field
 * only where the value actually changed. That keeps focus, keeps text
 * selection, and keeps the browser from re-laying-out the whole month every
 * time one number moves.
 *
 * JavaScript's only contribution to a row's appearance is `--t`. Everything
 * else — size, weight, ink, padding, rule, spine — is interpolated in CSS.
 */

import { formatAmount, formatINR } from '../lib/money.js';
import { formatDay, formatRelativeDay } from '../lib/dates.js';
import { groupByDay, weightScale } from '../lib/analytics.js';

const METHOD_LABELS = { cash: 'Cash', upi: 'UPI', card: 'Card' };

export function createLedger({ list, dayTemplate, rowTemplate, onEdit, onDelete }) {
  /** date -> { li, ul, timeEl, totalEl, total } */
  const days = new Map();
  /** id -> { li, refs, snap } */
  const rows = new Map();

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buildRow(id) {
    const li = rowTemplate.content.firstElementChild.cloneNode(true);
    const refs = {
      note: li.querySelector('.row-note'),
      catDot: li.querySelector('.cat-dot'),
      catName: li.querySelector('.cat-name'),
      method: li.querySelector('.row-method'),
      digits: li.querySelector('.row-digits'),
      edit: li.querySelector('.row-edit'),
      del: li.querySelector('.row-delete'),
    };
    li.dataset.id = id;
    refs.edit.addEventListener('click', () => onEdit(id));
    refs.del.addEventListener('click', () => onDelete(id));
    return { li, refs, snap: {} };
  }

  function buildDay(date) {
    const li = dayTemplate.content.firstElementChild.cloneNode(true);
    return {
      li,
      ul: li.querySelector('.day-rows'),
      timeEl: li.querySelector('.day-date'),
      totalEl: li.querySelector('.day-total-digits'),
      snap: {},
    };
  }

  /** Collapse, then detach. The Map entry is dropped by the caller first. */
  function detach(node, { animate }) {
    if (!animate) {
      node.remove();
      return;
    }
    node.dataset.leaving = 'true';
    const drop = () => node.remove();
    node.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 700);
  }

  /**
   * @param {object[]} visible already filtered and in no particular order
   * @param {{categoriesById: object, today: string, animateEntry?: boolean}} ctx
   */
  function render(visible, { categoriesById, today, animateEntry = true }) {
    // Read phase: everything derived up front, no DOM touched yet.
    const scale = weightScale(visible.map((e) => e.amountPaise));
    const groups = groupByDay(visible);
    const visibleIds = new Set(visible.map((e) => e.id));
    const seenDays = new Set();
    const seenRows = new Set();
    const motion = !reduceMotion();

    // A bulk load should not animate three hundred rows in at once.
    const arriving = visible.reduce((n, e) => n + (rows.has(e.id) ? 0 : 1), 0);
    const animateArrivals = animateEntry && motion && arriving > 0 && arriving <= 12;

    // Write phase.
    let dayCursor = list.firstElementChild;

    for (const group of groups) {
      seenDays.add(group.date);
      let day = days.get(group.date);
      if (!day) {
        day = buildDay(group.date);
        days.set(group.date, day);
      }
      if (day.li !== dayCursor) list.insertBefore(day.li, dayCursor);
      else dayCursor = dayCursor.nextElementSibling;

      const label = formatRelativeDay(group.date, today);
      if (day.snap.label !== label) {
        day.timeEl.textContent = label;
        day.timeEl.setAttribute('datetime', group.date);
        day.snap.label = label;
      }
      if (day.snap.total !== group.totalPaise) {
        day.totalEl.textContent = formatAmount(group.totalPaise);
        day.snap.total = group.totalPaise;
      }
      const isToday = String(group.date === today);
      if (day.li.dataset.today !== isToday) day.li.dataset.today = isToday;

      let rowCursor = day.ul.firstElementChild;
      for (const expense of group.expenses) {
        seenRows.add(expense.id);
        let row = rows.get(expense.id);
        const isNew = !row;
        if (isNew) {
          row = buildRow(expense.id);
          rows.set(expense.id, row);
          if (animateArrivals) {
            row.li.dataset.entering = 'true';
            row.li.addEventListener('animationend', () => {
              delete row.li.dataset.entering;
            }, { once: true });
          }
        }
        if (row.li !== rowCursor) day.ul.insertBefore(row.li, rowCursor);
        else rowCursor = rowCursor.nextElementSibling;

        updateRow(row, expense, categoriesById, scale, today);
      }

      // Anything left after the cursor is not part of this day any more.
      // A row that merely moved to another date is detached now and
      // re-inserted when that date is processed; a row that is actually
      // going away is left in place so it can collapse on screen.
      while (rowCursor) {
        const next = rowCursor.nextElementSibling;
        if (visibleIds.has(rowCursor.dataset.id)) rowCursor.remove();
        rowCursor = next;
      }
    }

    for (const [id, row] of rows) {
      if (!seenRows.has(id)) {
        rows.delete(id);
        detach(row.li, { animate: motion });
      }
    }
    // A day header outlives its rows just long enough for them to collapse
    // inside it — no animation of its own, only the delay.
    for (const [date, day] of days) {
      if (!seenDays.has(date)) {
        days.delete(date);
        detach(day.li, { animate: motion });
      }
    }

    return { scale, count: visible.length };
  }

  function updateRow(row, expense, categoriesById, scale, today) {
    const { refs, snap, li } = row;
    const category = categoriesById[expense.categoryId];
    const catName = category?.name ?? 'Unknown';
    const t = scale.t(expense.amountPaise).toFixed(3);

    if (snap.t !== t) {
      li.style.setProperty('--t', t);
      snap.t = t;
    }
    if (snap.note !== expense.note) {
      refs.note.textContent = expense.note;
      snap.note = expense.note;
    }
    if (snap.catName !== catName) {
      refs.catName.textContent = catName;
      snap.catName = catName;
    }
    const token = category?.colorToken ?? 'cat-neutral';
    if (snap.token !== token) {
      refs.catDot.style.setProperty('--cat', `var(--${token})`);
      snap.token = token;
    }
    const method = METHOD_LABELS[expense.paymentMethod] ?? '';
    if (snap.method !== method) {
      refs.method.textContent = method;
      snap.method = method;
    }
    if (snap.amount !== expense.amountPaise) {
      refs.digits.textContent = formatAmount(expense.amountPaise);
      snap.amount = expense.amountPaise;
    }

    /* Action buttons carry context, not forty identical "Delete"s. */
    const described = describe(expense, catName, today);
    if (snap.described !== described) {
      refs.edit.setAttribute('aria-label', `Edit ${described}`);
      refs.del.setAttribute('aria-label', `Delete ${described}`);
      refs.edit.title = 'Edit';
      refs.del.title = 'Delete';
      snap.described = described;
    }
  }

  function describe(expense, catName, today) {
    const parts = [formatINR(expense.amountPaise)];
    parts.push(expense.note ? expense.note : catName);
    parts.push(expense.date === today ? 'today' : formatDay(expense.date));
    return parts.join(', ');
  }

  return {
    render,
    /** Used by the undo announcement, so the wording matches the button. */
    describe,
    clear() {
      list.replaceChildren();
      days.clear();
      rows.clear();
    },
  };
}
