/**
 * suite.js — every assertion in the project.
 *
 * Exported as one function taking an assertion helper so the same suite runs
 * in tests.html (rendered as a pass/fail list) and headlessly in Node. No
 * mocking anywhere: every function under test is pure and takes its inputs
 * explicitly, including "today".
 */

import {
  toPaise, formatINR, formatAmount, toRupeeString, sumPaise,
} from '../lib/money.js';
import {
  addDays, addMonths, compare, datesInMonth, dayOfWeek, daysInMonth,
  daysInMonthOf, diffDays, endOfMonth, formatRelativeDay, isLeapYear, isValid,
  monthKey, periodRange, periodsEndingAt, startOfMonth, stepAnchor, today,
} from '../lib/dates.js';
import { parseQuickAdd, tokenize } from '../lib/parse.js';
import {
  accountBalance, accountBalances, budgetReport, budgetReportForRange, byCategory,
  carryOver, carryOverSeries, dailySpendStats, dailyTotals, dailyTotalsBetween,
  expenseByCategory, expenseTotalPaise, groupByDay, incomeByCategory,
  incomeTotalPaise, ledgerWeightScale, mean, median, monthDelta, monthOverMonth,
  netPaise, netWorth, netWorthPaise, niceTicks, pace, percentile, periodComparison,
  periodTotals, projectMonthEnd, rollingAverage, topExpenses, totalPaise,
  weightScale,
} from '../lib/analytics.js';
import {
  donutRingPath, donutSegments, linePath, polarToCartesian,
} from '../lib/geometry.js';
import {
  CURRENT_SCHEMA_VERSION, SEED_ACCOUNTS, SEED_CATEGORIES, SEED_INCOME_CATEGORIES,
  canDeleteAccount, canDeleteCategory, countTransactionsFor, countTransactionsIn,
  defaultState, dropTransactionsFor, dropTransactionsIn, loadState, makeAccountId,
  makeCategoryId, makeValidationContext, migrate, migrateV1toV2, normalise,
  parseState, reassignAccount, reassignCategory, saveState, validateAccount,
  validateTransaction,
} from '../lib/storage.js';
import {
  EXPORT_FORMAT, buildExport, clearedState, exportFilename, mergeStates,
  readImport, replaceWith, summariseImport,
} from '../lib/backup.js';
import {
  DEFAULT_FILTERS, applyFilters, describeFilters, filtersToHash,
  hasNarrowingFilters, parseFilterHash,
} from '../lib/filters.js';
import { generateSampleTransactions, mulberry32 } from '../lib/sample-data.js';
import { createStore } from '../store.js';

/* ------------------------------------------------------------- fixtures */

const CATEGORIES = SEED_CATEGORIES.map((c) => ({ ...c }));
const ALL_CATEGORIES = [...CATEGORIES, ...SEED_INCOME_CATEGORIES.map((c) => ({ ...c }))];
const ACCOUNTS = SEED_ACCOUNTS.map((a) => ({ ...a }));
const TODAY = '2025-08-13';
const CTX = { categories: CATEGORIES, today: TODAY, defaultCategoryId: 'other' };

/** The context validateTransaction needs, built from the seed data. */
const VCTX = makeValidationContext({
  categories: ALL_CATEGORIES, accounts: ACCOUNTS, settings: { defaultAccountId: 'cash' },
});

let seq = 0;
const stamp = () => {
  seq += 1;
  return `2025-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`;
};

/** A v2 expense: positive amount, direction 'expense', out of an account. */
function expense(date, rupees, categoryId = 'other', extra = {}) {
  const createdAt = stamp();
  return {
    id: `e${seq}`,
    kind: 'transaction',
    direction: 'expense',
    amountPaise: Math.round(rupees * 100),
    date,
    accountId: 'cash',
    toAccountId: null,
    categoryId,
    note: '',
    createdAt,
    ...extra,
  };
}

/** A v2 income record. Positive amount, same as an expense — only direction differs. */
function income(date, rupees, categoryId = 'salary', extra = {}) {
  const createdAt = stamp();
  return {
    id: `i${seq}`,
    kind: 'transaction',
    direction: 'income',
    amountPaise: Math.round(rupees * 100),
    date,
    accountId: 'bank',
    toAccountId: null,
    categoryId,
    note: '',
    createdAt,
    ...extra,
  };
}

/** A transfer: one record, two accounts, no direction and no category. */
function transfer(date, rupees, from = 'bank', to = 'cash', extra = {}) {
  const createdAt = stamp();
  return {
    id: `x${seq}`,
    kind: 'transfer',
    direction: null,
    amountPaise: Math.round(rupees * 100),
    date,
    accountId: from,
    toAccountId: to,
    categoryId: null,
    note: '',
    createdAt,
    ...extra,
  };
}

const account = (id, name, type, openingRupees = 0) => ({
  id,
  name,
  type,
  openingBalancePaise: Math.round(openingRupees * 100),
  colorToken: 'acct-1',
  icon: 'wallet',
  archived: false,
});

function fakeStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, v),
    removeItem: (k) => map.delete(k),
  };
}

/* ---------------------------------------------------------------- suite */

