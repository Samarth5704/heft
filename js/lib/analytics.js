/**
 * analytics.js — every function here is pure and takes the transaction array
 * as an argument. Nothing reads global state, nothing touches the DOM, nothing
 * reads a clock (today is always passed in). That is what makes them testable.
 *
 * All money in, all money out, is integer paise.
 *
 * The v2 rule that governs this whole file: a transaction carries a POSITIVE
 * amount and a separate direction, and a transfer is neither income nor
 * expense. So every aggregation entry point states the kind it wants, up
 * front, and filters before it sums. A total that quietly includes a transfer
 * or an income record looks entirely plausible and is always wrong.
 */

import { sumPaise } from './money.js';
import {
  addDays, compare, datesInMonth, daysInMonth, daysOfMonthInRange, monthKey,
  monthKeyParts, addMonths, dayOfWeek, diffDays, monthsInRange, parts,
  periodRange, periodsEndingAt, periodLength, isInRange,
} from './dates.js';

/* ------------------------------------------------------------------ kinds */

export const isTransfer = (t) => t.kind === 'transfer';
export const isExpense = (t) => t.kind === 'transaction' && t.direction === 'expense';
export const isIncome = (t) => t.kind === 'transaction' && t.direction === 'income';

/**
 * The three things a chart can be a chart *of*. Naming them is what keeps the
 * Analysis tab from growing a fourth vocabulary for the same question.
 */
export const VIEWS = Object.freeze(['expense', 'income', 'net']);

/**
 * The signed contribution one transaction makes to a view.
 *
 * This is the single place the transfer rule is enforced for every series
 * below: a transfer contributes zero to all three views, because it is
 * neither money earned nor money spent. Everything that buckets, sums or
 * plots goes through here rather than reaching for `amountPaise` itself.
 */
export function viewAmount(transaction, view = 'expense') {
  if (view === 'income') return isIncome(transaction) ? transaction.amountPaise : 0;
  if (view === 'net') {
    if (isIncome(transaction)) return transaction.amountPaise;
    return isExpense(transaction) ? -transaction.amountPaise : 0;
  }
  return isExpense(transaction) ? transaction.amountPaise : 0;
}

export const expensesOf = (transactions = []) => transactions.filter(isExpense);
export const incomeOf = (transactions = []) => transactions.filter(isIncome);
export const transfersOf = (transactions = []) => transactions.filter(isTransfer);

/** Everything inside an inclusive {start, end} range. A null range is everything. */
export function inRange(transactions = [], range = null) {
  if (!range) return [...transactions];
  return transactions.filter((t) => isInRange(t.date, range));
}

/** Only the transactions inside a 'YYYY-MM' month. */
export function inMonth(transactions = [], key) {
  return transactions.filter((t) => monthKey(t.date) === key);
}

/* ------------------------------------------------------------------ totals */

/**
 * The raw sum of whatever it is handed — no kind filtering at all.
 *
 * Kept because plenty of callers have already narrowed to one kind, but never
 * call it on a mixed ledger: it would add a salary and a card-to-bank transfer
 * into a "spend" figure without complaint. Use expenseTotalPaise,
 * incomeTotalPaise or netPaise, which say what they mean.
 */
export function totalPaise(transactions = []) {
  return sumPaise(transactions, (t) => t.amountPaise);
}

export function expenseTotalPaise(transactions = []) {
  return sumPaise(expensesOf(transactions), (t) => t.amountPaise);
}

export function incomeTotalPaise(transactions = []) {
  return sumPaise(incomeOf(transactions), (t) => t.amountPaise);
}

/** Income minus expense. Transfers move money between your own pockets and
 *  cannot change it, so they are excluded by construction. */
export function netPaise(transactions = []) {
  return incomeTotalPaise(transactions) - expenseTotalPaise(transactions);
}

