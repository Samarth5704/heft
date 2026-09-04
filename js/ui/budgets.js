/**
 * budgets.js — the Budgets tab.
 *
 * Two sections. What is budgeted for the period on screen, and what is not —
 * and the second is the one that matters most, because money outside every
 * budget is the money that goes unnoticed. It is itemised, with its own total
 * stated in full, and every row in it is one tap from having a plan.
 *
 * **Budgets are monthly.** The period bar offers six modes; storing six
 * parallel sets of budgets would let them disagree, so one monthly figure is
 * prorated across whatever the period covers (`analytics.budgetForRange`). A
 * whole month gets exactly its own figure; a week gets its share of the
 * month; six months add up. The sheet says so, every time, rather than
 * leaving a weekly view looking as though it had its own separate plan.
 *
 * Pace is the second thing this tab exists for:
 *
 *   expectedSpend = budget x (daysElapsed / daysInPeriod)
 *
 * with today counted as elapsed. For a period that has already ended, pace is
 * meaningless — there is nothing left to predict — so the row reports the
 * result instead. That distinction lives in `analytics.paceForRange` and is
 * only rendered here.
 */

import { anchorOf } from '../lib/router.js';
import { addMonths, formatMonth, monthsInRange, periodRange } from '../lib/dates.js';
import { budgetReportForRange } from '../lib/analytics.js';
import { money } from '../lib/format.js';
import { toPaise, toRupeeString } from '../lib/money.js';
import { categoryChip, icon } from './icon.js';

const $ = (id) => document.getElementById(id);

