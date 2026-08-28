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
  monthKey, startOfMonth, today,
} from '../lib/dates.js';
import { parseQuickAdd, tokenize } from '../lib/parse.js';
import {
  budgetReport, byCategory, dailySpendStats, dailyTotals, dailyTotalsBetween,
  groupByDay, mean, median, monthDelta, monthOverMonth, niceTicks, pace,
  percentile, projectMonthEnd, rollingAverage, topExpenses, totalPaise,
  weightScale,
} from '../lib/analytics.js';
import {
  donutRingPath, donutSegments, linePath, polarToCartesian,
} from '../lib/geometry.js';
import {
  CURRENT_SCHEMA_VERSION, SEED_CATEGORIES, canDeleteCategory, countExpensesIn,
  defaultState, dropExpensesIn, loadState, makeCategoryId, migrate, parseState,
  reassignExpenses, saveState, validateExpense,
} from '../lib/storage.js';
import {
  EXPORT_FORMAT, buildExport, clearedState, exportFilename, mergeStates,
  readImport, replaceWith, summariseImport,
} from '../lib/transfer.js';
import {
  DEFAULT_FILTERS, applyFilters, describeFilters, filtersToHash,
  hasNarrowingFilters, parseFilterHash,
} from '../lib/filters.js';
import { generateSampleExpenses, mulberry32 } from '../lib/sample-data.js';

/* ------------------------------------------------------------- fixtures */

const CATEGORIES = SEED_CATEGORIES.map((c) => ({ ...c }));
const TODAY = '2025-08-13';
const CTX = { categories: CATEGORIES, today: TODAY, defaultCategoryId: 'other' };