/**
 * The triad the Records header shows for a period: what came in, what went
 * out, and the difference. `transferCount` is reported so the UI can say a
 * transfer happened without ever folding it into a total.
 */
export function periodTotals(transactions = [], range = null) {
  const scoped = inRange(transactions, range);
  const incomePaise = incomeTotalPaise(scoped);
  const expensePaise = expenseTotalPaise(scoped);
  return {
    start: range?.start ?? null,
    end: range?.end ?? null,
    label: range?.label ?? 'All time',
    incomePaise,
    expensePaise,
    netPaise: incomePaise - expensePaise,
    count: scoped.length,
    transferCount: transfersOf(scoped).length,
  };
}

/**
 * Totals per category for one direction, largest first.
 *
 * Transfers have no category and are excluded by construction — asking for a
 * direction is what excludes them, which is why there is no kind-blind
 * version of this function.
 *
 * @returns {{categoryId: string, totalPaise: number, count: number, share: number}[]}
 */
export function byCategory(transactions = [], direction = 'expense') {
  const scoped = transactions.filter(
    (t) => t.kind === 'transaction' && t.direction === direction,
  );
  const map = new Map();
  for (const t of scoped) {
    const row = map.get(t.categoryId) ?? { categoryId: t.categoryId, totalPaise: 0, count: 0 };
    row.totalPaise += t.amountPaise;
    row.count += 1;
    map.set(t.categoryId, row);
  }
  const total = totalPaise(scoped);
  return [...map.values()]
    .map((row) => ({ ...row, share: total ? row.totalPaise / total : 0 }))
    .sort((a, b) => b.totalPaise - a.totalPaise || compare(a.categoryId, b.categoryId));
}

export const expenseByCategory = (transactions = []) => byCategory(transactions, 'expense');
export const incomeByCategory = (transactions = []) => byCategory(transactions, 'income');

/** Expense totals per source account. Transfers are not spending. */
export function byAccount(transactions = [], direction = 'expense') {
  const map = new Map();
  for (const t of transactions) {
    if (t.kind !== 'transaction' || t.direction !== direction) continue;
    map.set(t.accountId, (map.get(t.accountId) ?? 0) + t.amountPaise);
  }
  return [...map.entries()]
    .map(([accountId, paise]) => ({ accountId, totalPaise: paise }))
    .sort((a, b) => b.totalPaise - a.totalPaise || compare(a.accountId, b.accountId));
}

/* --------------------------------------------------------------- balances */

/**
 * An account's balance, derived — there is no stored balance field anywhere in
 * this app, and nothing increments one in place.
 *
 *   opening + income in - expense out - transfers out + transfers in
 *
 * A transfer's two legs are read from the one record, so the money that leaves
 * `accountId` is exactly the money that arrives at `toAccountId` and net worth
 * cannot drift. An account with no transactions is exactly its opening balance.
 */
export function accountBalance(account, transactions = []) {
  if (!account) return 0;
  let balance = account.openingBalancePaise ?? 0;
  for (const t of transactions) {
    if (t.kind === 'transfer') {
      if (t.accountId === account.id) balance -= t.amountPaise;
      if (t.toAccountId === account.id) balance += t.amountPaise;
    } else if (t.accountId === account.id) {
      balance += t.direction === 'income' ? t.amountPaise : -t.amountPaise;
    }
  }
  return balance;
}

export function accountBalances(accounts = [], transactions = []) {
  return accounts.map((account) => ({
    accountId: account.id,
    name: account.name,
    type: account.type,
    archived: account.archived === true,
    openingBalancePaise: account.openingBalancePaise ?? 0,
    balancePaise: accountBalance(account, transactions),
  }));
}

/**
 * Everything you have, across every account. Archived accounts still hold
 * money, so they still count; the UI may hide them, but the number may not.
 */
export function netWorthPaise(accounts = [], transactions = []) {
  return accountBalances(accounts, transactions)
    .reduce((sum, row) => sum + row.balancePaise, 0);
}