export function createBudgets({ store, router, announce, today }) {
  const els = {
    scope: $('budget-scope'),
    overall: $('budget-overall'),
    overallSpent: $('budget-overall-spent'),
    overallOf: $('budget-overall-of'),
    overallTrack: $('budget-overall-track'),
    overallFill: $('budget-overall-fill'),
    overallPace: $('budget-overall-pace'),
    overallStatus: $('budget-overall-status'),
    list: $('budget-list'),
    listEmpty: $('budget-list-empty'),
    unbudgeted: $('budget-unbudgeted'),
    unbudgetedTotal: $('budget-unbudgeted-total'),
    unbudgetedNote: $('budget-unbudgeted-note'),
    copy: $('budget-copy'),
    dialog: $('budget-dialog'),
    amount: $('budget-amount'),
    amountError: $('budget-amount-error'),
    amountHelp: $('budget-amount-help'),
    forLine: $('budget-for'),
    remove: $('budget-remove'),
    template: $('tpl-budget'),
    unsetTemplate: $('tpl-unbudgeted'),
  };

  $('budget-cancel').prepend(icon('close'));

  let snap = store.getState();
  /** The category the sheet is editing, and the months it will write to. */
  let editing = null;

  const display = () => ({ showDecimals: snap.data.settings.showDecimals !== false });
  const amount = (paise) => money(paise, display());
  const weekStart = () => snap.data.settings.weekStartsOn ?? 1;
  const rangeOf = (route) => periodRange(route.mode, anchorOf(route, today), weekStart());

  /* ------------------------------------------------------------- copy --
     Budgets are per month; the copy is per month too. For a period covering
     several, each of them takes from the month before it. */

  const monthsOf = (range) => monthsInRange(range);

  /** Is there anything in the preceding months that is not already here? */
  function canCopy(range) {
    const budgets = snap.data.budgets ?? {};
    return monthsOf(range).some((key) => {
      const previous = budgets[addMonths(key, -1)];
      if (!previous) return false;
      const current = budgets[key] ?? {};
      return Object.keys(previous).some((id) => !Object.hasOwn(current, id));
    });
  }

  els.copy.addEventListener('click', () => {
    const range = rangeOf(router.route);
    const result = store.copyBudgetsFromPrevious(monthsOf(range));
    if (!result.ok) {
      announce.say('There is nothing in the previous period that is not already budgeted here.');
      return;
    }
    announce.say(
      `Copied ${result.copied} budget${result.copied === 1 ? '' : 's'} forward. `
      + 'Anything already set for this period was left as it was.',
    );
  });

  /* ------------------------------------------------------------ the sheet */

  /**
   * The sheet always edits a *monthly* figure, and always says which months
   * it will land in. A period of one month names that month; a longer one
   * names the span and applies the same figure to each, which is what "a
   * monthly budget" means over six months.
   */
  function openSheet(row, trigger) {
    const range = rangeOf(router.route);
    const months = monthsOf(range);
    editing = { categoryId: row.categoryId, name: row.name, months };

    $('budget-dialog-title').textContent = row.budgetPaise === null
      ? 'Set budget'
      : 'Edit budget';

    els.forLine.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = row.name;
    els.forLine.append(strong, ` — ${amount(row.spentPaise)} spent in ${range.label}.`);

    // Prefill with the monthly figure, not the period figure: the input is
    // labelled "Monthly budget" and must round-trip what it shows.
    const first = snap.data.budgets?.[months[0]]?.[row.categoryId];
    els.amount.value = Number.isFinite(first) ? toRupeeString(first) : '';
    els.amountError.textContent = '';
    els.amount.setAttribute('aria-invalid', 'false');

    els.amountHelp.textContent = months.length === 1
      ? `A monthly figure, applied to ${formatMonth(months[0])}.`
      : `A monthly figure, applied to each of the ${months.length} months from `
        + `${formatMonth(months[0])} to ${formatMonth(months[months.length - 1])}. `
        + `This period's budget is that figure ${months.length} times over.`;

    els.remove.hidden = row.budgetPaise === null;

    els.dialog.returnFocusTo = trigger ?? document.activeElement;
    els.dialog.showModal();
    els.amount.focus();
    els.amount.select();
  }

  $('budget-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editing) return;

    const paise = toPaise(els.amount.value);
    if (paise === null || paise < 0) {
      els.amountError.textContent = 'Enter an amount, like 6000 or 1,200.50.';
      els.amount.setAttribute('aria-invalid', 'true');
      els.amount.focus();
      return;
    }

    let failed = null;
    for (const key of editing.months) {
      const result = store.setBudget(key, editing.categoryId, paise);
      if (!result.ok) failed = result.reason;
    }
    if (failed) {
      els.amountError.textContent = `Could not save that budget: ${failed}.`;
      els.amount.setAttribute('aria-invalid', 'true');
      return;
    }

    const where = editing.months.length === 1
      ? formatMonth(editing.months[0])
      : `each of ${editing.months.length} months`;
    announce.say(`${editing.name} budgeted at ${amount(paise)} for ${where}.`);
    els.dialog.close();
  });

  els.remove.addEventListener('click', () => {
    if (!editing) return;
    for (const key of editing.months) store.clearBudget(key, editing.categoryId);
    announce.say(`${editing.name} is no longer budgeted. Its spending moves to the unbudgeted list.`);
    els.dialog.close();
  });

  $('budget-cancel').addEventListener('click', () => els.dialog.close());

  els.dialog.addEventListener('close', () => {
    editing = null;
    const back = els.dialog.returnFocusTo;
    if (back && document.contains(back)) back.focus();
    els.dialog.returnFocusTo = null;
  });

  /* ------------------------------------------------------------ the rows */

  /**
   * The pace sentence.
   *
   * A period that has ended cannot be paced — there is nothing left to
   * predict — so it reports what happened. A period that has not started
   * says so rather than claiming to be perfectly on track.
   */
  function paceText(row) {
    if (row.isFuture) return 'This period has not started yet.';
    if (row.isPast) {
      const over = row.spentPaise - row.budgetPaise;
      return over > 0
        ? `Finished ${amount(over)} over budget.`
        : `Finished ${amount(-over)} under budget.`;
    }
    if (row.status === 'on-track') return 'On track.';
    const delta = amount(Math.abs(row.deltaPaise));
    return row.deltaPaise > 0 ? `${delta} ahead of pace.` : `${delta} behind pace.`;
  }

  /** The projection, always labelled as one. It is a rate carried forward,
   *  not a promise, and a row that hid that would be lying about certainty. */
  function projectionText(row) {
    if (row.isPast || row.isFuture || row.projectedPaise === null) return '';
    const verdict = row.projectedPaise > row.budgetPaise ? 'over' : 'within';
    return `At this rate, projected to finish at ${amount(row.projectedPaise)} — ${verdict} budget.`;
  }

  /** Swap the template's placeholder chip for the category's own mark. */
  function setChip(li, row, size) {
    const chip = categoryChip(row.icon, row.colorToken, { size });
    chip.classList.add('budget-chip');
    li.querySelector('.budget-chip').replaceWith(chip);
  }

  function buildRow(row) {
    const li = els.template.content.firstElementChild.cloneNode(true);
    const button = li.querySelector('.budget-open');
    li.dataset.state = row.state;

    setChip(li, row, '2.25rem');
    li.querySelector('.budget-name').textContent = row.name;
    li.querySelector('.budget-spent').textContent = amount(row.spentPaise);
    li.querySelector('.budget-of').textContent = `of ${amount(row.budgetPaise)}`;

    const fill = li.querySelector('.budget-fill');
    const ratio = row.budgetPaise > 0 ? row.spentPaise / row.budgetPaise : (row.spentPaise ? 1 : 0);
    fill.style.setProperty('--fill', `${Math.min(100, Math.round(ratio * 100))}%`);

    // Where the plan says you should be today. Meaningless once the period
    // has ended, so it is not drawn then.
    const mark = li.querySelector('.budget-pace');
    if (!row.isPast && !row.isFuture && row.daysInPeriod) {
      mark.hidden = false;
      mark.style.setProperty('--at', `${Math.round((row.daysElapsed / row.daysInPeriod) * 100)}%`);
    }

    const status = paceText(row);
    li.querySelector('.budget-status').textContent = status;
    li.querySelector('.budget-projection').textContent = projectionText(row);

    // The name carries the whole row, so it is never forty bare "Edit"s.
    button.setAttribute(
      'aria-label',
      `Edit budget for ${row.name}: ${amount(row.spentPaise)} spent of `
      + `${amount(row.budgetPaise)}. ${status}`,
    );
    button.addEventListener('click', () => openSheet(row, button));
    return li;
  }

  function buildUnsetRow(row) {
    const li = els.unsetTemplate.content.firstElementChild.cloneNode(true);
    const button = li.querySelector('.budget-open');

    setChip(li, row, '2rem');
    li.querySelector('.budget-name').textContent = row.name;
    li.querySelector('.budget-spent').textContent = amount(row.spentPaise);

    button.setAttribute(
      'aria-label',
      row.spentPaise > 0
        ? `Set a budget for ${row.name}. ${amount(row.spentPaise)} spent with no budget.`
        : `Set a budget for ${row.name}. Nothing spent this period.`,
    );
    button.addEventListener('click', () => openSheet(row, button));
    return li;
  }

  /* -------------------------------------------------------------- paint */

  function paint(route = router.route) {
    const range = rangeOf(route);
    if (!range) return;

    const report = budgetReportForRange(
      snap.data.transactions,
      snap.data.categories,
      snap.data.budgets ?? {},
      range,
      today,
    );

    const months = monthsOf(range);
    els.scope.textContent = months.length === 1
      ? `${range.label}. Budgets are set per month.`
      : `${range.label}. Budgets are set per month; this period covers ${months.length} of them.`;

    /* ------- the overall row ------- */

    const overall = report.overall;
    els.overall.hidden = overall.budgetPaise === null;
    if (overall.budgetPaise !== null) {
      els.overall.dataset.state = overall.state;
      els.overallSpent.textContent = amount(overall.spentPaise);
      els.overallOf.textContent = `of ${amount(overall.budgetPaise)} budgeted`;
      const ratio = overall.budgetPaise > 0 ? overall.spentPaise / overall.budgetPaise : 0;
      els.overallFill.style.setProperty('--fill', `${Math.min(100, Math.round(ratio * 100))}%`);
      if (!overall.isPast && !overall.isFuture && overall.daysInPeriod) {
        els.overallPace.hidden = false;
        els.overallPace.style.setProperty(
          '--at', `${Math.round((overall.daysElapsed / overall.daysInPeriod) * 100)}%`,
        );
      } else {
        els.overallPace.hidden = true;
      }
      els.overallStatus.textContent = `${paceText(overall)} ${projectionText(overall)}`.trim();
    }

    /* ------- budgeted ------- */

    els.list.replaceChildren(...report.budgeted.map(buildRow));
    els.listEmpty.hidden = report.budgeted.length > 0;
    els.copy.hidden = !canCopy(range);

    /* ------- not budgeted ------- */

    els.unbudgetedTotal.textContent = amount(report.unbudgetedPaise);
    els.unbudgetedNote.textContent = report.unbudgetedPaise > 0
      ? `spent in ${range.label} outside every budget, across `
        + `${report.unbudgeted.filter((r) => r.spentPaise > 0).length} `
        + `categor${report.unbudgeted.filter((r) => r.spentPaise > 0).length === 1 ? 'y' : 'ies'}.`
      : `spent outside a budget in ${range.label}.`;

    els.unbudgeted.replaceChildren(...report.unbudgeted.map(buildUnsetRow));
  }

  store.subscribe((next) => {
    snap = next;
    if (router.route.tab === 'budgets') paint();
  });

  return { paint };
}