let seq = 0;
function expense(date, rupees, categoryId = 'other', extra = {}) {
  seq += 1;
  return {
    id: `e${seq}`,
    amountPaise: Math.round(rupees * 100),
    date,
    categoryId,
    note: '',
    createdAt: `2025-01-01T00:00:${String(seq % 60).padStart(2, '0')}.000Z`,
    ...extra,
  };
}

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
    const list = [
      expense('2025-08-01', 100, 'food', { paymentMethod: 'upi', note: 'chai at work' }),
      expense('2025-08-02', 200, 'transport', { paymentMethod: 'cash', note: 'auto' }),
      expense('2025-08-03', 300, 'food', { paymentMethod: 'card', note: 'Swiggy' }),
      expense('2025-07-30', 400, 'food', { paymentMethod: 'upi', note: 'chai' }),
    ];

    t.eq(applyFilters(list, DEFAULT_FILTERS).length, 4, 'default filters keep everything');
    t.eq(applyFilters(list, { month: '2025-08' }).length, 3, 'month filter');
    t.eq(applyFilters(list, { categoryIds: ['food'] }).length, 3, 'category filter');
    t.eq(applyFilters(list, { categoryIds: ['food', 'transport'] }).length, 4, 'category multi-select is OR');
    t.eq(applyFilters(list, { methods: ['upi'] }).length, 2, 'payment method filter');
    t.eq(applyFilters(list, { query: 'chai' }).length, 2, 'note search');
    t.eq(applyFilters(list, { query: 'SWIGGY' }).length, 1, 'note search is case-insensitive');
    t.eq(applyFilters(list, { query: '  chai  ' }).length, 2, 'note search trims');
    t.eq(applyFilters(list, { query: 'nothing here' }).length, 0, 'a search can match nothing');

    t.eq(
      applyFilters(list, { month: '2025-08', categoryIds: ['food'], methods: ['upi'] }).length,
      1,
      'filters compose with AND across kinds',
    );
    t.eq(applyFilters([], { query: 'x' }).length, 0, 'filtering nothing returns nothing');

    const noMethod = [expense('2025-08-01', 100, 'food')];
    t.eq(applyFilters(noMethod, { methods: ['upi'] }).length, 0, 'an unrecorded method matches no method filter');

    t.eq(hasNarrowingFilters({ ...DEFAULT_FILTERS, month: '2025-08' }), false, 'a month alone is not narrowing');
    t.eq(hasNarrowingFilters({ ...DEFAULT_FILTERS, query: 'a' }), true, 'a query narrows');
    t.eq(hasNarrowingFilters({ ...DEFAULT_FILTERS, query: '   ' }), false, 'whitespace does not narrow');
  }

  t.group('Filters — URL round trip');

  {
    const full = {
      month: '2025-08', categoryIds: ['food', 'rent'], methods: ['upi'], query: 'chai',
    };
    t.eq(
      decodeURIComponent(filtersToHash(full, 'all')),
      '#month=2025-08&cat=food,rent&pay=upi&q=chai',
      'filters serialise to a readable hash',
    );
    t.deepEq(parseFilterHash(filtersToHash(full, 'all')), full, 'hash round trips');
    t.eq(filtersToHash(DEFAULT_FILTERS, 'all'), '', 'defaults produce an empty hash');
    t.eq(filtersToHash({ ...DEFAULT_FILTERS, month: '2025-08' }, '2025-08'), '', 'the default month is omitted');

    t.deepEq(parseFilterHash(''), DEFAULT_FILTERS, 'an empty hash is the default');
    t.deepEq(parseFilterHash(undefined), DEFAULT_FILTERS, 'a missing hash does not throw');
    t.eq(parseFilterHash('#month=nonsense').month, 'all', 'a bad month is ignored');
    t.eq(parseFilterHash('#month=all').month, 'all', 'month=all is honoured');
    t.eq(parseFilterHash('#cat=').categoryIds.length, 0, 'an empty list parses to no ids');
    t.eq(parseFilterHash('#garbage').query, '', 'unrecognised keys are ignored');
    t.eq(
      parseFilterHash('#cat=food', { month: '2025-08' }).month,
      '2025-08',
      'the fallback fills in what the hash omits',
    );

    const cats = { food: { name: 'Food & Dining' }, rent: { name: 'Rent & Bills' } };
    t.eq(
      describeFilters(full, cats),
      'Food & Dining, Rent & Bills · upi · notes containing “chai”',
      'filters describe themselves for the empty state',
    );
    t.eq(describeFilters(DEFAULT_FILTERS, cats), '', 'nothing active describes as nothing');
  }

  /* ===================================================== sample data === */
  t.group('Sample data');

  {
    let n = 0;
    const makeId = () => `s${(n += 1)}`;
    const opts = { today: '2025-08-13', makeId, months: 3, seed: 7 };
    const first = generateSampleExpenses(opts);
    n = 0;
    const second = generateSampleExpenses(opts);

    t.deepEq(first, second, 'the same seed produces the same ledger');
    t.ok(first.length > 100, `three months generates a full ledger (${first.length} expenses)`);

    const ids = new Set(SEED_CATEGORIES.map((c) => c.id));
    t.ok(first.every((e) => Number.isSafeInteger(e.amountPaise) && e.amountPaise > 0), 'every amount is a positive integer');
    t.ok(first.every((e) => isValid(e.date)), 'every date is a real calendar day');
    t.ok(first.every((e) => e.date <= '2025-08-13'), 'nothing is dated in the future');
    t.ok(first.every((e) => ids.has(e.categoryId)), 'every category is a real seed category');
    t.ok(first.every((e) => validateExpense(e, ids)), 'every generated record survives validation');
    t.ok(first.some((e) => e.date === '2025-08-13'), 'today is never empty');

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
    t.eq(parseState(null).state.expenses.length, 0, 'a missing key gives an empty ledger');
    t.eq(parseState('[]').ok, false, 'a top-level array is rejected');
    t.eq(defaultState().categories.length, 9, 'nine seed categories');
    t.eq(defaultState().schemaVersion, CURRENT_SCHEMA_VERSION, 'defaults carry the version');
  }

  t.group('Storage — schema versioning');

  {
    const future = { schemaVersion: CURRENT_SCHEMA_VERSION + 1, expenses: [] };
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
    t.eq(up.data.expenses[0].amountPaise, 120050, 'v0 float rupees become integer paise');
    t.eq(up.data.expenses[0].categoryId, 'food', 'v0 category names become ids');
    t.eq(up.data.expenses[0].note, 'lunch', 'v0 notes survive');
    t.eq(up.data.expenses[1].categoryId, 'other', 'an unknown v0 category lands in Other');
    t.eq(up.data.categories.length, 9, 'migration seeds categories');
    t.ok(typeof up.data.expenses[0].createdAt === 'string', 'migration invents a createdAt');
  }

  t.group('Storage — validation');

  {
    const ids = new Set(SEED_CATEGORIES.map((c) => c.id));
    const good = { id: 'x', amountPaise: 100, date: '2025-08-01', categoryId: 'food' };
    t.ok(validateExpense(good, ids), 'a good record validates');
    t.eq(validateExpense({ ...good, amountPaise: 0 }, ids), null, 'a zero amount is rejected');
    t.eq(validateExpense({ ...good, amountPaise: -1 }, ids), null, 'a negative amount is rejected');
    t.eq(validateExpense({ ...good, amountPaise: 1.5 }, ids), null, 'a float amount is rejected');
    t.eq(validateExpense({ ...good, date: '2025-02-30' }, ids), null, 'an unreal date is rejected');
    t.eq(validateExpense({ ...good, id: '' }, ids), null, 'a record with no id is rejected');
    t.eq(validateExpense(null, ids), null, 'null does not throw');
    t.eq(
      validateExpense({ ...good, categoryId: 'ghost' }, ids).categoryId,
      'other',
      'an expense whose category vanished is reassigned, never orphaned',
    );

    const dirty = JSON.stringify({
      schemaVersion: 1,
      categories: [{ id: 'food', name: 'Food & Dining' }],
      expenses: [good, { junk: true }, null, { ...good, id: 'y', date: 'nope' }],
    });
    t.eq(parseState(dirty).state.expenses.length, 1, 'unusable records are dropped, not fatal');
    t.ok(
      parseState(dirty).state.categories.some((c) => c.id === 'other'),
      'Other is always present as a reassignment target',
    );
  }

  t.group('Categories — deleting must not orphan expenses');

  {
    const cats = SEED_CATEGORIES.map((c) => ({ ...c }));
    const list = [
      expense('2025-08-01', 100, 'food'),
      expense('2025-08-02', 200, 'food'),
      expense('2025-08-03', 300, 'transport'),
    ];

    t.eq(countExpensesIn(list, 'food'), 2, 'expenses in a category are counted');
    t.eq(countExpensesIn(list, 'health'), 0, 'an unused category counts zero');

    const moved = reassignExpenses(list, 'food', 'groceries');
    t.eq(countExpensesIn(moved, 'food'), 0, 'reassign empties the old category');
    t.eq(countExpensesIn(moved, 'groceries'), 2, 'reassign fills the new one');
    t.eq(moved.length, list.length, 'reassign never loses an expense');
    t.eq(moved[2].categoryId, 'transport', 'reassign leaves other categories alone');
    t.eq(list[0].categoryId, 'food', 'reassign does not mutate the input');

    const dropped = dropExpensesIn(list, 'food');
    t.eq(dropped.length, 1, 'delete-together removes exactly that category');
    t.eq(countExpensesIn(dropped, 'food'), 0, 'nothing in the deleted category survives');

    t.eq(canDeleteCategory(cats, 'other').ok, false, 'Other cannot be deleted');
    t.eq(canDeleteCategory(cats, 'other').reason, 'protected', 'and says why');
    t.eq(canDeleteCategory(cats, 'food').ok, true, 'an ordinary category can be deleted');
    t.eq(canDeleteCategory(cats, 'ghost').ok, false, 'a category that is not there cannot be deleted');
    t.eq(canDeleteCategory([cats[0]], 'food').ok, false, 'the last category cannot be deleted');

    t.eq(makeCategoryId('Pets', cats), 'pets', 'a new id is a readable slug');
    t.eq(makeCategoryId('Food & Dining', cats), 'food-dining', 'punctuation becomes hyphens');
    t.eq(makeCategoryId('Food', [{ id: 'food' }]), 'food-2', 'a clashing id is suffixed');
    t.eq(makeCategoryId('Food', [{ id: 'food' }, { id: 'food-2' }]), 'food-3', 'suffixes keep counting');
    t.eq(makeCategoryId('!!!', cats), 'category', 'a name with no letters still yields an id');
  }

  /* ======================================================== transfer === */
  t.group('Transfer — export');

  {
    const state = defaultState();
    state.expenses = [expense('2025-08-01', 250, 'food')];
    const payload = buildExport(state, { exportedAt: '2025-08-13T10:00:00.000Z' });

    t.eq(payload.format, EXPORT_FORMAT, 'the export is labelled');
    t.eq(payload.data.schemaVersion, CURRENT_SCHEMA_VERSION, 'the export carries its schema version');
    t.eq(payload.data.expenses.length, 1, 'expenses are exported');
    t.eq(payload.data.categories.length, 9, 'categories are exported');
    t.eq(exportFilename('2025-08-13T10:00:00.000Z'), 'heft-2025-08-13.json', 'the filename is dated');

    const round = readImport(JSON.stringify(payload));
    t.eq(round.ok, true, 'an export imports back');
    t.eq(round.state.expenses.length, 1, 'the round trip keeps the expense');
    t.eq(round.state.expenses[0].amountPaise, 25000, 'the round trip keeps exact paise');
    t.eq(round.exportedAt, '2025-08-13T10:00:00.000Z', 'the export date survives');
  }

  t.group('Transfer — import validation');

  {
    t.eq(readImport('').reason, 'empty-file', 'an empty file is refused');
    t.eq(readImport('   ').reason, 'empty-file', 'a whitespace file is refused');
    t.eq(readImport('{oops').reason, 'malformed-json', 'malformed JSON is refused, not thrown');
    t.eq(readImport('[1,2,3]').reason, 'not-an-object', 'a bare array is refused');
    t.eq(readImport('null').reason, 'not-an-object', 'null is refused');
    t.eq(readImport('{"hello":"world"}').reason, 'not-heft-data', 'unrelated JSON is refused');
    t.eq(readImport(JSON.stringify({ format: EXPORT_FORMAT })).reason, 'no-data', 'an envelope with no data is refused');
    t.eq(
      readImport(JSON.stringify({ schemaVersion: 99, expenses: [] })).reason,
      'future-schema',
      'a file from a newer Heft is refused rather than mangled',
    );

    // A bare state object, e.g. copied straight out of localStorage.
    const bare = readImport(JSON.stringify({
      schemaVersion: 1, expenses: [], categories: SEED_CATEGORIES.map((c) => ({ ...c })), settings: {},
    }));
    t.eq(bare.ok, true, 'a bare state object imports');
    t.eq(bare.exportedAt, null, 'a bare object has no export date');

    // A v0 file migrates on the way in.
    const old = readImport(JSON.stringify({
      expenses: [{ id: 'a', amount: 99.5, date: '2025-08-01', category: 'Food & Dining' }],
    }));
    t.eq(old.ok, true, 'a v0 file imports');
    t.eq(old.state.expenses[0].amountPaise, 9950, 'a v0 file is migrated to integer paise');

    const dirty = readImport(JSON.stringify({
      schemaVersion: 1,
      categories: SEED_CATEGORIES.map((c) => ({ ...c })),
      expenses: [
        { id: 'ok', amountPaise: 100, date: '2025-08-01', categoryId: 'food' },
        { id: 'bad', amountPaise: -5, date: '2025-08-01', categoryId: 'food' },
        null,
      ],
    }));
    t.eq(dirty.state.expenses.length, 1, 'unusable records in a file are dropped, not imported');
  }

  t.group('Transfer — the preview says what will change');

  {
    const current = defaultState();
    current.expenses = [
      expense('2025-08-01', 100, 'food'),
      expense('2025-08-02', 200, 'food'),
    ];
    current.expenses[0].id = 'shared';

    const incoming = defaultState();
    incoming.expenses = [
      { ...expense('2025-08-01', 100, 'food'), id: 'shared' },
      expense('2025-08-05', 500, 'transport'),
      expense('2025-08-06', 600, 'transport'),
    ];
    incoming.categories = [...incoming.categories, {
      id: 'pets', name: 'Pets', colorToken: 'cat-1', budgetPaise: null, icon: 'dot',
    }];

    const summary = summariseImport(current, incoming);
    t.eq(summary.current.expenses, 2, 'the preview counts what you have');
    t.eq(summary.incoming.expenses, 3, 'the preview counts what is in the file');
    t.eq(summary.merge.expensesAdded, 2, 'merge adds only what is new');
    t.eq(summary.merge.expensesSkipped, 1, 'merge reports the duplicate it will skip');
    t.eq(summary.merge.expensesAfter, 4, 'merge reports the resulting total');
    t.eq(summary.merge.expensesRemoved, 0, 'merge removes nothing');
    t.eq(summary.merge.categoriesAdded, 1, 'merge reports the new category');
    t.eq(summary.replace.expensesRemoved, 2, 'replace reports what would be lost');
    t.eq(summary.replace.expensesAfter, 3, 'replace reports the resulting total');

    const merged = mergeStates(current, incoming);
    t.eq(merged.expenses.length, 4, 'merge produces what the preview promised');
    t.eq(
      merged.expenses.filter((e) => e.id === 'shared').length,
      1,
      'a shared id appears exactly once after a merge',
    );
    t.eq(
      merged.expenses.find((e) => e.id === 'shared').amountPaise,
      current.expenses[0].amountPaise,
      'on an id collision the record already on screen wins',
    );
    t.eq(merged.categories.length, 10, 'merge adds the new category');
    t.eq(current.expenses.length, 2, 'merge does not mutate the current state');

    const replaced = replaceWith(current, incoming);
    t.eq(replaced.expenses.length, 3, 'replace produces what the preview promised');
    t.eq(replaced.settings.theme, current.settings.theme, 'replace keeps your theme');

    const cleared = clearedState(current);
    t.eq(cleared.expenses.length, 0, 'clearing empties the ledger');
    t.eq(cleared.categories.length, current.categories.length, 'clearing keeps your categories');
    t.eq(cleared.schemaVersion, CURRENT_SCHEMA_VERSION, 'clearing keeps the schema version');
  }

  t.group('Storage — persistence');

  {
    const backend = fakeStorage();
    const state = defaultState();
    t.eq(saveState(backend, state).ok, true, 'saving works');
    t.deepEq(loadState(backend).state, state, 'a saved state loads back identically');
    t.eq(loadState(fakeStorage()).state.expenses.length, 0, 'an empty backend gives defaults');

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
    t.eq(loadState(hostile).state.expenses.length, 0, 'a blocked backend still yields defaults');
    t.eq(saveState(hostile, state).reason, 'write-failed', 'a non-quota failure is distinguished');
  }
}