export function netWorth(accounts = [], transactions = []) {
  const rows = accountBalances(accounts, transactions);
  return {
    totalPaise: rows.reduce((sum, row) => sum + row.balancePaise, 0),
    accounts: rows,
  };
}

/* ------------------------------------------------------------ day buckets */

/** One entry per calendar day of the month, zero-filled. Expenses by default. */
export function dailyTotals(transactions = [], key, view = 'expense') {
  const dates = datesInMonth(key);
  const map = new Map(dates.map((d) => [d, 0]));
  for (const t of transactions) {
    if (map.has(t.date)) map.set(t.date, map.get(t.date) + viewAmount(t, view));
  }
  return dates.map((date) => ({ date, totalPaise: map.get(date) }));
}

/**
 * Daily totals across an arbitrary inclusive date range, zero-filled.
 *
 * The rolling average needs the days *before* a period starts, or the line
 * would restart from nothing on the first of every month.
 *
 * `view` picks what is being totalled. It defaults to expense, so every
 * existing caller keeps the meaning it was written with; the net view is the
 * only one whose values can be negative.
 */
export function dailyTotalsBetween(transactions = [], startISO, endISO, view = 'expense') {
  if (!startISO || !endISO || compare(startISO, endISO) > 0) return [];
  const map = new Map();
  for (let d = startISO; compare(d, endISO) <= 0; d = addDays(d, 1)) map.set(d, 0);
  for (const t of transactions) {
    if (map.has(t.date)) map.set(t.date, map.get(t.date) + viewAmount(t, view));
  }
  return [...map.entries()].map(([date, totalPaise]) => ({ date, totalPaise }));
}

/**
 * Group into day buckets, newest day first, for the ledger.
 *
 * Every kind appears as a row — income and transfers are things that happened
 * on that day and the ledger shows them. The day header's `totalPaise` is
 * expense only, because that is what a spending total means; `incomePaise` and
 * `netPaise` are there for a header that wants to say more.
 */
export function groupByDay(transactions = []) {
  const map = new Map();
  for (const t of transactions) {
    if (!map.has(t.date)) map.set(t.date, []);
    map.get(t.date).push(t);
  }
  return [...map.entries()]
    .sort((a, b) => compare(b[0], a[0]))
    .map(([date, items]) => ({
      date,
      // Stable order inside a day: newest entry first, id as the tiebreak.
      transactions: items.slice().sort(
        (a, b) => compare(b.createdAt ?? '', a.createdAt ?? '') || compare(a.id, b.id),
      ),
      totalPaise: expenseTotalPaise(items),
      expensePaise: expenseTotalPaise(items),
      incomePaise: incomeTotalPaise(items),
      netPaise: netPaise(items),
    }));
}

/** The biggest expenses. A salary is not a big expense, so income is excluded. */
export function topExpenses(transactions = [], limit = 5) {
  return expensesOf(transactions)
    .sort((a, b) => b.amountPaise - a.amountPaise || compare(b.date, a.date))
    .slice(0, limit);
}

/* -------------------------------------------------------------- statistics */

/** Median of a number list. Even counts average the middle pair. */
export function median(values = []) {
  const nums = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (nums.length === 0) return 0;
  const mid = Math.floor(nums.length / 2);
  return nums.length % 2 === 1 ? nums[mid] : Math.round((nums[mid - 1] + nums[mid]) / 2);
}

export function mean(values = []) {
  const nums = values.filter(Number.isFinite);
  if (nums.length === 0) return 0;
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length);
}

/**
 * How many days of a range have happened, counting today as elapsed.
 * A future range is 0; a finished one is its whole length.
 */
export function daysElapsedIn(range, todayISO) {
  if (!range || !parts(todayISO)) return 0;
  if (compare(todayISO, range.start) < 0) return 0;
  if (compare(todayISO, range.end) > 0) return periodLength(range);
  return diffDays(range.start, todayISO) + 1;
}