export default function suite(t) {
  /* =========================================================== money === */
  t.group('Money — parsing');

  t.eq(toPaise('1200'), 120000, "toPaise('1200')");
  t.eq(toPaise('1,200'), 120000, "toPaise('1,200') strips grouping");
  t.eq(toPaise('1200.50'), 120050, "toPaise('1200.50')");
  t.eq(toPaise('₹1200'), 120000, "toPaise('₹1200') strips the symbol");
  t.eq(toPaise('Rs. 1,50,000'), 15000000, "toPaise('Rs. 1,50,000')");
  t.eq(toPaise('1200.5'), 120050, "toPaise('1200.5') pads one decimal");
  t.eq(toPaise('1200.505'), 120051, 'toPaise rounds the third decimal up');
  t.eq(toPaise('1200.504'), 120050, 'toPaise rounds the third decimal down');
  t.eq(toPaise('0'), 0, "toPaise('0') is zero, not null");
  t.eq(toPaise('  42  '), 4200, 'toPaise trims whitespace');
  t.eq(toPaise(''), null, "toPaise('') is null");
  t.eq(toPaise('   '), null, 'toPaise(whitespace) is null');
  t.eq(toPaise('abc'), null, "toPaise('abc') is null");
  t.eq(toPaise('-50'), null, "toPaise('-50') rejects negatives");
  t.eq(toPaise('1.2.3'), null, 'toPaise rejects two decimal points');
  t.eq(toPaise(null), null, 'toPaise(null) is null');
  t.eq(toPaise(undefined), null, 'toPaise(undefined) is null');

  t.group('Money — integer arithmetic');

  {
    // The test that proves the float bug is gone. Ground truth is BigInt.
    const rand = mulberry32(20250813);
    const strings = [];
    let truth = 0n;
    for (let i = 0; i < 1000; i += 1) {
      const rupees = Math.floor(rand() * 200000);
      const paisePart = Math.floor(rand() * 100);
      strings.push(`${rupees}.${String(paisePart).padStart(2, '0')}`);
      truth += BigInt(rupees) * 100n + BigInt(paisePart);
    }
    const parsed = strings.map(toPaise);
    t.ok(parsed.every(Number.isSafeInteger), 'all 1,000 parsed amounts are safe integers');
    t.eq(BigInt(sumPaise(parsed)), truth, 'sum of 1,000 amounts is exact to the paise');

    // And the drift the integer path avoids: ten ten-paise coins, in floats.
    let float = 0;
    for (let i = 0; i < 10; i += 1) float += 0.1;
    t.ok(float !== 1, `naive float accumulation drifts (0.1 x 10 = ${float})`);
    t.eq(sumPaise(new Array(10).fill(10)), 100, 'the same sum in paise is exact');
  }

  t.eq(toPaise('0.1') + toPaise('0.2'), toPaise('0.3'), '0.1 + 0.2 === 0.3 in paise');
  t.eq(sumPaise([]), 0, 'sumPaise of an empty list is 0');
  t.eq(
    sumPaise([{ amountPaise: 100 }, { amountPaise: 250 }], (e) => e.amountPaise),
    350,
    'sumPaise takes a picker',
  );

  t.group('Money — formatting');

  t.eq(formatINR(15000000), '₹1,50,000', 'formatINR groups lakhs');
  t.eq(formatINR(1000000000), '₹1,00,00,000', 'formatINR groups crores');
  t.eq(formatINR(25000), '₹250', 'formatINR drops paise by default');
  t.eq(formatINR(0), '₹0', 'formatINR of zero');
  t.eq(formatINR(120050, { paise: true }), '₹1,200.50', 'formatINR can show paise');
  t.eq(formatAmount(15000000), '1,50,000', 'formatAmount omits the symbol');
  t.eq(toRupeeString(120050), '1200.50', 'toRupeeString round-trips into a form field');
  t.eq(toRupeeString(120000), '1200', 'toRupeeString drops a zero fraction');

  for (const x of [0, 25000, 15000000, 1000000000, 99900]) {
    t.eq(toPaise(formatINR(x)), x, `round trip: toPaise(formatINR(${x})) === ${x}`);
  }

  /* =========================================================== dates === */
  t.group('Dates — arithmetic across boundaries');

  t.eq(addDays('2025-01-31', 1), '2025-02-01', 'add a day to 31 January');
  t.eq(addDays('2025-02-28', 1), '2025-03-01', 'add a day to 28 February 2025');
  t.eq(addDays('2024-02-28', 1), '2024-02-29', 'add a day to 28 February 2024');
  t.eq(addDays('2024-02-29', 1), '2024-03-01', 'add a day to the leap day');
  t.eq(addDays('2025-12-31', 1), '2026-01-01', 'add a day across the year');
  t.eq(addDays('2025-01-01', -1), '2024-12-31', 'subtract a day across the year');
  t.eq(addDays('2025-03-30', 1), '2025-03-31', 'add a day across a DST shift');
  t.eq(addDays('2025-08-13', 0), '2025-08-13', 'adding zero days is identity');
  t.eq(addDays('not-a-date', 1), null, 'addDays on rubbish returns null');
  t.eq(diffDays('2025-01-01', '2025-12-31'), 364, 'diffDays across a year');
  t.eq(diffDays('2025-03-01', '2025-02-01'), -28, 'diffDays can be negative');

  t.group('Dates — leap years');

  t.eq(daysInMonthOf(2024, 2), 29, 'February 2024 has 29 days');
  t.eq(daysInMonthOf(2025, 2), 28, 'February 2025 has 28 days');
  t.eq(daysInMonthOf(2000, 2), 29, 'February 2000 has 29 days (400-year rule)');
  t.eq(daysInMonthOf(1900, 2), 28, 'February 1900 has 28 days (100-year rule)');
  t.ok(isLeapYear(2000) && !isLeapYear(1900) && isLeapYear(2024), 'isLeapYear');
  t.eq(isValid('2025-02-29'), false, '29 February 2025 is not a real date');
  t.eq(isValid('2024-02-29'), true, '29 February 2024 is a real date');
  t.eq(isValid('2025-13-01'), false, 'month 13 is rejected');
  t.eq(isValid('2025-00-10'), false, 'month 0 is rejected');
  t.eq(isValid('20250101'), false, 'unseparated digits are rejected');

  t.group('Dates — month helpers');

  t.eq(startOfMonth('2025-12-25'), '2025-12-01', 'startOfMonth for December');
  t.eq(startOfMonth('2025-01-31'), '2025-01-01', 'startOfMonth for January');
  t.eq(endOfMonth('2025-12-25'), '2025-12-31', 'endOfMonth for December');
  t.eq(endOfMonth('2024-02-05'), '2024-02-29', 'endOfMonth for a leap February');
  t.eq(daysInMonth('2025-12-25'), 31, 'daysInMonth for December');
  t.eq(daysInMonth('2025-01-01'), 31, 'daysInMonth for January');
  t.eq(monthKey('2025-08-13'), '2025-08', 'monthKey');
  t.eq(addMonths('2025-01', -1), '2024-12', 'addMonths back across the year');
  t.eq(addMonths('2025-12', 1), '2026-01', 'addMonths forward across the year');
  t.eq(addMonths('2025-08', -13), '2024-07', 'addMonths more than a year back');
  t.eq(datesInMonth('2024-02').length, 29, 'datesInMonth for a leap February');
  t.eq(datesInMonth('2025-02')[0], '2025-02-01', 'datesInMonth starts on the 1st');
  t.eq(dayOfWeek('2025-08-13'), 3, '13 August 2025 is a Wednesday');

  t.group('Dates — ordering');

  {
    const shuffled = ['2025-10-01', '2024-12-31', '2025-01-05', '2025-01-15', '2025-02-01'];
    const lexical = shuffled.slice().sort();
    const chronological = shuffled.slice().sort(
      (a, b) => Date.UTC(...a.split('-').map(Number)) - Date.UTC(...b.split('-').map(Number)),
    );
    t.deepEq(lexical, chronological, 'lexical sort of ISO strings equals chronological sort');
    t.eq(compare('2025-01-01', '2025-01-02'), -1, 'compare is negative when earlier');
    t.eq(compare('2025-01-02', '2025-01-01'), 1, 'compare is positive when later');
    t.eq(compare('2025-01-01', '2025-01-01'), 0, 'compare is zero when equal');
  }

  t.ok(isValid(today()), 'today() returns a valid date string');
  t.eq(formatRelativeDay('2025-08-13', TODAY), 'Today', 'formatRelativeDay: today');
  t.eq(formatRelativeDay('2025-08-12', TODAY), 'Yesterday', 'formatRelativeDay: yesterday');
  t.eq(formatRelativeDay('2025-08-01', TODAY), '1 August', 'formatRelativeDay: this year');
  t.eq(formatRelativeDay('2024-08-01', TODAY), '1 August 2024', 'formatRelativeDay: past year');

  /* ========================================================== parser === */
  t.group('Parser — amount position and suffixes');

  {
    const a = parseQuickAdd('250 chai', CTX);
    t.eq(a.amountPaise, 25000, "'250 chai' -> ₹250");
    t.eq(a.note, 'chai', "'250 chai' -> note 'chai'");
    t.eq(a.categoryId, 'food', "'250 chai' -> Food via synonym");

    const b = parseQuickAdd('chai 250', CTX);
    t.eq(b.amountPaise, 25000, "'chai 250' -> ₹250 (amount position is free)");
    t.eq(b.note, 'chai', "'chai 250' -> note 'chai'");

    t.eq(parseQuickAdd('1.2k rent', CTX).amountPaise, 120000, "'1.2k rent' -> ₹1,200");
    t.eq(parseQuickAdd('1.5l rent', CTX).amountPaise, 15000000, "'1.5l rent' -> ₹1,50,000");
    t.eq(parseQuickAdd('2k books', CTX).amountPaise, 200000, "'2k books' -> ₹2,000");
    t.eq(parseQuickAdd('3 lakh car', CTX).amountPaise, 30000000, "'3 lakh car' -> ₹3,00,000");
    t.eq(parseQuickAdd('₹1,200 dinner', CTX).amountPaise, 120000, "'₹1,200 dinner'");
    t.eq(parseQuickAdd('249.50 coffee', CTX).amountPaise, 24950, "'249.50 coffee' keeps paise");
  }

  t.group('Parser — dates');

  {
    const a = parseQuickAdd('swiggy 480 yesterday', CTX);
    t.eq(a.amountPaise, 48000, "'swiggy 480 yesterday' -> ₹480");
    t.eq(a.date, '2025-08-12', "'swiggy 480 yesterday' -> yesterday's date");
    t.eq(a.categoryId, 'food', "'swiggy 480 yesterday' -> Food");
    t.eq(a.note, 'swiggy', "'swiggy 480 yesterday' -> note 'swiggy', date stripped");

    t.eq(parseQuickAdd('120 auto today', CTX).date, TODAY, "'today' resolves to today");
    t.eq(parseQuickAdd('120 auto', CTX).date, TODAY, 'no date keyword defaults to today');

    const jan = parseQuickAdd('petrol 2400 23 jan', CTX);
    t.eq(jan.date, '2025-01-23', "'23 jan' -> 23 January this year");
    t.eq(jan.note, 'petrol', "'23 jan' is stripped from the note");
    t.eq(parseQuickAdd('900 jan 23', CTX).date, '2025-01-23', "'jan 23' also parses");
    t.eq(parseQuickAdd('900 23 january', CTX).date, '2025-01-23', 'full month name parses');
    t.eq(parseQuickAdd('900 23 dec', CTX).date, '2024-12-23', 'a future month rolls back a year');
    t.eq(parseQuickAdd('900 2/3', CTX).date, '2025-03-02', "'2/3' is day/month");
    t.eq(parseQuickAdd('900 23/1/2024', CTX).date, '2024-01-23', 'an explicit year is honoured');
    t.eq(parseQuickAdd('900 2025-07-04', CTX).date, '2025-07-04', 'an ISO date parses');
    t.eq(parseQuickAdd('900 31/2', CTX).date, TODAY, '31 February is rejected, not invented');
    t.eq(parseQuickAdd('500 23 jan', CTX).amountPaise, 50000, 'the day number is not the amount');
  }

  t.group('Parser — categories');

  {
    const exact = parseQuickAdd('480 food', CTX);
    t.eq(exact.categoryId, 'food', "'480 food' matches the category name");
    t.eq(exact.matchedBy, 'name', "'480 food' matched by name");
    t.eq(exact.note, '', "'480 food' leaves no note — the name is consumed");

    const fell = parseQuickAdd('480 fooding', CTX);
    t.eq(fell.categoryId, 'other', "'480 fooding' falls through to the default");
    t.eq(fell.matchedBy, 'default', "'480 fooding' matched nothing");
    t.eq(fell.note, 'fooding', "'480 fooding' keeps the word as the note");

    t.eq(parseQuickAdd('600 groceries', CTX).categoryId, 'groceries', 'single-word name');
    t.eq(parseQuickAdd('600 Rent & Bills', CTX).categoryId, 'rent', 'multi-word name');
    t.eq(parseQuickAdd('600 RENT', CTX).categoryId, 'rent', 'names match case-insensitively');
    t.eq(parseQuickAdd('600 dining', CTX).categoryId, 'food', 'a word of a name matches');

    t.eq(parseQuickAdd('90 uber', CTX).categoryId, 'transport', 'synonym: uber -> Transport');
    t.eq(parseQuickAdd('90 ola', CTX).categoryId, 'transport', 'synonym: ola -> Transport');
    t.eq(parseQuickAdd('2000 petrol', CTX).categoryId, 'transport', 'synonym: petrol -> Transport');
    t.eq(parseQuickAdd('1500 dmart', CTX).categoryId, 'groceries', 'synonym: dmart -> Groceries');
    t.eq(parseQuickAdd('800 bigbasket', CTX).categoryId, 'groceries', 'synonym: bigbasket');
    t.eq(parseQuickAdd('90 uber', CTX).note, 'uber', 'a synonym stays in the note');

    const both = parseQuickAdd('300 swiggy shopping', CTX);
    t.eq(both.categoryId, 'shopping', 'an explicit name beats a synonym');
    t.eq(both.matchedBy, 'name', 'precedence recorded as name');
    t.eq(both.note, 'swiggy', 'the beaten synonym survives as the note');
  }

  t.group('Parser — failure and edge cases');

  {
    const none = parseQuickAdd('lunch with amit', CTX);
    t.eq(none.ok, false, 'no amount -> not ok');
    t.eq(none.error, 'no-amount', 'no amount -> explicit error code');
    t.ok(typeof none.message === 'string' && none.message.length > 0, 'no amount -> a message');
    t.eq(none.amountPaise, null, 'no amount -> null, not NaN');
    t.eq(none.categoryId, 'food', 'a failed parse still reports its best guess');

    const empty = parseQuickAdd('', CTX);
    t.eq(empty.error, 'empty', 'empty string -> empty error');
    t.eq(parseQuickAdd('   ', CTX).error, 'empty', 'whitespace only -> empty error');
    t.eq(parseQuickAdd(null, CTX).error, 'empty', 'null input does not throw');

    const bare = parseQuickAdd('250', CTX);
    t.eq(bare.ok, true, 'amount only -> ok');
    t.eq(bare.note, '', 'amount only -> empty note');
    t.eq(bare.categoryId, 'other', 'amount only -> default category');

    const many = parseQuickAdd('100 200 chai', CTX);
    t.eq(many.amountPaise, 10000, 'multiple plain numbers: leftmost wins');
    t.eq(many.note, '200 chai', 'the losing number stays in the note');
    t.eq(many.warnings.length, 1, 'multiple numbers raises a warning');

    t.eq(parseQuickAdd('chai 100 ₹250', CTX).amountPaise, 25000, 'a currency mark wins');
    t.eq(parseQuickAdd('100 1.2k rent', CTX).amountPaise, 120000, 'a k suffix beats a plain number');
    t.eq(parseQuickAdd('100 1,250 dinner', CTX).amountPaise, 125000, 'grouping beats a plain number');
    t.eq(parseQuickAdd('0 chai', CTX).error, 'zero-amount', 'zero is rejected explicitly');
    t.eq(tokenize('  a  b ').length, 2, 'tokenize collapses whitespace');
  }

  /* ======================================================= analytics === */
  t.group('Analytics — totals');

  {
    const list = [
      expense('2025-08-01', 1000, 'food'),
      expense('2025-08-01', 500, 'transport'),
      expense('2025-08-05', 2500, 'food'),
      expense('2025-07-20', 700, 'food'),
    ];
    const august = list.filter((e) => e.date.startsWith('2025-08'));

    t.eq(totalPaise(august), 400000, 'month total');
    t.eq(
      sumPaise(byCategory(august), (r) => r.totalPaise),
      totalPaise(august),
      'category totals sum to the overall total',
    );
    t.eq(byCategory(august)[0].categoryId, 'food', 'categories sort largest first');
    t.eq(byCategory(august)[0].share, 0.875, 'share is a fraction of the total');
    t.eq(byCategory([]).length, 0, 'byCategory of nothing is an empty list');

    t.eq(dailyTotals(august, '2025-08').length, 31, 'dailyTotals covers every day');
    t.eq(dailyTotals(august, '2025-08')[0].totalPaise, 150000, 'dailyTotals sums a day');
    t.eq(dailyTotals(august, '2025-08')[1].totalPaise, 0, 'a day with no spend is zero');

    const groups = groupByDay(august);
    t.eq(groups.length, 2, 'groupByDay makes one group per day');
    t.eq(groups[0].date, '2025-08-05', 'groupByDay is newest first');
    t.eq(groups[0].totalPaise, 250000, 'each group carries its own total');

    t.eq(topExpenses(list, 2).length, 2, 'topExpenses respects the limit');
    t.eq(topExpenses(list, 2)[0].amountPaise, 250000, 'topExpenses is largest first');
  }

  t.group('Analytics — the empty set never produces NaN');

  {
    const stats = dailySpendStats([], '2025-08', TODAY);
    t.eq(totalPaise([]), 0, 'total of nothing is 0');
    t.eq(stats.meanPaise, 0, 'mean of nothing is 0');
    t.eq(stats.medianPaise, 0, 'median of nothing is 0');
    t.eq(monthDelta([], '2025-08').deltaPercent, null, 'no previous month -> null, not Infinity');
    t.eq(monthDelta([], '2025-08').direction, 'flat', 'no change -> flat');

    const values = [
      totalPaise([]), mean([]), median([]), stats.meanPaise, stats.medianPaise,
      ...monthOverMonth([], '2025-08').map((m) => m.totalPaise),
      ...dailyTotals([], '2025-08').map((d) => d.totalPaise),
    ];
    t.ok(values.every(Number.isFinite), 'every empty-set result is a finite number');
  }

  t.group('Analytics — mean and median');

  t.eq(median([10]), 10, 'median of one element');
  t.eq(median([10, 20, 30]), 20, 'median of an odd count');
  t.eq(median([10, 20, 30, 40]), 25, 'median of an even count averages the middle pair');
  t.eq(median([30, 10, 20]), 20, 'median sorts first');
  t.eq(mean([10, 20, 31]), 20, 'mean rounds to an integer paise value');

  {
    // One rent payment plus twelve small days: mean is misleading, median is not.
    const list = [expense('2025-08-01', 30000, 'rent')];
    for (let d = 2; d <= 13; d += 1) {
      list.push(expense(`2025-08-${String(d).padStart(2, '0')}`, 200, 'food'));
    }
    const stats = dailySpendStats(list, '2025-08', TODAY);
    t.eq(stats.days, 13, 'daysElapsed counts today as elapsed');
    t.eq(stats.medianPaise, 20000, 'median daily spend is an ordinary day');
    t.ok(stats.meanPaise > stats.medianPaise * 5, 'mean is dragged up by rent');
  }

  t.group('Analytics — rolling average');

  t.deepEq(rollingAverage([10, 20, 30], 30), [10, 15, 20], 'incomplete window averages what exists');
  t.deepEq(rollingAverage([10, 20, 30, 40], 2), [10, 15, 25, 35], 'window slides');
  t.deepEq(rollingAverage([], 30), [], 'rolling average of nothing is nothing');
  t.eq(rollingAverage([5], 30)[0], 5, 'a single point is its own average');

  t.group('Analytics — month over month');

  {
    const list = [
      expense('2025-08-01', 100, 'food'),
      expense('2025-07-01', 50, 'food'),
      expense('2025-03-01', 999, 'food'),
    ];
    const series = monthOverMonth(list, '2025-08', 6);
    t.eq(series.length, 6, 'six months of history');
    t.eq(series[5].monthKey, '2025-08', 'the last bucket is the selected month');
    t.eq(series[0].monthKey, '2025-03', 'the first bucket is five months earlier');
    t.eq(series[5].totalPaise, 10000, 'the current month total');

    const delta = monthDelta(list, '2025-08');
    t.eq(delta.deltaPaise, 5000, 'delta against the previous month');
    t.eq(delta.deltaPercent, 100, 'delta as a percentage');
    t.eq(delta.direction, 'up', 'direction is up');
  }

  t.group('Analytics — budget pace');

  {
    const budget = 3100000; // ₹31,000 across a 31-day August

    const dayOne = pace({ budgetPaise: budget, spentPaise: 0, monthKey: '2025-08', today: '2025-08-01' });
    t.eq(dayOne.daysElapsed, 1, 'day 1 counts as one elapsed day');
    t.eq(dayOne.expectedPaise, 100000, 'day 1 expects one day of budget');
    t.eq(dayOne.status, 'behind', 'nothing spent on day 1 is behind pace');

    const lastDay = pace({ budgetPaise: budget, spentPaise: budget, monthKey: '2025-08', today: '2025-08-31' });
    t.eq(lastDay.daysElapsed, 31, 'the last day counts every day');
    t.eq(lastDay.expectedPaise, budget, 'the last day expects the whole budget');
    t.eq(lastDay.status, 'on-track', 'spending exactly the budget is on track');
    t.eq(lastDay.projectedPaise, budget, 'the projection lands on the budget');

    const past = pace({ budgetPaise: budget, spentPaise: budget + 1, monthKey: '2025-07', today: TODAY });
    t.eq(past.isPast, true, 'a past month is flagged as past');
    t.eq(past.status, 'over', 'pace is meaningless for a past month: report the result');
    t.eq(past.daysElapsed, 31, 'a past month is fully elapsed');

    const ahead = pace({ budgetPaise: budget, spentPaise: 2000000, monthKey: '2025-08', today: TODAY });
    t.eq(ahead.expectedPaise, 1300000, 'expected = budget x elapsed / days');
    t.eq(ahead.deltaPaise, 700000, 'delta is spend minus expected');
    t.eq(ahead.status, 'ahead', 'spending faster than pace is "ahead"');

    const future = pace({ budgetPaise: budget, spentPaise: 0, monthKey: '2025-09', today: TODAY });
    t.eq(future.daysElapsed, 0, 'a future month has no elapsed days');
    t.eq(future.status, 'upcoming', 'a future month is upcoming');
    t.eq(future.projectedPaise, null, 'no projection without elapsed days');

    const none = pace({ budgetPaise: null, spentPaise: 500, monthKey: '2025-08', today: TODAY });
    t.eq(none.status, 'no-budget', 'a null budget is untracked, not a zero budget');
    t.eq(none.expectedPaise, null, 'an untracked category has no expectation');

    const zero = pace({ budgetPaise: 0, spentPaise: 500, monthKey: '2025-08', today: TODAY });
    t.eq(zero.status, 'ahead', 'a zero budget is a real budget of zero');
  }

  t.group('Analytics — projection');

  t.eq(projectMonthEnd(100000, 0, 31), null, 'zero days elapsed does not divide by zero');
  t.eq(projectMonthEnd(100000, 10, 30), 300000, 'projection scales to month end');
  t.eq(projectMonthEnd(0, 10, 30), 0, 'no spend projects to no spend');

  t.group('Analytics — budget report');

  {
    const cats = [
      { ...CATEGORIES[0], budgetPaise: 1000000 },
      { ...CATEGORIES[1], budgetPaise: null },
      { ...CATEGORIES[8], budgetPaise: null },
    ];
    const list = [
      expense('2025-08-02', 6000, 'food'),
      expense('2025-08-03', 2000, 'groceries'),
      expense('2025-08-04', 1000, 'other'),
    ];
    const report = budgetReport(list, cats, '2025-08', TODAY);
    t.eq(report.budgeted.length, 1, 'only categories with a budget are budgeted');
    t.eq(report.unbudgetedPaise, 300000, 'spending outside a budget is never invisible');
    t.eq(report.overall.budgetPaise, 1000000, 'the overall budget is the sum of categories');
    t.eq(
      report.overall.spentPaise,
      600000,
      'the overall row compares budgeted spend against budgeted money',
    );
    t.eq(
      report.overall.spentPaise + report.unbudgetedPaise,
      report.monthTotalPaise,
      'budgeted plus unbudgeted equals the month total, with nothing counted twice',
    );
    t.eq(report.monthTotalPaise, 900000, 'the month total is still reported');
  }

  t.group('Analytics — daily totals across a range');

  {
    const list = [
      expense('2025-07-30', 100, 'food'),
      expense('2025-08-01', 200, 'food'),
      expense('2025-08-01', 50, 'food'),
      expense('2025-09-01', 900, 'food'),
    ];
    const series = dailyTotalsBetween(list, '2025-07-30', '2025-08-02');
    t.eq(series.length, 4, 'the range is inclusive at both ends');
    t.eq(series[0].date, '2025-07-30', 'it starts where asked');
    t.eq(series[3].date, '2025-08-02', 'it ends where asked');
    t.eq(series[0].totalPaise, 10000, 'a day inside the range is summed');
    t.eq(series[2].totalPaise, 25000, 'two expenses on one day are added');
    t.eq(series[1].totalPaise, 0, 'a day with nothing is zero, not missing');
    t.ok(series.every((d) => Number.isFinite(d.totalPaise)), 'no NaN in the series');
    t.eq(dailyTotalsBetween(list, '2025-08-05', '2025-08-01').length, 0, 'a backwards range is empty');
    t.eq(dailyTotalsBetween([], '2025-08-01', '2025-08-03').length, 3, 'an empty ledger still zero-fills');

    // This is what the 30-day rolling average rides on: it must reach back
    // before the first of the month rather than restarting at zero.
    const spanning = dailyTotalsBetween(list, '2025-07-03', '2025-08-31');
    t.eq(spanning.length, 60, 'a range can cross a month boundary');
  }

  /* ======================================================== geometry === */
  t.group('Geometry — polar coordinates');

  {
    const near = (a, b, label) => t.ok(Math.abs(a - b) < 0.001, label);
    const top = polarToCartesian(100, 100, 50, 0);
    near(top.x, 100, '0 degrees is straight up (x)');
    near(top.y, 50, '0 degrees is straight up (y)');
    const right = polarToCartesian(100, 100, 50, 90);
    near(right.x, 150, '90 degrees is clockwise to the right (x)');
    near(right.y, 100, '90 degrees is clockwise to the right (y)');
    const bottom = polarToCartesian(100, 100, 50, 180);
    near(bottom.y, 150, '180 degrees is straight down');
    const left = polarToCartesian(100, 100, 50, 270);
    near(left.x, 50, '270 degrees is to the left');
    const wrapped = polarToCartesian(100, 100, 50, 360);
    near(wrapped.x, top.x, '360 degrees returns to the top');
  }

  t.group('Geometry — donut segments');

  {
    const opts = { cx: 100, cy: 100, rOuter: 88, rInner: 56 };

    t.eq(donutSegments([], opts).length, 0, 'no values means no segments');
    t.eq(donutSegments([0, 0], opts).length, 0, 'all-zero values draw nothing');
    t.eq(donutSegments([-5, 0], opts).length, 0, 'negatives are treated as zero');

    const single = donutSegments([500], opts);
    t.eq(single.length, 1, 'one category makes one segment');
    t.eq(single[0].isFullCircle, true, 'one category is flagged as a full circle');
    t.eq(single[0].fraction, 1, 'one category is the whole ring');
    // The bug this guards: a 360-degree wedge has identical start and end
    // points, and an SVG arc between identical points draws nothing at all.
    t.eq((single[0].path.match(/A /g) ?? []).length, 4, 'a full ring is drawn with four arcs, not one');
    t.ok(single[0].path.split('Z').length === 3, 'a full ring is two closed subpaths');

    const two = donutSegments([100, 100], opts);
    t.eq(two.length, 2, 'two categories make two segments');
    t.eq(two[0].fraction, 0.5, 'equal values split the ring evenly');
    t.eq(two[0].startAngle, 0, 'the first segment starts at twelve o clock');
    t.eq(two[0].endAngle, 180, 'the first segment ends halfway round');
    t.eq(two[1].endAngle, 360, 'the last segment closes the ring');
    t.ok(two[0].path !== two[1].path, 'the two halves are different paths');
    t.eq(two[0].isFullCircle, false, 'neither half is a full circle');

    const many = donutSegments([50, 30, 20], opts);
    t.eq(many.length, 3, 'three categories make three segments');
    const sum = many.reduce((a, seg) => a + seg.fraction, 0);
    t.ok(Math.abs(sum - 1) < 1e-9, 'fractions sum to one');
    t.ok(
      many.every((seg, i) => i === 0 || seg.startAngle >= many[i - 1].endAngle - 1e-9),
      'segments run in order without overlapping',
    );
    t.ok(many.every((seg) => seg.path.startsWith('M ')), 'every segment is a real path');
    t.ok(many.every((seg) => !seg.path.includes('NaN')), 'no NaN reaches the path data');

    const withZero = donutSegments([100, 0, 100], opts);
    t.eq(withZero.length, 2, 'zero-value categories are skipped, not drawn empty');

    // A slice too small to survive the gap must still be visible.
    const tiny = donutSegments([100000, 1], opts);
    t.eq(tiny.length, 2, 'a tiny slice is still drawn');
    t.ok(!tiny[1].path.includes('NaN'), 'a tiny slice does not produce NaN');

    const ring = donutRingPath(opts);
    t.ok(ring.includes('A 88 88') && ring.includes('A 56 56'), 'the ring uses both radii');
  }

  t.group('Geometry — lines');

  t.eq(linePath([]), '', 'an empty line is an empty path');
  t.eq(linePath([{ x: 0, y: 10 }]), 'M 0 10', 'a single point is a move');
  t.eq(
    linePath([{ x: 0, y: 10 }, { x: 5, y: 20 }]),
    'M 0 10 L 5 20',
    'a line moves once and draws the rest',
  );
  t.ok(!linePath([{ x: 1 / 3, y: 2 / 3 }]).includes('0.3333'), 'coordinates are rounded, not endless');

  /* ==================================================== weight scale === */
  t.group('Weight scale — degenerate sets resolve to 0.5');

  t.eq(weightScale([]).t(100), 0.5, 'an empty set is 0.5');
  t.eq(weightScale([]).degenerate, true, 'an empty set is flagged degenerate');
  t.eq(weightScale([25000]).t(25000), 0.5, 'a single expense is 0.5');
  t.eq(weightScale([500, 500, 500, 500]).t(500), 0.5, 'all-identical amounts are 0.5');
  t.eq(weightScale([0, 0]).t(0), 0.5, 'zeroes cannot produce log(0)');

  t.group('Weight scale — mapping and clamping');

  {
    const amounts = [];
    for (let i = 1; i <= 100; i += 1) amounts.push(i * 1000);
    const scale = weightScale(amounts);
    t.eq(scale.t(Math.min(...amounts)), 0, 'the minimum maps to 0');
    t.eq(scale.t(Math.max(...amounts)), 1, 'the maximum maps to 1');
    t.ok(scale.t(50000) > 0 && scale.t(50000) < 1, 'a middling amount lands strictly inside');
    t.ok(scale.t(20000) < scale.t(60000), 'the scale is monotonic');

    const outlier = weightScale([...amounts, 100000000]);
    t.eq(outlier.t(100000000), 1, 'an extreme outlier clamps to 1');
    t.ok(outlier.t(50000) > 0.2, 'the outlier does not crush the rest of the list');
    t.ok(
      Math.abs(outlier.t(50000) - scale.t(50000)) < 0.25,
      'percentile bounds keep the body of the list stable',
    );

    const logScale = weightScale([100, 1000, 10000, 100000, 1000000]);
    const spread = [100, 1000, 10000, 100000, 1000000].map((n) => logScale.t(n));
    t.ok(
      spread[1] > 0.15 && spread[1] < 0.4,
      'a log scale keeps small amounts visible where a linear scale would not',
    );
    t.ok(spread.every((v) => v >= 0 && v <= 1), 't is always within [0,1]');
  }

  t.group('Weight scale — percentiles and axis ticks');

  t.eq(percentile([10, 20, 30, 40, 50], 0.5), 30, 'median percentile');
  t.eq(percentile([10, 20], 0.5), 15, 'percentile interpolates');
  t.eq(percentile([], 0.5), 0, 'percentile of nothing is 0');
  t.deepEq(niceTicks(3847, 5).ticks, [0, 1000, 2000, 3000, 4000], 'nice ticks round the range');
  t.eq(niceTicks(0).ticks.length > 0, true, 'nice ticks survive a zero maximum');
  t.eq(niceTicks(95).step, 20, 'nice ticks pick a 1/2/5 step');

  /* ========================================================= filters === */
  t.group('Filters — composition');

  {
    const august = { start: '2025-08-01', end: '2025-08-31', label: 'August 2025' };
    const list = [
      expense('2025-08-01', 100, 'food', { accountId: 'bank', note: 'chai at work' }),
      expense('2025-08-02', 200, 'transport', { accountId: 'cash', note: 'auto' }),
      expense('2025-08-03', 300, 'food', { accountId: 'card', note: 'Swiggy' }),
      expense('2025-07-30', 400, 'food', { accountId: 'bank', note: 'chai' }),
    ];

    t.eq(applyFilters(list, DEFAULT_FILTERS).length, 4, 'default filters keep everything');
    t.eq(applyFilters(list, { range: august }).length, 3, 'period filter');
    t.eq(applyFilters(list, { categoryIds: ['food'] }).length, 3, 'category filter');
    t.eq(applyFilters(list, { categoryIds: ['food', 'transport'] }).length, 4, 'category multi-select is OR');
    t.eq(applyFilters(list, { accountIds: ['bank'] }).length, 2, 'account filter');
    t.eq(applyFilters(list, { query: 'chai' }).length, 2, 'note search');
    t.eq(applyFilters(list, { query: 'SWIGGY' }).length, 1, 'note search is case-insensitive');
    t.eq(applyFilters(list, { query: '  chai  ' }).length, 2, 'note search trims');
    t.eq(applyFilters(list, { query: 'nothing here' }).length, 0, 'a search can match nothing');

    t.eq(
      applyFilters(list, { range: august, categoryIds: ['food'], accountIds: ['bank'] }).length,
      1,
      'filters compose with AND across kinds',
    );
    t.eq(applyFilters([], { query: 'x' }).length, 0, 'filtering nothing returns nothing');

    const elsewhere = [expense('2025-08-01', 100, 'food', { accountId: 'cash' })];
    t.eq(applyFilters(elsewhere, { accountIds: ['card'] }).length, 0, 'a record in another account is excluded');

    // Kind is a first-class filter, and a transfer answers to 'transfer' only.
    const mixed = [
      expense('2025-08-01', 100, 'food'),
      income('2025-08-01', 900, 'salary'),
      transfer('2025-08-02', 500, 'bank', 'cash'),
    ];
    t.eq(applyFilters(mixed, { kinds: ['expense'] }).length, 1, 'kind filter: expenses');
    t.eq(applyFilters(mixed, { kinds: ['income'] }).length, 1, 'kind filter: income');
    t.eq(applyFilters(mixed, { kinds: ['transfer'] }).length, 1, 'kind filter: transfers');
    t.eq(applyFilters(mixed, { kinds: ['expense', 'income'] }).length, 2, 'kind multi-select is OR');
    t.eq(
      applyFilters(mixed, { accountIds: ['cash'] }).length,
      2,
      'an account filter matches either end of a transfer',
    );

    t.eq(hasNarrowingFilters({ ...DEFAULT_FILTERS, range: august }), false, 'a period alone is not narrowing');
    t.eq(hasNarrowingFilters({ ...DEFAULT_FILTERS, query: 'a' }), true, 'a query narrows');
    t.eq(hasNarrowingFilters({ ...DEFAULT_FILTERS, query: '   ' }), false, 'whitespace does not narrow');
  }

  t.group('Filters — URL round trip');

  {
    const full = {
      range: { start: '2025-08-01', end: '2025-08-31', label: '' },
      kinds: [],
      categoryIds: ['food', 'rent'],
      accountIds: ['bank'],
      query: 'chai',
    };
    t.eq(
      decodeURIComponent(filtersToHash(full)),
      '#from=2025-08-01&to=2025-08-31&cat=food,rent&acct=bank&q=chai',
      'filters serialise to a readable hash',
    );
    t.deepEq(parseFilterHash(filtersToHash(full)), full, 'hash round trips');
    t.eq(filtersToHash(DEFAULT_FILTERS), '', 'defaults produce an empty hash');

    t.deepEq(parseFilterHash(''), DEFAULT_FILTERS, 'an empty hash is the default');
    t.deepEq(parseFilterHash(undefined), DEFAULT_FILTERS, 'a missing hash does not throw');
    t.eq(parseFilterHash('#from=nonsense').range, null, 'a bad date is ignored');
    t.eq(parseFilterHash('#cat=').categoryIds.length, 0, 'an empty list parses to no ids');
    t.eq(parseFilterHash('#garbage').query, '', 'unrecognised keys are ignored');
    t.eq(
      parseFilterHash('#cat=food', { range: { start: '2025-08-01', end: '2025-08-31' } }).range.start,
      '2025-08-01',
      'the fallback fills in what the hash omits',
    );

    const cats = { food: { name: 'Food & Dining' }, rent: { name: 'Rent & Bills' } };
    const accts = { bank: { name: 'Bank' } };
    t.eq(
      describeFilters(full, cats, accts),
      'Food & Dining, Rent & Bills · Bank · notes containing “chai”',
      'filters describe themselves for the empty state',
    );
    t.eq(describeFilters(DEFAULT_FILTERS, cats, accts), '', 'nothing active describes as nothing');
  }

  /* ===================================================== sample data === */
  t.group('Sample data');

  {
    let n = 0;
    const makeId = () => `s${(n += 1)}`;
    const opts = { today: '2025-08-13', makeId, months: 3, seed: 7 };
    const first = generateSampleTransactions(opts);
    n = 0;
    const second = generateSampleTransactions(opts);

    t.deepEq(first, second, 'the same seed produces the same ledger');
    t.ok(first.length > 100, `three months generates a full ledger (${first.length} transactions)`);

    const ids = new Set(ALL_CATEGORIES.map((c) => c.id));
    t.ok(first.every((e) => Number.isSafeInteger(e.amountPaise) && e.amountPaise > 0), 'every amount is a positive integer');
    t.ok(first.every((e) => isValid(e.date)), 'every date is a real calendar day');
    t.ok(first.every((e) => e.date <= '2025-08-13'), 'nothing is dated in the future');
    t.ok(
      first.every((e) => (e.kind === 'transfer' ? e.categoryId === null : ids.has(e.categoryId))),
      'every category is a real seed category, and a transfer has none',
    );
    t.ok(first.every((e) => validateTransaction(e, VCTX)), 'every generated record survives validation');
    t.ok(first.some((e) => e.date === '2025-08-13'), 'today is never empty');

    // v2: the generated ledger has to exercise the whole model, or the demo
    // shows an Accounts tab full of negative numbers and nothing else.
    t.ok(first.some((e) => e.direction === 'income'), 'the sample ledger earns as well as spends');
    t.ok(first.some((e) => e.kind === 'transfer'), 'the sample ledger moves money between accounts');
    t.ok(
      first.filter((e) => e.kind === 'transfer').every((e) => e.accountId !== e.toAccountId),
      'no generated transfer goes to the account it came from',
    );
    t.ok(
      first.filter((e) => e.kind === 'transaction').every((e) => e.toAccountId === null),
      'only a transfer has a destination account',
    );

    const months = new Set(first.map((e) => monthKey(e.date)));
    t.deepEq([...months].sort(), ['2025-06', '2025-07', '2025-08'], 'three months are covered');

    const rent = first.filter((e) => e.categoryId === 'rent' && e.note === 'Flat rent');
    t.eq(rent.length, 3, 'rent lands once a month');
    t.ok(rent.every((e) => e.date.endsWith('-01')), 'rent lands on the first');
    t.ok(rent.every((e) => e.amountPaise >= 2800000), 'rent is a plausible peak');

    const creates = first.map((e) => e.createdAt);
    t.eq(new Set(creates).size, creates.length, 'createdAt is unique, so same-day order is stable');

    const drawsA = Array.from({ length: 5 }, mulberry32(42));
    const drawsB = Array.from({ length: 5 }, mulberry32(42));
    const drawsC = Array.from({ length: 5 }, mulberry32(43));
    t.ok(drawsA.every((x) => x >= 0 && x < 1), 'the PRNG stays in [0,1)');
    t.deepEq(drawsA, drawsB, 'the same seed replays the same sequence');
    t.ok(drawsA.some((x, i) => x !== drawsC[i]), 'a different seed diverges');
  }

  /* ========================================================= storage === */
  t.group('Storage — parsing and fallback');

  {
    t.eq(parseState('{oops').ok, false, 'malformed JSON is reported');
    t.deepEq(parseState('{oops').state, defaultState(), 'malformed JSON falls back to defaults');
    t.eq(parseState('{oops').reason, 'malformed-json', 'the reason is explicit');
    t.eq(parseState(null).ok, true, 'a missing key is not an error');
    t.eq(parseState(null).state.transactions.length, 0, 'a missing key gives an empty ledger');
    t.eq(parseState('[]').ok, false, 'a top-level array is rejected');
    t.eq(defaultState().categories.filter((c) => c.kind === 'expense').length, 9, 'nine expense seed categories');
    t.eq(defaultState().categories.filter((c) => c.kind === 'income').length, 6, 'six income seed categories');
    t.eq(defaultState().accounts.length, 3, 'three seed accounts');
    t.eq(defaultState().schemaVersion, CURRENT_SCHEMA_VERSION, 'defaults carry the version');
  }

  t.group('Storage — schema versioning');

  {
    const future = { schemaVersion: CURRENT_SCHEMA_VERSION + 1, transactions: [] };
    t.eq(migrate(future).ok, false, 'an unknown future version fails');
    t.eq(migrate(future).reason, 'future-schema', 'and says why');
    t.deepEq(
      parseState(JSON.stringify(future)).state,
      defaultState(),
      'a future version falls back rather than corrupting data',
    );

    const v0 = {
      expenses: [
        { id: 'a', amount: 1200.5, date: '2025-08-01', category: 'Food & Dining', note: 'lunch' },
        { amount: 99.99, date: '2025-08-02', category: 'Nonsense' },
      ],
    };
    const up = migrate(v0);
    t.eq(up.ok, true, 'a v0 payload migrates');
    t.eq(up.data.schemaVersion, CURRENT_SCHEMA_VERSION, 'migrated data carries the new version');
    t.eq(up.data.transactions[0].amountPaise, 120050, 'v0 float rupees become integer paise');
    t.eq(up.data.transactions[0].categoryId, 'food', 'v0 category names become ids');
    t.eq(up.data.transactions[0].note, 'lunch', 'v0 notes survive');
    t.eq(up.data.transactions[1].categoryId, 'other', 'an unknown v0 category lands in Other');
    t.eq(up.data.categories.filter((c) => c.kind === 'expense').length, 9, 'migration seeds categories');
    t.ok(typeof up.data.transactions[0].createdAt === 'string', 'migration invents a createdAt');
    t.eq(up.data.transactions[0].kind, 'transaction', 'a v0 record chains all the way to v2');
  }

  t.group('Storage — validation');

  {
    const good = {
      id: 'x', kind: 'transaction', direction: 'expense', amountPaise: 100,
      date: '2025-08-01', accountId: 'cash', toAccountId: null, categoryId: 'food',
    };
    t.ok(validateTransaction(good, VCTX), 'a good record validates');
    t.eq(validateTransaction({ ...good, amountPaise: 0 }, VCTX), null, 'a zero amount is rejected');
    t.eq(validateTransaction({ ...good, amountPaise: -1 }, VCTX), null, 'a negative amount is rejected');
    t.eq(validateTransaction({ ...good, amountPaise: 1.5 }, VCTX), null, 'a float amount is rejected');
    t.eq(validateTransaction({ ...good, date: '2025-02-30' }, VCTX), null, 'an unreal date is rejected');
    t.eq(validateTransaction({ ...good, id: '' }, VCTX), null, 'a record with no id is rejected');
    t.eq(validateTransaction(null, VCTX), null, 'null does not throw');
    t.eq(
      validateTransaction({ ...good, categoryId: 'ghost' }, VCTX).categoryId,
      'other',
      'a record whose category vanished is reassigned, never orphaned',
    );
    t.eq(
      validateTransaction({ ...good, accountId: 'ghost' }, VCTX).accountId,
      'cash',
      'a record whose account vanished falls back to the default, never orphaned',
    );

    // The rule that makes every income total trustworthy: a positive amount
    // and a direction, never a signed number standing in for both.
    t.eq(
      validateTransaction({ ...good, direction: 'income', categoryId: 'salary' }, VCTX).amountPaise,
      100,
      'income stores the same positive amount an expense does',
    );
    t.eq(
      validateTransaction({ ...good, direction: 'sideways' }, VCTX).direction,
      'expense',
      'an unreadable direction reads as an expense rather than as nothing',
    );

    const move = {
      id: 'x', kind: 'transfer', direction: null, amountPaise: 500,
      date: '2025-08-01', accountId: 'bank', toAccountId: 'cash', categoryId: null,
    };
    t.ok(validateTransaction(move, VCTX), 'a transfer between two real accounts validates');
    t.eq(validateTransaction(move, VCTX).categoryId, null, 'a transfer has no category');
    t.eq(validateTransaction(move, VCTX).direction, null, 'a transfer has no direction');
    t.eq(
      validateTransaction({ ...move, toAccountId: 'bank' }, VCTX),
      null,
      'a transfer to its own source account is refused, not silently doubled',
    );
    t.eq(
      validateTransaction({ ...move, toAccountId: 'ghost' }, VCTX),
      null,
      'a transfer with no real destination is refused: there is nothing safe to guess',
    );
    t.eq(
      validateTransaction({ ...good, categoryId: 'salary' }, VCTX).categoryId,
      'other',
      'an income category on an expense record falls back to the expense sink',
    );

    const dirty = JSON.stringify({
      schemaVersion: 2,
      accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
      categories: [{ id: 'food', name: 'Food & Dining', kind: 'expense' }],
      transactions: [good, { junk: true }, null, { ...good, id: 'y', date: 'nope' }],
    });
    t.eq(parseState(dirty).state.transactions.length, 1, 'unusable records are dropped, not fatal');
    t.ok(
      parseState(dirty).state.categories.some((c) => c.id === 'other'),
      'Other is always present as a reassignment target',
    );
    t.ok(
      parseState(dirty).state.categories.some((c) => c.kind === 'income'),
      'an income sink is always present too, or income could not be recorded',
    );
  }

  t.group('Storage — accounts');

  {
    const raw = {
      id: 'hdfc', name: 'HDFC', type: 'bank', openingBalancePaise: -450000,
      colorToken: 'acct-2', icon: 'bank', archived: false,
    };
    t.eq(validateAccount(raw, 0).openingBalancePaise, -450000, 'a negative opening balance is kept');
    t.eq(validateAccount({ ...raw, type: 'crypto' }, 0).type, 'cash', 'an unknown account type falls back');
    t.eq(validateAccount({ ...raw, openingBalancePaise: 1.5 }, 0).openingBalancePaise, 0, 'a float opening balance is refused');
    t.eq(validateAccount({ ...raw, id: '' }, 0), null, 'an account with no id is rejected');
    t.eq(validateAccount(null, 0), null, 'null does not throw');
    t.eq(makeAccountId('HDFC Bank', [{ id: 'hdfc-bank' }]), 'hdfc-bank-2', 'a clashing account id is suffixed');

    const accts = SEED_ACCOUNTS.map((a) => ({ ...a }));
    const list = [expense('2025-08-01', 100, 'food', { accountId: 'cash' })];
    t.eq(countTransactionsFor(list, 'cash'), 1, 'transactions in an account are counted');
    t.eq(countTransactionsFor([transfer('2025-08-01', 100, 'bank', 'cash')], 'cash'), 1, 'a transfer counts against both its ends');
    t.eq(canDeleteAccount(accts, 'card', []).ok, true, 'an unused account can be deleted outright');
    t.eq(canDeleteAccount(accts, 'cash', list).ok, false, 'an account with history cannot');
    t.eq(canDeleteAccount(accts, 'cash', list).reason, 'in-use', 'and says why');
    t.eq(canDeleteAccount(accts, 'cash', list).count, 1, 'and says how much history');
    t.eq(canDeleteAccount(accts, 'ghost', []).reason, 'not-found', 'an account that is not there cannot be deleted');
    t.eq(canDeleteAccount([accts[0]], 'cash', []).reason, 'last-account', 'the last account cannot be deleted');

    const both = [transfer('2025-08-01', 100, 'bank', 'cash'), expense('2025-08-02', 50, 'food', { accountId: 'bank' })];
    const moved = reassignAccount(both, 'bank', 'card');
    t.eq(moved.length, 2, 'reassigning an account keeps every record');
    t.eq(moved[0].accountId, 'card', 'a transfer out of the account is re-pointed');
    t.eq(moved[1].accountId, 'card', 'so is an ordinary transaction');
    t.eq(
      reassignAccount(both, 'bank', 'cash').length,
      1,
      'a transfer whose two ends collapse onto one account is dropped, not left moving money nowhere',
    );
    t.eq(dropTransactionsFor(both, 'cash').length, 1, 'delete-together removes everything touching the account');
  }

  t.group('Categories — deleting must not orphan transactions');

  {
    const cats = ALL_CATEGORIES.map((c) => ({ ...c }));
    const list = [
      expense('2025-08-01', 100, 'food'),
      expense('2025-08-02', 200, 'food'),
      expense('2025-08-03', 300, 'transport'),
    ];

    t.eq(countTransactionsIn(list, 'food'), 2, 'transactions in a category are counted');
    t.eq(countTransactionsIn(list, 'health'), 0, 'an unused category counts zero');

    const moved = reassignCategory(list, 'food', 'groceries');
    t.eq(countTransactionsIn(moved, 'food'), 0, 'reassign empties the old category');
    t.eq(countTransactionsIn(moved, 'groceries'), 2, 'reassign fills the new one');
    t.eq(moved.length, list.length, 'reassign never loses a transaction');
    t.eq(moved[2].categoryId, 'transport', 'reassign leaves other categories alone');
    t.eq(list[0].categoryId, 'food', 'reassign does not mutate the input');

    const dropped = dropTransactionsIn(list, 'food');
    t.eq(dropped.length, 1, 'delete-together removes exactly that category');
    t.eq(countTransactionsIn(dropped, 'food'), 0, 'nothing in the deleted category survives');

    t.eq(canDeleteCategory(cats, 'other').ok, false, 'Other cannot be deleted');
    t.eq(canDeleteCategory(cats, 'other').reason, 'protected', 'and says why');
    t.eq(canDeleteCategory(cats, 'other-income').reason, 'protected', 'nor can the income sink');
    t.eq(canDeleteCategory(cats, 'food').ok, true, 'an ordinary category can be deleted');
    t.eq(canDeleteCategory(cats, 'ghost').ok, false, 'a category that is not there cannot be deleted');
    t.eq(canDeleteCategory([cats[0]], 'food').ok, false, 'the last category cannot be deleted');
    t.eq(
      canDeleteCategory(cats, 'food', list).reason,
      'in-use',
      'a category with history is archived, not deleted, unless you say what to do with it',
    );
    t.eq(canDeleteCategory(cats, 'food', list).count, 2, 'and it says how many records are at stake');
    t.eq(canDeleteCategory(cats, 'health', list).ok, true, 'a category with no history just goes');

    t.eq(makeCategoryId('Pets', cats), 'pets', 'a new id is a readable slug');
    t.eq(makeCategoryId('Food & Dining', cats), 'food-dining', 'punctuation becomes hyphens');
    t.eq(makeCategoryId('Food', [{ id: 'food' }]), 'food-2', 'a clashing id is suffixed');
    t.eq(makeCategoryId('Food', [{ id: 'food' }, { id: 'food-2' }]), 'food-3', 'suffixes keep counting');
    t.eq(makeCategoryId('!!!', cats), 'category', 'a name with no letters still yields an id');
  }

  /* ========================================================== backup === */
  t.group('Backup — export');

  {
    const state = defaultState();
    state.transactions = [expense('2025-08-01', 250, 'food')];
    const payload = buildExport(state, { exportedAt: '2025-08-13T10:00:00.000Z' });

    t.eq(payload.format, EXPORT_FORMAT, 'the export is labelled');
    t.eq(payload.data.schemaVersion, CURRENT_SCHEMA_VERSION, 'the export carries its schema version');
    t.eq(payload.data.transactions.length, 1, 'transactions are exported');
    t.eq(payload.data.categories.length, 15, 'categories are exported');
    t.eq(payload.data.accounts.length, 3, 'accounts are exported, or a restore would lose every balance');
    t.eq(exportFilename('2025-08-13T10:00:00.000Z'), 'heft-2025-08-13.json', 'the filename is dated');

    const round = readImport(JSON.stringify(payload));
    t.eq(round.ok, true, 'an export imports back');
    t.eq(round.state.transactions.length, 1, 'the round trip keeps the transaction');
    t.eq(round.state.transactions[0].amountPaise, 25000, 'the round trip keeps exact paise');
    t.eq(round.exportedAt, '2025-08-13T10:00:00.000Z', 'the export date survives');
  }

  t.group('Backup — import validation');

  {
    t.eq(readImport('').reason, 'empty-file', 'an empty file is refused');
    t.eq(readImport('   ').reason, 'empty-file', 'a whitespace file is refused');
    t.eq(readImport('{oops').reason, 'malformed-json', 'malformed JSON is refused, not thrown');
    t.eq(readImport('[1,2,3]').reason, 'not-an-object', 'a bare array is refused');
    t.eq(readImport('null').reason, 'not-an-object', 'null is refused');
    t.eq(readImport('{"hello":"world"}').reason, 'not-heft-data', 'unrelated JSON is refused');
    t.eq(readImport(JSON.stringify({ format: EXPORT_FORMAT })).reason, 'no-data', 'an envelope with no data is refused');
    t.eq(
      readImport(JSON.stringify({ schemaVersion: 99, transactions: [] })).reason,
      'future-schema',
      'a file from a newer Heft is refused rather than mangled',
    );

    // A bare state object, e.g. copied straight out of localStorage.
    const bare = readImport(JSON.stringify({
      schemaVersion: 2,
      transactions: [],
      accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
      categories: ALL_CATEGORIES.map((c) => ({ ...c })),
      settings: {},
    }));
    t.eq(bare.ok, true, 'a bare state object imports');
    t.eq(bare.exportedAt, null, 'a bare object has no export date');

    // A v0 file migrates on the way in.
    const old = readImport(JSON.stringify({
      expenses: [{ id: 'a', amount: 99.5, date: '2025-08-01', category: 'Food & Dining' }],
    }));
    t.eq(old.ok, true, 'a v0 file imports');
    t.eq(old.state.transactions[0].amountPaise, 9950, 'a v0 file is migrated to integer paise');

    const dirty = readImport(JSON.stringify({
      schemaVersion: 2,
      accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
      categories: ALL_CATEGORIES.map((c) => ({ ...c })),
      transactions: [
        { id: 'ok', amountPaise: 100, date: '2025-08-01', categoryId: 'food', accountId: 'cash' },
        { id: 'bad', amountPaise: -5, date: '2025-08-01', categoryId: 'food', accountId: 'cash' },
        null,
      ],
    }));
    t.eq(dirty.state.transactions.length, 1, 'unusable records in a file are dropped, not imported');
  }

  t.group('Backup — the preview says what will change');

  {
    const current = defaultState();
    current.transactions = [
      expense('2025-08-01', 100, 'food'),
      expense('2025-08-02', 200, 'food'),
    ];
    current.transactions[0].id = 'shared';

    const incoming = defaultState();
    incoming.transactions = [
      { ...expense('2025-08-01', 100, 'food'), id: 'shared' },
      expense('2025-08-05', 500, 'transport'),
      expense('2025-08-06', 600, 'transport'),
    ];
    incoming.categories = [...incoming.categories, {
      id: 'pets', name: 'Pets', kind: 'expense', colorToken: 'cat-1', budgetPaise: null, icon: 'dot', archived: false,
    }];
    incoming.accounts = [...incoming.accounts, account('wallet', 'Wallet', 'wallet')];

    const summary = summariseImport(current, incoming);
    t.eq(summary.current.transactions, 2, 'the preview counts what you have');
    t.eq(summary.incoming.transactions, 3, 'the preview counts what is in the file');
    t.eq(summary.merge.transactionsAdded, 2, 'merge adds only what is new');
    t.eq(summary.merge.transactionsSkipped, 1, 'merge reports the duplicate it will skip');
    t.eq(summary.merge.transactionsAfter, 4, 'merge reports the resulting total');
    t.eq(summary.merge.transactionsRemoved, 0, 'merge removes nothing');
    t.eq(summary.merge.categoriesAdded, 1, 'merge reports the new category');
    t.eq(summary.merge.accountsAdded, 1, 'merge reports the new account');
    t.eq(summary.replace.transactionsRemoved, 2, 'replace reports what would be lost');
    t.eq(summary.replace.transactionsAfter, 3, 'replace reports the resulting total');

    const merged = mergeStates(current, incoming);
    t.eq(merged.transactions.length, 4, 'merge produces what the preview promised');
    t.eq(
      merged.transactions.filter((e) => e.id === 'shared').length,
      1,
      'a shared id appears exactly once after a merge',
    );
    t.eq(
      merged.transactions.find((e) => e.id === 'shared').amountPaise,
      current.transactions[0].amountPaise,
      'on an id collision the record already on screen wins',
    );
    t.eq(merged.categories.length, 16, 'merge adds the new category');
    t.eq(merged.accounts.length, 4, 'merge adds the new account rather than orphaning what points at it');
    t.eq(current.transactions.length, 2, 'merge does not mutate the current state');

    const replaced = replaceWith(current, incoming);
    t.eq(replaced.transactions.length, 3, 'replace produces what the preview promised');
    t.eq(replaced.settings.theme, current.settings.theme, 'replace keeps your theme');

    const cleared = clearedState(current);
    t.eq(cleared.transactions.length, 0, 'clearing empties the ledger');
    t.eq(cleared.categories.length, current.categories.length, 'clearing keeps your categories');
    t.eq(cleared.accounts.length, current.accounts.length, 'clearing keeps your accounts');
    t.eq(cleared.schemaVersion, CURRENT_SCHEMA_VERSION, 'clearing keeps the schema version');
  }

  t.group('Storage — persistence');

  {
    const backend = fakeStorage();
    const state = defaultState();
    t.eq(saveState(backend, state).ok, true, 'saving works');
    t.deepEq(loadState(backend).state, state, 'a saved state loads back identically');
    t.eq(loadState(fakeStorage()).state.transactions.length, 0, 'an empty backend gives defaults');

    const full = {
      getItem: () => null,
      setItem: () => {
        const err = new Error('full');
        err.name = 'QuotaExceededError';
        throw err;
      },
    };
    const result = saveState(full, state);
    t.eq(result.ok, false, 'a full quota does not throw');
    t.eq(result.reason, 'quota-exceeded', 'a full quota is reported so the UI can say so');

    const hostile = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    };
    t.eq(loadState(hostile).ok, false, 'a blocked backend is reported');
    t.eq(loadState(hostile).state.transactions.length, 0, 'a blocked backend still yields defaults');
    t.eq(saveState(hostile, state).reason, 'write-failed', 'a non-quota failure is distinguished');
  }

  /* ======================================================== v2 model === */

  /**
   * The most dangerous class of bug in this schema: a total that quietly
   * includes something it should not. A wrong answer here is entirely
   * plausible on screen, so each aggregation gets its own assertion — they
   * fail independently, and one of them passing proves nothing about the rest.
   */
  t.group('Transfers — a transfer is neither income nor expense');

  {
    const base = [
      expense('2025-08-01', 1000, 'food'),
      expense('2025-08-01', 500, 'transport'),
      expense('2025-08-05', 2500, 'food'),
      income('2025-08-02', 9000, 'salary'),
    ];
    const withMove = [...base, transfer('2025-08-01', 7000, 'bank', 'cash')];

    t.eq(expenseTotalPaise(base), 400000, 'the expense total before');
    t.eq(
      expenseTotalPaise(withMove),
      expenseTotalPaise(base),
      'adding a transfer leaves the expense total unchanged',
    );
    t.eq(incomeTotalPaise(base), 900000, 'the income total before');
    t.eq(
      incomeTotalPaise(withMove),
      incomeTotalPaise(base),
      'adding a transfer leaves the income total unchanged',
    );
    t.eq(netPaise(withMove), netPaise(base), 'and the net is unchanged too');

    t.deepEq(
      expenseByCategory(withMove),
      expenseByCategory(base),
      'a transfer never appears in the expense category breakdown',
    );
    t.deepEq(
      incomeByCategory(withMove),
      incomeByCategory(base),
      'nor in the income one',
    );
    t.ok(
      expenseByCategory(withMove).every((r) => r.categoryId !== null && r.categoryId !== undefined),
      'no breakdown row is bucketed under a transfer’s absent category',
    );

    t.deepEq(
      dailyTotals(withMove, '2025-08'),
      dailyTotals(base, '2025-08'),
      'the daily bars do not move when a transfer is added',
    );
    t.eq(
      groupByDay(withMove).find((g) => g.date === '2025-08-01').totalPaise,
      groupByDay(base).find((g) => g.date === '2025-08-01').totalPaise,
      'the ledger day-header total does not move either',
    );
    t.deepEq(
      topExpenses(withMove, 5).map((e) => e.amountPaise),
      topExpenses(base, 5).map((e) => e.amountPaise),
      'a ₹7,000 transfer does not become your biggest expense',
    );
    t.eq(
      topExpenses([...base, income('2025-08-02', 50000, 'salary')], 1)[0].amountPaise,
      250000,
      'nor does a ₹50,000 salary',
    );

    const august = { start: '2025-08-01', end: '2025-08-31', label: 'August 2025' };
    t.eq(periodTotals(withMove, august).expensePaise, 400000, 'the period expense figure excludes it');
    t.eq(periodTotals(withMove, august).incomePaise, 900000, 'so does the period income figure');
    t.eq(periodTotals(withMove, august).transferCount, 1, 'but the period knows the transfer happened');

    t.eq(
      budgetReport(withMove, CATEGORIES.map((c) => ({ ...c, budgetPaise: 500000 })), '2025-08', TODAY)
        .overall.spentPaise,
      400000,
      'a transfer never consumes a budget',
    );
  }

  t.group('Accounts — the balance is derived, never stored');

  {
    const cash = account('cash', 'Cash', 'cash', 5000);
    const bank = account('bank', 'Bank', 'bank', 20000);
    // A card starts life owing money. That is a real opening balance.
    const card = account('card', 'Card', 'card', -3000);

    t.eq(accountBalance(cash, []), 500000, 'an account with no transactions is exactly its opening balance');
    t.eq(accountBalance(card, []), -300000, 'including a negative one, counted once and not twice');

    const ledger = [
      income('2025-08-01', 50000, 'salary', { accountId: 'bank' }),
      expense('2025-08-02', 1200, 'food', { accountId: 'bank' }),
      expense('2025-08-02', 300, 'food', { accountId: 'cash' }),
      expense('2025-08-03', 2000, 'shopping', { accountId: 'card' }),
      transfer('2025-08-04', 10000, 'bank', 'cash'),
      transfer('2025-08-05', 4000, 'cash', 'card'),
    ];

    // bank: 20000 + 50000 - 1200 - 10000 = 58800
    t.eq(accountBalance(bank, ledger), 5880000, 'income in, expense out, transfer out');
    // cash: 5000 - 300 + 10000 - 4000 = 10700
    t.eq(accountBalance(cash, ledger), 1070000, 'a transfer in and a transfer out both land');
    // card: -3000 - 2000 + 4000 = -1000
    t.eq(accountBalance(card, ledger), -100000, 'a negative opening balance carries through');

    const accounts = [cash, bank, card];
    t.eq(
      netWorthPaise(accounts, ledger),
      5880000 + 1070000 - 100000,
      'net worth is the sum of the derived balances',
    );

    // The invariant that catches a double-counted transfer: moving money
    // between your own accounts cannot change how much money you have.
    const before = netWorthPaise(accounts, ledger);
    const after = netWorthPaise(accounts, [...ledger, transfer('2025-08-06', 12345.67, 'card', 'bank')]);
    t.eq(after, before, 'a transfer leaves net worth exactly where it was');

    const moved = [...ledger, transfer('2025-08-06', 2500, 'bank', 'cash')];
    t.eq(
      accountBalance(bank, moved) - accountBalance(bank, ledger),
      -250000,
      'the source account falls by exactly the amount',
    );
    t.eq(
      accountBalance(cash, moved) - accountBalance(cash, ledger),
      250000,
      'and the destination rises by exactly the amount',
    );

    t.eq(accountBalances(accounts, ledger).length, 3, 'balances come back one per account');
    t.eq(netWorth(accounts, ledger).totalPaise, before, 'netWorth reports the same total');
    t.eq(
      netWorth([], []).totalPaise,
      0,
      'no accounts is zero, not NaN',
    );
    t.eq(accountBalance(null, ledger), 0, 'a missing account does not throw');
  }

  t.group('Income and expense net correctly');

  {
    const august = { start: '2025-08-01', end: '2025-08-31', label: 'August 2025' };
    const lean = [
      income('2025-08-01', 60000, 'salary'),
      expense('2025-08-02', 30000, 'rent'),
      expense('2025-08-03', 5000, 'food'),
    ];
    t.eq(periodTotals(lean, august).incomePaise, 6000000, 'income totals');
    t.eq(periodTotals(lean, august).expensePaise, 3500000, 'expense totals');
    t.eq(periodTotals(lean, august).netPaise, 2500000, 'income above expense is a positive net');

    const overspent = [
      income('2025-08-01', 20000, 'salary'),
      expense('2025-08-02', 30000, 'rent'),
    ];
    t.eq(periodTotals(overspent, august).netPaise, -1000000, 'expense above income is a negative net');
    t.eq(
      periodTotals(overspent, august).expensePaise,
      3000000,
      'and the expense figure itself stays positive: only the net carries a sign',
    );

    t.eq(periodTotals([], august).netPaise, 0, 'an empty period nets zero, not NaN');
    t.eq(
      netPaise([...lean, transfer('2025-08-04', 99999, 'bank', 'cash')]),
      netPaise(lean),
      'a transfer cannot change the net',
    );

    // Income lives in its own category space and never lands in the donut.
    t.eq(expenseByCategory(lean).length, 2, 'the expense donut has the expense categories');
    t.eq(incomeByCategory(lean)[0].categoryId, 'salary', 'the income view has the income ones');
    t.eq(incomeByCategory(lean)[0].share, 1, 'a single income category is the whole of it');
  }

  t.group('Categories are scoped by kind');

  {
    const backend = fakeStorage();
    const store = createStore({ backend, now: () => TODAY });
    store.init();

    const bad = store.addTransaction({
      direction: 'expense', amountPaise: 5000, date: TODAY, categoryId: 'salary',
    });
    t.eq(bad.ok, false, 'an income category cannot be assigned to an expense transaction');
    t.eq(bad.reason, 'category-kind-mismatch', 'and the store says exactly why');

    const alsoBad = store.addTransaction({
      direction: 'income', amountPaise: 5000, date: TODAY, categoryId: 'food',
    });
    t.eq(alsoBad.ok, false, 'nor an expense category to an income transaction');

    t.eq(
      store.addTransaction({ direction: 'expense', amountPaise: 5000, date: TODAY, categoryId: 'food' }).ok,
      true,
      'the matching kind is accepted',
    );
    t.eq(
      store.addTransaction({ direction: 'income', amountPaise: 5000, date: TODAY, categoryId: 'salary' }).ok,
      true,
      'in both directions',
    );
    t.eq(
      store.addTransaction({ direction: 'expense', amountPaise: 5000, date: TODAY, categoryId: 'ghost' }).reason,
      'unknown-category',
      'a category that does not exist is refused rather than quietly swapped',
    );

    // The rule is enforced in the store, so no form can route around it.
    const ex = store.getState().data.transactions.find((x) => x.direction === 'expense');
    t.eq(
      store.updateTransaction(ex.id, { categoryId: 'salary' }).reason,
      'category-kind-mismatch',
      'an edit cannot smuggle in a mismatched category either',
    );

    t.eq(store.addTransfer({ amountPaise: 1000, date: TODAY, accountId: 'bank', toAccountId: 'bank' }).reason,
      'same-account', 'a transfer to the same account is refused');
    t.eq(store.addTransfer({ amountPaise: 1000, date: TODAY, accountId: 'bank', toAccountId: 'ghost' }).reason,
      'unknown-account', 'a transfer to an account that is not there is refused');
    const good = store.addTransfer({ amountPaise: 1000, date: TODAY, accountId: 'bank', toAccountId: 'cash' });
    t.eq(good.ok, true, 'a real transfer is accepted');
    t.eq(good.transaction.categoryId, null, 'and carries no category');
    t.eq(good.transaction.direction, null, 'and no direction');

    t.eq(store.addTransaction({ direction: 'expense', amountPaise: -100, date: TODAY }).ok, false,
      'a negative amount cannot be stored at all');
    t.eq(store.addTransaction({ direction: 'expense', amountPaise: 0, date: TODAY }).ok, false,
      'nor a zero one');

    store.flush();
  }

  t.group('The store archives what has history and deletes what does not');

  {
    const backend = fakeStorage();
    const store = createStore({ backend, now: () => TODAY });
    store.init();
    store.addTransaction({ direction: 'expense', amountPaise: 5000, date: TODAY, categoryId: 'food', accountId: 'cash' });

    t.eq(store.deleteCategory('food').ok, false, 'a category in use is not deleted on a bare request');
    t.eq(store.deleteCategory('food').reason, 'no-mode', 'the caller must say what happens to the records');
    t.eq(store.deleteCategory('food', { mode: 'reassign', toId: 'salary' }).reason, 'kind-mismatch',
      'and cannot reassign expenses into an income category');
    t.eq(store.archiveCategory('food').ok, true, 'archiving keeps the history and is always available');
    t.eq(store.categoryById('food').archived, true, 'the category is archived, not gone');
    t.eq(store.countTransactionsIn('food'), 1, 'and its transaction is still there');

    t.eq(store.deleteCategory('health').ok, true, 'an unused category is deleted outright');
    t.eq(store.categoryById('health'), null, 'and is gone');

    t.eq(store.deleteCategory('food', { mode: 'reassign', toId: 'groceries' }).ok, true, 'reassign is allowed when asked for explicitly');
    t.eq(store.countTransactionsIn('groceries'), 1, 'and the transaction moved rather than vanishing');

    t.eq(store.deleteAccount('cash').reason, 'no-mode', 'an account in use needs the same explicit choice');
    t.eq(store.deleteAccount('card').ok, true, 'an unused account is deleted outright');
    t.eq(store.deleteAccount('cash', { mode: 'reassign', toId: 'bank' }).ok, true, 'reassigning an account is allowed when asked for');
    t.eq(store.getState().data.transactions[0].accountId, 'bank', 'and the transaction moved with it');
    t.eq(store.getState().data.settings.defaultAccountId, 'bank', 'the default account follows, never dangling');

    store.flush();
  }

  t.group('A future schema is never silently overwritten');

  {
    const written = JSON.stringify({ schemaVersion: 3, transactions: [], accounts: [], categories: [] });
    const backend = fakeStorage({ 'heft:v1': written });

    t.eq(migrate(JSON.parse(written)).ok, false, 'a v3 blob does not migrate');
    t.eq(migrate(JSON.parse(written)).reason, 'future-schema', 'and the reason is nameable, so the UI can say it');

    const store = createStore({ backend, now: () => TODAY });
    const snap = store.init();
    t.eq(snap.ui.loadWarning, 'future-schema', 'the store surfaces it as a visible warning');
    t.eq(snap.ui.readOnly, true, 'and locks itself rather than working from defaults');

    t.eq(store.addTransaction({ direction: 'expense', amountPaise: 100, date: TODAY }).reason, 'read-only',
      'no transaction can be added over data we cannot read');
    t.eq(store.addAccount({ name: 'Wallet' }).reason, 'read-only', 'nor an account');
    t.eq(store.clearAll().reason, 'read-only', 'nor can the ledger be cleared');
    t.eq(store.setSetting('theme', 'dark').reason, 'read-only', 'nor a setting written');

    store.flush();
    t.eq(backend.getItem('heft:v1'), written, 'the stored bytes are untouched');
  }

  /* ========================================================= periods === */
  t.group('Periods — every view mode resolves to a range');

  {
    t.deepEq(
      periodRange('daily', '2025-08-13'),
      { start: '2025-08-13', end: '2025-08-13', label: '13 August 2025' },
      'daily is one day',
    );
    t.deepEq(
      periodRange('monthly', '2025-08-13'),
      { start: '2025-08-01', end: '2025-08-31', label: 'August 2025' },
      'monthly is the calendar month',
    );
    t.deepEq(
      periodRange('yearly', '2025-08-13'),
      { start: '2025-01-01', end: '2025-12-31', label: '2025' },
      'yearly is the calendar year',
    );
    t.eq(periodRange('6-month', '2025-08-13').start, '2025-03-01', 'a 6-month window is the six months ending here');
    t.eq(periodRange('6-month', '2025-08-13').end, '2025-08-31', 'and ends with the anchor’s month');
    t.eq(periodRange('6-month', '2025-08-13').label, 'March – August 2025', 'a shared year is mentioned once');

    t.eq(periodRange('nonsense', '2025-08-13'), null, 'an unknown view mode is null, not a wrong range');
    t.eq(periodRange('monthly', 'not-a-date'), null, 'an unreal anchor is null too');
    t.eq(periodRange('monthly', '2025-02-30'), null, 'and so is a date that never happened');
  }

  t.group('Periods — a week straddling a month boundary');

  {
    // 2025-08-01 is a Friday, so its Monday-start week begins in July.
    const week = periodRange('weekly', '2025-08-01', 1);
    t.eq(week.start, '2025-07-28', 'the week starts in the previous month');
    t.eq(week.end, '2025-08-03', 'and ends in the next one');
    t.eq(diffDays(week.start, week.end) + 1, 7, 'a week is seven days wherever it falls');
    t.eq(week.label, '28 July – 3 August 2025', 'the label names both months');

    const sunday = periodRange('weekly', '2025-08-01', 0);
    t.eq(sunday.start, '2025-07-27', 'a Sunday-start week starts a day earlier');
    t.eq(sunday.end, '2025-08-02', 'and ends a day earlier');

    // A week can straddle a year boundary too, which is the harder case.
    const newYear = periodRange('weekly', '2026-01-01', 1);
    t.eq(newYear.start, '2025-12-29', 'a week can start in the previous year');
    t.eq(newYear.end, '2026-01-04', 'and end in the next');
    t.eq(newYear.label, '29 December 2025 – 4 January 2026', 'and says both years');

    // The week containing a Monday starts on that Monday.
    t.eq(periodRange('weekly', '2025-08-11', 1).start, '2025-08-11', 'a Monday opens its own week');
    t.eq(periodRange('weekly', '2025-08-11', 1).end, '2025-08-17', 'which closes on the Sunday');
    t.eq(periodRange('weekly', '2025-08-11', 1).label, '11–17 August 2025', 'one month, named once');
  }

  t.group('Periods — a 3-month window crossing a year boundary');

  {
    const q = periodRange('3-month', '2026-01-15');
    t.eq(q.start, '2025-11-01', 'the window reaches back into the previous year');
    t.eq(q.end, '2026-01-31', 'and ends with the anchor month');
    t.eq(q.label, 'November 2025 – January 2026', 'the label carries both years');
    t.eq(diffDays(q.start, q.end) + 1, 30 + 31 + 31, 'the day count is the three real months');

    const half = periodRange('6-month', '2026-02-10');
    t.eq(half.start, '2025-09-01', 'a 6-month window crosses the boundary the same way');
    t.eq(half.end, '2026-02-28', 'and ends on a real last day');
  }

  t.group('Periods — February, leap and otherwise');

  {
    t.eq(periodRange('monthly', '2024-02-10').end, '2024-02-29', 'February 2024 has 29 days');
    t.eq(diffDays('2024-02-01', periodRange('monthly', '2024-02-10').end) + 1, 29, 'and the range is 29 days long');
    t.eq(periodRange('monthly', '2025-02-10').end, '2025-02-28', 'February 2025 has 28');
    t.eq(diffDays('2025-02-01', periodRange('monthly', '2025-02-10').end) + 1, 28, 'and the range is 28 days long');
    t.eq(periodRange('monthly', '1900-02-10').end, '1900-02-28', '1900 is not a leap year');
    t.eq(periodRange('monthly', '2000-02-10').end, '2000-02-29', 'but 2000 is');

    const leapYear = periodRange('yearly', '2024-02-29');
    t.eq(diffDays(leapYear.start, leapYear.end) + 1, 366, 'a leap year is 366 days');
    t.eq(diffDays(periodRange('yearly', '2025-01-01').start, periodRange('yearly', '2025-01-01').end) + 1, 365,
      'an ordinary year is 365');
    t.deepEq(
      periodRange('daily', '2024-02-29'),
      { start: '2024-02-29', end: '2024-02-29', label: '29 February 2024' },
      'the leap day is a period of its own',
    );
  }

  t.group('Periods — the last day of a 31-day month');

  {
    const day = periodRange('daily', '2025-08-31');
    t.eq(day.start, '2025-08-31', 'the last day starts on itself');
    t.eq(day.end, '2025-08-31', 'and ends on itself');

    const month = periodRange('monthly', '2025-08-31');
    t.eq(month.start, '2025-08-01', 'anchoring on the 31st still gives the whole month');
    t.eq(month.end, '2025-08-31', 'ending exactly on the 31st');

    const week = periodRange('weekly', '2025-08-31', 1);
    t.eq(week.start, '2025-08-25', 'the week containing the 31st starts on the Monday');
    t.eq(week.end, '2025-08-31', 'and ends on the 31st, a Sunday');

    // Stepping off the 31st must land on a day that exists.
    t.eq(stepAnchor('monthly', '2025-08-31', 1), '2025-09-30', 'stepping into a 30-day month clamps the day');
    t.eq(stepAnchor('monthly', '2025-01-31', 1), '2025-02-28', 'and into February clamps harder');
    t.eq(stepAnchor('monthly', '2024-01-31', 1), '2024-02-29', 'correctly, in a leap year');
    t.eq(periodRange('monthly', stepAnchor('monthly', '2025-08-31', 1)).end, '2025-09-30',
      'and the clamped anchor still yields the whole next month');
    t.eq(stepAnchor('daily', '2025-08-31', 1), '2025-09-01', 'a daily step rolls over the boundary');
    t.eq(stepAnchor('weekly', '2025-08-31', -1), '2025-08-24', 'a weekly step is seven days');
    t.eq(stepAnchor('3-month', '2026-01-15', -1), '2025-10-15', 'a 3-month step moves three months');

    const series = periodsEndingAt('monthly', '2025-08-13', 3);
    t.eq(series.length, 3, 'a series of periods comes back in full');
    t.eq(series[0].start, '2025-06-01', 'oldest first');
    t.eq(series[2].end, '2025-08-31', 'ending with the anchor’s period');
  }

  /* ====================================================== carry-over === */
  t.group('Carry-over across three consecutive periods');

  {
    const periods = [
      { label: 'June', incomePaise: 6000000, expensePaise: 4500000 },
      { label: 'July', incomePaise: 6000000, expensePaise: 7000000 },
      { label: 'August', incomePaise: 6000000, expensePaise: 5000000 },
    ];
    const rolled = carryOver(periods);

    t.eq(rolled[0].openingPaise, 0, 'THE FIRST PERIOD OPENS AT ZERO: there is no earlier period to inherit from');
    t.eq(rolled[0].netPaise, 1500000, 'the first period’s surplus is its own income minus expense');
    t.eq(rolled[0].closingPaise, 1500000, 'and its closing figure is opening plus net');

    t.eq(rolled[1].openingPaise, 1500000, 'the second period opens on the first one’s closing figure');
    t.eq(rolled[1].netPaise, -1000000, 'a period can run a deficit');
    t.eq(rolled[1].closingPaise, 500000, 'which eats into the carried surplus without going negative here');

    t.eq(rolled[2].openingPaise, 500000, 'the third opens on the second’s closing figure');
    t.eq(rolled[2].closingPaise, 1500000, 'and the surplus compounds along the chain');

    t.eq(
      rolled.at(-1).closingPaise,
      periods.reduce((n, p) => n + p.incomePaise - p.expensePaise, 0),
      'the final closing figure equals the lifetime surplus computed independently',
    );

    // The first-period case, stated explicitly rather than assumed.
    t.eq(carryOver([]).length, 0, 'no periods carries nothing');
    t.eq(carryOver([periods[0]])[0].openingPaise, 0, 'a lone period opens at zero');
    t.eq(
      carryOver(periods, { openingPaise: 2500000 })[0].openingPaise,
      2500000,
      'a caller that knows the true starting figure passes it in',
    );
    t.eq(
      carryOver(periods, { openingPaise: 2500000 }).at(-1).closingPaise,
      1500000 + 2500000,
      'and it carries all the way through',
    );
    t.eq(carryOver(periods, { enabled: false })[1].openingPaise, 0, 'with carry-over off every period opens at zero');
    t.eq(carryOver(periods, { enabled: false })[1].closingPaise, -1000000, 'and stands alone');

    // A month with no data must not break the chain.
    const gapped = carryOver([periods[0], { incomePaise: 0, expensePaise: 0 }, periods[2]]);
    t.eq(gapped[1].netPaise, 0, 'an empty period nets zero');
    t.eq(gapped[1].closingPaise, 1500000, 'and passes its opening straight through');
    t.eq(gapped[2].openingPaise, 1500000, 'so the chain survives the gap');

    // And the invariant that catches a transfer leaking into the chain.
    const months = periodsEndingAt('monthly', '2025-08-13', 3);
    const ledger = [
      income('2025-06-01', 60000, 'salary'), expense('2025-06-04', 45000, 'rent'),
      income('2025-07-01', 60000, 'salary'), expense('2025-07-04', 70000, 'rent'),
      income('2025-08-01', 60000, 'salary'), expense('2025-08-04', 50000, 'rent'),
    ];
    const plain = carryOverSeries(ledger, months);
    const moved = carryOverSeries([...ledger, transfer('2025-07-15', 25000, 'bank', 'cash')], months);
    const money = (rows) => rows.map(
      (r) => [r.openingPaise, r.incomePaise, r.expensePaise, r.netPaise, r.closingPaise],
    );
    t.deepEq(money(moved), money(plain), 'inserting a transfer changes no figure anywhere in the carry-over chain');
    t.eq(moved[1].transferCount, 1, 'though the period still knows the transfer happened');
    t.eq(plain.at(-1).closingPaise, 1500000, 'the chain agrees with the hand-computed figure');
  }

  t.group('Analytics — period comparison and range-based budgets');

  {
    const ledger = [
      expense('2025-07-05', 1000, 'food'),
      expense('2025-08-05', 1500, 'food'),
      income('2025-08-06', 9000, 'salary'),
      transfer('2025-08-07', 5000, 'bank', 'cash'),
    ];
    const cmp = periodComparison(ledger, 'monthly', '2025-08-13');
    t.eq(cmp.current.expensePaise, 150000, 'the current period’s expense');
    t.eq(cmp.previous.expensePaise, 100000, 'the previous period’s expense');
    t.eq(cmp.deltaPaise, 50000, 'the delta between them');
    t.eq(cmp.deltaPercent, 50, 'as a percentage');
    t.eq(cmp.direction, 'up', 'and a direction');
    t.eq(cmp.current.incomePaise, 900000, 'income is reported alongside, never folded in');

    const q = periodRange('3-month', '2025-08-13');
    const report = budgetReportForRange(ledger, ALL_CATEGORIES.map(
      (c) => ({ ...c, budgetPaise: c.id === 'food' ? 500000 : null }),
    ), q, TODAY);
    t.eq(report.totalPaise, 250000, 'a range-based report sums the whole window');
    t.eq(report.overall.spentPaise, 250000, 'budgeted spend across the range');
    t.eq(report.overall.budgetPaise, 500000, 'against the budgeted money');
    t.eq(report.overall.daysInPeriod, 30 + 31 + 31, 'paced over the real length of the range');
    t.ok(
      report.rows.every((r) => ALL_CATEGORIES.find((c) => c.id === r.categoryId).kind === 'expense'),
      'income categories are not given budgets to miss',
    );

    // A refund filed as income must not pay down a budget.
    const refunded = [...ledger, income('2025-08-08', 1200, 'refunds')];
    t.eq(
      budgetReportForRange(refunded, ALL_CATEGORIES.map(
        (c) => ({ ...c, budgetPaise: c.id === 'food' ? 500000 : null }),
      ), q, TODAY).overall.spentPaise,
      250000,
      'income never reduces what a budget has spent',
    );
  }

  t.group('The weight scale never sees mixed kinds');

  {
    const ledger = [
      expense('2025-08-01', 30, 'food'),
      expense('2025-08-01', 250, 'food'),
      expense('2025-08-02', 1200, 'groceries'),
      expense('2025-08-03', 30000, 'rent'),
    ];
    const before = ledgerWeightScale(ledger);
    const rowsBefore = ledger.map((e) => before.t(e).toFixed(3));

    const polluted = [...ledger, income('2025-08-04', 50000, 'salary'), transfer('2025-08-05', 20000, 'bank', 'cash')];
    const after = ledgerWeightScale(polluted);
    const rowsAfter = ledger.map((e) => after.t(e).toFixed(3));

    t.deepEq(
      rowsAfter,
      rowsBefore,
      'a ₹50,000 salary in the visible set leaves every expense row’s weight untouched',
    );
    t.eq(after.t(polluted[5]), 0.5, 'a transfer takes the neutral middle weight: it is money you still have');
    t.eq(
      after.t(polluted[4]),
      0.5,
      'a lone income record sits mid-scale on its own independent scale',
    );

    const twoIncomes = ledgerWeightScale([...ledger, income('2025-08-04', 50000), income('2025-08-05', 500)]);
    t.eq(twoIncomes.t({ kind: 'transaction', direction: 'income', amountPaise: 5000000 }), 1,
      'the larger of two income records is the heaviest income row');
    t.deepEq(
      ledger.map((e) => twoIncomes.t(e).toFixed(3)),
      rowsBefore,
      'and the expense scale is still untouched by either of them',
    );
  }

  /* ======================================================= migration === */
  t.group('Migration — a realistic v1 ledger becomes valid v2');

  {
    // A v1 blob as the shipped build would actually have written it: a custom
    // category, a budget, every payment method, notes, and an unrecorded method.
    const v1 = {
      schemaVersion: 1,
      categories: [
        ...SEED_CATEGORIES.map((c) => {
          const { kind, archived, ...v1shape } = c;
          return c.id === 'food' ? { ...v1shape, budgetPaise: 1200000 } : { ...v1shape };
        }),
        { id: 'pets', name: 'Pets', colorToken: 'cat-3', budgetPaise: 300000, icon: 'dot' },
      ],
      settings: { theme: 'dark', weekStartsOn: 1, defaultCategoryId: 'food' },
      expenses: [
        { id: 'v1-1', amountPaise: 25050, date: '2025-06-01', categoryId: 'food', note: 'Swiggy', createdAt: '2025-06-01T10:00:00.000Z', paymentMethod: 'upi' },
        { id: 'v1-2', amountPaise: 3000000, date: '2025-06-01', categoryId: 'rent', note: 'Flat rent', createdAt: '2025-06-01T11:00:00.000Z', paymentMethod: 'upi' },
        { id: 'v1-3', amountPaise: 64900, date: '2025-06-03', categoryId: 'entertainment', note: 'Netflix', createdAt: '2025-06-03T09:00:00.000Z', paymentMethod: 'card' },
        { id: 'v1-4', amountPaise: 4500, date: '2025-06-04', categoryId: 'food', note: '', createdAt: '2025-06-04T09:00:00.000Z', paymentMethod: 'cash' },
        { id: 'v1-5', amountPaise: 189900, date: '2025-06-08', categoryId: 'groceries', note: 'D-Mart', createdAt: '2025-06-08T18:00:00.000Z', paymentMethod: 'card' },
        { id: 'v1-6', amountPaise: 12000, date: '2025-07-02', categoryId: 'transport', note: 'Auto', createdAt: '2025-07-02T08:00:00.000Z' },
        { id: 'v1-7', amountPaise: 899900, date: '2025-07-14', categoryId: 'shopping', note: 'Headphones', createdAt: '2025-07-14T20:00:00.000Z', paymentMethod: 'card' },
        { id: 'v1-8', amountPaise: 7500, date: '2025-07-21', categoryId: 'pets', note: 'Cat food', createdAt: '2025-07-21T12:00:00.000Z', paymentMethod: 'cash' },
        { id: 'v1-9', amountPaise: 55000, date: '2025-08-02', categoryId: 'health', note: 'Pharmacy', createdAt: '2025-08-02T16:00:00.000Z', paymentMethod: 'upi' },
        { id: 'v1-10', amountPaise: 1, date: '2025-08-11', categoryId: 'other', note: 'One paisa, on purpose', createdAt: '2025-08-11T16:00:00.000Z' },
      ],
    };

    const before = v1.expenses.reduce((n, e) => n + e.amountPaise, 0);
    const result = migrate(v1);
    const v2 = result.data;
    const after = v2.transactions.reduce((n, t2) => n + t2.amountPaise, 0);

    t.eq(result.ok, true, 'a realistic v1 ledger migrates');
    t.eq(v2.schemaVersion, 2, 'and comes out as v2');
    t.eq(v2.transactions.length, v1.expenses.length, 'no record is lost');
    t.eq(after, before, 'and the total is identical to the paisa, before and after');
    t.eq(
      JSON.stringify(v2.transactions.map((x) => x.amountPaise)),
      JSON.stringify(v1.expenses.map((e) => e.amountPaise)),
      'every individual amount is byte-identical, in the same order',
    );
    t.deepEq(
      v2.transactions.map((x) => x.id),
      v1.expenses.map((e) => e.id),
      'every id survives',
    );
    t.deepEq(
      v2.transactions.map((x) => x.date),
      v1.expenses.map((e) => e.date),
      'and every date',
    );
    t.deepEq(
      v2.transactions.map((x) => x.categoryId),
      v1.expenses.map((e) => e.categoryId),
      'and every category, including a user-made one',
    );

    t.ok(v2.transactions.every((x) => x.kind === 'transaction'), 'every v1 record is a transaction');
    t.ok(v2.transactions.every((x) => x.direction === 'expense'), 'and every one is an expense');
    t.ok(v2.transactions.every((x) => x.toAccountId === null), 'none of them is a transfer');
    t.ok(v2.transactions.every((x) => x.amountPaise > 0), 'and every amount is still positive');
    t.ok(v2.transactions.every((x) => !('paymentMethod' in x)), 'the v1 payment method field is gone from the record');

    t.ok(v2.accounts.some((a) => a.id === 'cash'), 'a default Cash account is created');
    t.eq(v2.accounts.find((a) => a.id === 'cash').openingBalancePaise, 0,
      'with a zero opening balance, which is honest rather than invented');
    t.ok(v2.accounts.some((a) => a.id === 'card'), 'a Card account is created, because a card is an account type');
    t.eq(v2.transactions.find((x) => x.id === 'v1-3').accountId, 'card', 'card spending is mapped onto it');
    t.eq(v2.transactions.find((x) => x.id === 'v1-4').accountId, 'cash', 'cash spending onto Cash');
    t.eq(v2.transactions.find((x) => x.id === 'v1-6').accountId, 'cash', 'an unrecorded method onto Cash');
    t.eq(v2.transactions.find((x) => x.id === 'v1-1').accountId, 'cash',
      'UPI is a rail, not an account type, so it is not guessed at');
    t.eq(v2.transactions.find((x) => x.id === 'v1-1').note, 'Swiggy (UPI)',
      'it goes into the note instead, where it stays visible and correctable');
    t.eq(v2.transactions.find((x) => x.id === 'v1-9').note, 'Pharmacy (UPI)', 'consistently');

    t.ok(v2.categories.filter((c) => c.kind === 'expense').length >= 10, 'every v1 category survives');
    t.ok(v2.categories.every((c) => c.kind === 'expense' || c.kind === 'income'), 'every category is tagged with a kind');
    t.ok(v2.categories.find((c) => c.id === 'pets').kind === 'expense', 'a user-made v1 category becomes an expense one');
    t.eq(v2.categories.find((c) => c.id === 'food').budgetPaise, 1200000, 'budgets are carried over untouched');

    const incomeNames = v2.categories.filter((c) => c.kind === 'income').map((c) => c.name);
    t.deepEq(
      incomeNames,
      ['Salary', 'Refunds', 'Returns', 'Interest & Dividends', 'Gifts', 'Other Income'],
      'the default income category set is seeded',
    );

    t.eq(v2.settings.schemaVersion, 2, 'settings carry the new version');
    t.eq(v2.settings.theme, 'dark', 'a v1 setting the user chose survives');
    t.eq(v2.settings.defaultAccountId, 'cash', 'there is a default account to add against');
    t.eq(v2.settings.defaultExpenseCategoryId, 'food', 'the v1 default category becomes the expense default');
    t.eq(v2.settings.defaultIncomeCategoryId, 'other-income', 'and income gets its own default');
    t.eq(v2.settings.viewMode, 'monthly', 'the period model gets a starting mode');
    t.eq(v2.settings.carryOver, false, 'carry-over starts off, so no figure changes without being asked for');

    // The migrated ledger has to be usable, not merely well-shaped.
    t.eq(expenseTotalPaise(v2.transactions), before, 'the v2 expense total equals the v1 total exactly');
    t.eq(incomeTotalPaise(v2.transactions), 0, 'a migrated v1 ledger has no income, because v1 could not record any');
    t.eq(
      netWorthPaise(v2.accounts, v2.transactions),
      -before,
      'with zero opening balances every migrated balance is negative — the Accounts tab must say so, not pretend',
    );
    t.ok(
      v2.transactions.every((x) => validateTransaction(x, makeValidationContext(v2))),
      'every migrated record passes v2 validation',
    );

    // normalise() runs at the end of every migration and rebuilds each record
    // field by field. If it were not v2-aware it would strip what was just added.
    const renormalised = normalise(v2);
    t.deepEq(renormalised.transactions, v2.transactions, 'normalise is v2-aware and strips nothing it just gained');
    t.eq(renormalised.accounts.length, v2.accounts.length, 'including the accounts');
    t.ok(
      migrateV1toV2(v1).transactions.every((x) => x.kind && x.accountId),
      'the migration itself sets the fields normalise then preserves',
    );

    // Round-tripping a v1 export through the import path must do the same.
    const imported = readImport(JSON.stringify(v1));
    t.eq(imported.ok, true, 'a v1 export file imports into v2');
    t.eq(imported.state.transactions.length, v1.expenses.length, 'with every record');
    t.eq(
      imported.state.transactions.reduce((n, x) => n + x.amountPaise, 0),
      before,
      'and the same total to the paisa',
    );
  }

  t.group('Migration — a v2 blob from a newer build fails safe');

  {
    const v3 = {
      schemaVersion: 3,
      transactions: [{ id: 'a', amountPaise: 100, date: '2025-08-01', someFutureField: true }],
      accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
      categories: ALL_CATEGORIES.map((c) => ({ ...c })),
      settings: {},
    };

    t.eq(migrate(v3).ok, false, 'a schemaVersion 3 blob does not migrate');
    t.eq(migrate(v3).reason, 'future-schema', 'it is refused by name, not by crashing');
    t.eq(migrate(v3).data, undefined, 'and no data is handed back to be written');
    t.eq(parseState(JSON.stringify(v3)).ok, false, 'parsing reports the failure');
    t.eq(parseState(JSON.stringify(v3)).reason, 'future-schema', 'with the reason the UI can render');
    t.deepEq(
      parseState(JSON.stringify(v3)).state,
      defaultState(),
      'and falls back to defaults in memory rather than a half-read state',
    );
    t.eq(readImport(JSON.stringify(v3)).reason, 'future-schema', 'importing such a file is refused too');

    // The fallback is only safe because nothing then writes over the original.
    const backend = fakeStorage({ 'heft:v1': JSON.stringify(v3) });
    const store = createStore({ backend, now: () => TODAY });
    store.init();
    store.addTransaction({ direction: 'expense', amountPaise: 100, date: TODAY });
    store.flush();
    t.eq(
      JSON.parse(backend.getItem('heft:v1')).schemaVersion,
      3,
      'the newer payload is still on disk, unchanged',
    );
  }
}