/** The same question asked of a 'YYYY-MM' month. */
export function daysElapsed(key, todayISO) {
  const m = monthKeyParts(key);
  if (!m || !parts(todayISO)) return 0;
  return daysElapsedIn(periodRange('monthly', `${key}-01`), todayISO);
}

/**
 * Mean vs median daily spend — the comparison this app exists to surface. The
 * denominator is *days elapsed*, not days with an expense: a day you spent
 * nothing is a real day, and dropping it flatters both numbers. Mean is
 * dragged up by rent and EMIs; median is what an ordinary day costs.
 *
 * Income and transfers are not spending, so the default view excludes both.
 * The Analysis tab asks the same question of income and of net by naming a
 * different view; a transfer is excluded from all three by `viewAmount`.
 */
export function dailySpendStatsForRange(transactions = [], range, todayISO, view = 'expense') {
  const elapsed = daysElapsedIn(range, todayISO);
  const series = dailyTotalsBetween(inRange(transactions, range), range.start, range.end, view)
    .slice(0, elapsed)
    .map((d) => d.totalPaise);
  return {
    days: elapsed,
    meanPaise: mean(series),
    medianPaise: median(series),
    totalPaise: sumPaise(series),
  };
}

export function dailySpendStats(transactions = [], key, todayISO) {
  return dailySpendStatsForRange(transactions, periodRange('monthly', `${key}-01`), todayISO);
}

/**
 * Trailing average over `window` points.
 * At the start of the series the window is incomplete; we average over the
 * points that exist rather than emitting null, so the line starts at the
 * first data point instead of floating in from nowhere.
 */
export function rollingAverage(series = [], window = 30) {
  const out = [];
  let sum = 0;
  for (let i = 0; i < series.length; i += 1) {
    sum += series[i];
    if (i >= window) sum -= series[i - window];
    const n = Math.min(i + 1, window);
    out.push(Math.round(sum / n));
  }
  return out;
}

/* ----------------------------------------------------------- period series */

/** Expense/income/net totals for each of an ordered list of ranges. */
export function periodTotalsSeries(transactions = [], periods = []) {
  return periods.map((range) => periodTotals(transactions, range));
}

/**
 * The last `count` periods ending with the one containing `anchorDate`,
 * oldest first. This is the generalisation of monthOverMonth: the chart asks
 * for a view mode and gets a range per bar, whatever that mode is.
 */
export function periodSeries(
  transactions = [], viewMode = 'monthly', anchorDate, count = 6, weekStartsOn = 1,
) {
  return periodTotalsSeries(
    transactions, periodsEndingAt(viewMode, anchorDate, count, weekStartsOn),
  );
}

/**
 * This period against the one before it. Expense is the headline figure — it
 * is what "you spent more this month" means — with income and net alongside.
 */
export function periodComparison(
  transactions = [], viewMode = 'monthly', anchorDate, weekStartsOn = 1,
) {
  const [previous, current] = periodTotalsSeries(
    transactions, periodsEndingAt(viewMode, anchorDate, 2, weekStartsOn),
  );
  const deltaPaise = current.expensePaise - previous.expensePaise;
  return {
    current,
    previous,
    deltaPaise,
    // No previous spend means no meaningful percentage — say so, don't print Infinity.
    deltaPercent: previous.expensePaise ? (deltaPaise / previous.expensePaise) * 100 : null,
    direction: deltaPaise > 0 ? 'up' : deltaPaise < 0 ? 'down' : 'flat',
  };
}

/** Expense totals for the last `count` months ending at `key`, oldest first. */
export function monthOverMonth(transactions = [], key, count = 6) {
  const keys = [];
  for (let i = count - 1; i >= 0; i -= 1) keys.push(addMonths(key, -i));
  const map = new Map(keys.map((k) => [k, 0]));
  for (const t of expensesOf(transactions)) {
    const k = monthKey(t.date);
    if (map.has(k)) map.set(k, map.get(k) + t.amountPaise);
  }
  return keys.map((k) => ({ monthKey: k, totalPaise: map.get(k) }));
}

/** Month expense total plus the delta against the previous month. */
export function monthDelta(transactions = [], key) {
  const current = expenseTotalPaise(inMonth(transactions, key));
  const previousKey = addMonths(key, -1);
  const previous = expenseTotalPaise(inMonth(transactions, previousKey));
  const deltaPaise = current - previous;
  return {
    monthKey: key,
    previousKey,
    totalPaise: current,
    previousPaise: previous,
    deltaPaise,
    deltaPercent: previous ? (deltaPaise / previous) * 100 : null,
    direction: deltaPaise > 0 ? 'up' : deltaPaise < 0 ? 'down' : 'flat',
  };
}

/** Weekend (Sat/Sun) vs weekday average daily spend. */
export function weekendSkew(transactions = [], key) {
  const days = dailyTotals(inMonth(transactions, key), key);
  const weekend = [];
  const weekday = [];
  for (const d of days) {
    const dow = dayOfWeek(d.date);
    (dow === 0 || dow === 6 ? weekend : weekday).push(d.totalPaise);
  }
  const weekendMean = mean(weekend);
  const weekdayMean = mean(weekday);
  return {
    weekendMeanPaise: weekendMean,
    weekdayMeanPaise: weekdayMean,
    ratio: weekdayMean ? weekendMean / weekdayMean : null,
  };
}

/* --------------------------------------------------------------- carry-over */

/**
 * Roll each period's surplus into the next period's opening figure.
 *
 * Surplus is income minus expense, so a transfer can never enter the chain —
 * it is not in either term. A period with no data has a net of zero and passes
 * its opening through unchanged rather than breaking the chain.
 *
 * **The first period opens at `openingPaise`, which defaults to 0.** There is
 * no earlier period to inherit from, and inventing one would be inventing
 * history; a caller who does know the true starting figure passes it in.
 *
 * With `enabled: false` every period opens at zero and stands alone, which is
 * what the carry-over toggle being off means.
 *
 * @param {{incomePaise:number, expensePaise:number}[]} periods ordered, oldest first
 */
export function carryOver(periods = [], { openingPaise = 0, enabled = true } = {}) {
  let running = enabled ? openingPaise : 0;
  return periods.map((p) => {
    const income = p.incomePaise ?? 0;
    const expense = p.expensePaise ?? 0;
    const net = income - expense;
    const opening = enabled ? running : 0;
    const closing = opening + net;
    running = closing;
    return {
      ...p,
      incomePaise: income,
      expensePaise: expense,
      openingPaise: opening,
      netPaise: net,
      closingPaise: closing,
    };
  });
}

/** Carry-over straight from a ledger and an ordered list of ranges. */
export function carryOverSeries(transactions = [], periods = [], options = {}) {
  return carryOver(periodTotalsSeries(transactions, periods), options);
}

/* ------------------------------------------------------------ budget pace */

/**
 * Projected end-of-period spend = spend / daysElapsed * daysInPeriod.
 * Zero days elapsed returns null rather than dividing by zero.
 */
export function projectMonthEnd(spentPaise, elapsed, totalDays) {
  if (!elapsed || elapsed <= 0) return null;
  return Math.round((spentPaise / elapsed) * totalDays);
}

export const projectPeriodEnd = projectMonthEnd;

/**
 * Budget pace for one category (or the period as a whole).
 *
 *   expectedSpend = budget × (daysElapsed / daysInPeriod)
 *
 * `daysElapsed` counts today as elapsed. For a finished period pace is
 * meaningless, so the status is the result rather than a prediction.
 * 'on-track' is a band, not a knife edge: within 2% of the budget either way.
 */
export function paceForRange({ budgetPaise, spentPaise, range, today }) {
  const total = periodLength(range);
  const elapsed = daysElapsedIn(range, today);
  const isPast = Boolean(range) && compare(today, range.end) > 0;
  const isFuture = Boolean(range) && compare(today, range.start) < 0;
  const projectedPaise = projectMonthEnd(spentPaise, elapsed, total);

  const base = {
    budgetPaise: budgetPaise ?? null,
    spentPaise,
    daysElapsed: elapsed,
    daysInPeriod: total,
    isPast,
    isFuture,
    projectedPaise,
    expectedPaise: null,
    deltaPaise: 0,
    remainingPaise: null,
    ratio: null,
    status: 'no-budget',
  };

  if (budgetPaise === null || budgetPaise === undefined) return base;

  const expectedPaise = total ? Math.round(budgetPaise * (elapsed / total)) : 0;
  const deltaPaise = spentPaise - expectedPaise;
  const tolerance = Math.round(budgetPaise * 0.02);

  let status;
  if (isPast) status = spentPaise > budgetPaise ? 'over' : 'under';
  else if (isFuture) status = 'upcoming';
  else if (Math.abs(deltaPaise) <= tolerance) status = 'on-track';
  else status = deltaPaise > 0 ? 'ahead' : 'behind';

  return {
    ...base,
    expectedPaise,
    deltaPaise,
    remainingPaise: budgetPaise - spentPaise,
    ratio: budgetPaise ? spentPaise / budgetPaise : null,
    status,
  };
}

/** The month-shaped call, in terms of the range-shaped one. */
export function pace({ budgetPaise, spentPaise, monthKey: key, today }) {
  const range = periodRange('monthly', `${key}-01`);
  const result = paceForRange({ budgetPaise, spentPaise, range, today });
  return { ...result, monthKey: key, daysInMonth: result.daysInPeriod };
}
/* ------------------------------------------------------- budgets by month */

/**
 * The budget a monthly plan implies for an arbitrary period.
 *
 * Budgets are set per month; periods are days, weeks, months, quarters,
 * halves and years. Rather than storing six parallel sets of budgets that
 * could disagree with one another, one monthly figure is prorated across
 * whatever the period actually covers: a week gets the share of its month it
 * occupies, a six-month view gets six months added together, and a whole
 * month gets exactly its own figure back with no arithmetic at all.
 *
 * **A category with no entry in any covered month returns null, not zero.**
 * Untracked and "planned to spend nothing" are different facts, and the two
 * sections of the Budgets tab are exactly that distinction. Collapsing them is
 * how a category silently moves into the budgeted list at a budget of ₹0 and
 * reads as an overrun on the first rupee.
 *
 * @param {Record<string, Record<string, number>>} budgets
 * @returns {number|null} integer paise, or null when nothing is budgeted
 */
export function budgetForRange(budgets = {}, categoryId, range) {
  const months = monthsInRange(range);
  if (months.length === 0) return null;

  let total = 0;
  let tracked = false;
  for (const key of months) {
    const paise = budgets?.[key]?.[categoryId];
    if (!Number.isFinite(paise)) continue;
    tracked = true;
    const covered = daysOfMonthInRange(key, range);
    const whole = daysInMonth(key);
    // A whole month contributes its whole figure, with no rounding step to
    // drift by a paise; only a partial month is prorated.
    total += covered >= whole ? paise : Math.round((paise * covered) / whole);
  }
  return tracked ? total : null;
}

/** Every category id budgeted in any month a range covers. */
export function budgetedCategoryIds(budgets = {}, range) {
  const out = new Set();
  for (const key of monthsInRange(range)) {
    for (const id of Object.keys(budgets?.[key] ?? {})) out.add(id);
  }
  return out;
}

/**
 * The band a progress bar is drawn in.
 *
 * Three states rather than a gradient, because the bar has to be readable at
 * a glance and the exact figures are printed beside it either way. 'near' is
 * the warning band at 85% of the money gone; 'over' is strictly more than the
 * budget, so spending exactly the budget is not an overrun.
 *
 * The band is never the only signal — every row states its figures, its pace
 * and its status in words.
 */
export function budgetState(spentPaise, budgetPaise) {
  if (budgetPaise === null || budgetPaise === undefined) return 'none';
  if (spentPaise > budgetPaise) return 'over';
  // A budget of zero that has not been spent against is met, not "near".
  if (budgetPaise === 0) return 'under';
  return spentPaise / budgetPaise >= 0.85 ? 'near' : 'under';
}

/**
 * Per-category budget report for a range, split into budgeted and not.
 *
 * Spend is expense-only: a refund filed as income in a same-named category
 * must not quietly pay down a budget, and a transfer must not consume one.
 *
 * The unbudgeted side is a list, not only a total. Money outside every budget
 * is the money most worth seeing, and reporting it as one lump is how it
 * becomes invisible.
 */
export function budgetReportForRange(
  transactions = [], categories = [], budgets = {}, range, today,
) {
  const scoped = inRange(transactions, range);
  const spentBy = new Map(expenseByCategory(scoped).map((r) => [r.categoryId, r.totalPaise]));

  // Budgets belong to spending. An income category has nothing to pace against.
  const budgetable = categories.filter((c) => (c.kind ?? 'expense') === 'expense');

  const rows = budgetable.map((cat) => {
    const budgetPaise = budgetForRange(budgets, cat.id, range);
    const spentPaise = spentBy.get(cat.id) ?? 0;
    return {
      categoryId: cat.id,
      name: cat.name,
      colorToken: cat.colorToken,
      icon: cat.icon,
      archived: cat.archived === true,
      budgetPaise,
      state: budgetState(spentPaise, budgetPaise),
      ...paceForRange({ budgetPaise, spentPaise, range, today }),
    };
  });

  // Closest to trouble first: the row about to go over is the one worth
  // reading, and an alphabetical list buries it.
  const budgeted = rows
    .filter((r) => r.budgetPaise !== null)
    .sort((a, b) => (b.ratio ?? 0) - (a.ratio ?? 0) || compare(a.name, b.name));

  // An archived category with no budget and no spend is not news. One that was
  // spent in still is, so it stays.
  const unbudgeted = rows
    .filter((r) => r.budgetPaise === null && !(r.archived && r.spentPaise === 0))
    .sort((a, b) => b.spentPaise - a.spentPaise || compare(a.name, b.name));

  const unbudgetedPaise = sumPaise(unbudgeted, (r) => r.spentPaise);
  const overallBudget = budgeted.length ? sumPaise(budgeted, (r) => r.budgetPaise) : null;
  const budgetedSpentPaise = sumPaise(budgeted, (r) => r.spentPaise);

  return {
    rows,
    budgeted,
    unbudgeted,
    unbudgetedPaise,
    budgetedSpentPaise,
    /**
     * The overall row compares budgeted spend against budgeted money — not
     * the whole period against a plan that only covers part of it, which would
     * guarantee an overrun and double-count what `unbudgetedPaise` already
     * reports. The two figures add up to the period's expense total.
     */
    overall: {
      state: budgetState(budgetedSpentPaise, overallBudget),
      ...paceForRange({
        budgetPaise: overallBudget,
        spentPaise: budgetedSpentPaise,
        range,
        today,
      }),
    },
    totalPaise: expenseTotalPaise(scoped),
  };
}

/** The month-shaped call, in terms of the range-shaped one. */
export function budgetReport(transactions = [], categories = [], budgets = {}, key, today) {
  const report = budgetReportForRange(
    transactions, categories, budgets, periodRange('monthly', `${key}-01`), today,
  );
  return { ...report, monthTotalPaise: report.totalPaise };
}

/* ------------------------------------------------------- the weight scale */

/**
 * Percentile of a sorted numeric array, linearly interpolated (the R-7 /
 * spreadsheet definition).
 */
export function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

const HALF = 0.5;

/**
 * The Heft weight scale.
 *
 * Linear scaling fails: rent is 400x a chai, so on a linear ramp everything
 * that is not rent collapses to the same invisible weight. Instead we map the
 * *logarithm* of each amount onto [0,1] between the 5th and 95th percentile of
 * the currently visible set, and clamp. Percentile bounds mean a single
 * outlier cannot crush the rest of the list, and clamping means the outlier
 * still reads as the heaviest thing on screen.
 *
 * Because the bounds come from the visible set, the topography re-normalises
 * on every filter change — filter to one category and small differences inside
 * it become legible instead of flattening.
 *
 * Degenerate cases (empty, one expense, all-identical amounts) resolve to 0.5:
 * a middle weight, never a division by zero.
 *
 * @param {number[]} amounts positive integer paise
 * @returns {{p5:number, p95:number, degenerate:boolean, t:(n:number)=>number}}
 */
export function weightScale(amounts = []) {
  const positive = amounts.filter((n) => Number.isFinite(n) && n > 0).sort((a, b) => a - b);

  if (positive.length < 2) {
    return { p5: positive[0] ?? 0, p95: positive[0] ?? 0, degenerate: true, t: () => HALF };
  }

  const p5 = percentile(positive, 0.05);
  const p95 = percentile(positive, 0.95);
  const lo = Math.log(p5);
  const hi = Math.log(p95);

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo === 0) {
    return { p5, p95, degenerate: true, t: () => HALF };
  }

  const span = hi - lo;
  return {
    p5,
    p95,
    degenerate: false,
    t(amount) {
      if (!Number.isFinite(amount) || amount <= 0) return 0;
      const raw = (Math.log(amount) - lo) / span;
      return Math.min(1, Math.max(0, raw));
    },
  };
}

/**
 * The scale for a ledger, built from expense magnitudes only.
 *
 * One ₹50,000 salary in the visible set would move p95 and flatten every
 * expense row towards invisible — the exact failure the percentile-log scale
 * exists to prevent. Income gets its own independent scale, and a transfer is
 * not a weight at all: it is money you still have, so it sits at the neutral
 * middle and never competes with spending for ink.
 */
export function ledgerWeightScale(transactions = []) {
  const expense = weightScale(expensesOf(transactions).map((t) => t.amountPaise));
  const income = weightScale(incomeOf(transactions).map((t) => t.amountPaise));
  return {
    expense,
    income,
    /** The one number per row that CSS interpolates everything else from. */
    t(transaction) {
      if (isIncome(transaction)) return income.t(transaction.amountPaise);
      if (isExpense(transaction)) return expense.t(transaction.amountPaise);
      return HALF;
    },
  };
}

/** Round a value up to the nearest 1/2/5 x 10^n. */
function niceNumber(range, round) {
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / 10 ** exponent;
  let nice;
  if (round) {
    if (fraction < 1.5) nice = 1;
    else if (fraction < 3) nice = 2;
    else if (fraction < 7) nice = 5;
    else nice = 10;
  } else if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exponent;
}

/**
 * Axis ticks by the "nice numbers" algorithm — round the range to a 1/2/5x10^n
 * step so labels read as 0 / 1,000 / 2,000, not as max/5 = 3,847.
 */
export function niceTicks(maxValue, targetCount = 5) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) return { step: 1, max: 1, ticks: [0, 1] };
  const step = niceNumber(niceNumber(maxValue, false) / Math.max(1, targetCount), true);
  const max = Math.ceil(maxValue / step) * step;
  const ticks = [];
  for (let v = 0; v <= max + step / 2; v += step) ticks.push(Math.round(v));
  return { step, max, ticks };
}
