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
  monthKey, monthsInRange, daysOfMonthInRange, periodRange, periodsEndingAt,
  startOfMonth, stepAnchor, today, VIEW_MODES,
} from '../lib/dates.js';
import { parseQuickAdd, tokenize } from '../lib/parse.js';
import { AA_TEXT, contrastRatio, meetsAA, parseHex, ratio2 } from '../lib/contrast.js';
import {
  ANALYSIS_VIEWS, DEFAULT_ROUTE, TABS, VIEW_MODES as ROUTE_VIEW_MODES, anchorOf,
  parseRoute, periodFor, routeToHash, sameRoute,
} from '../lib/router.js';
import { money, netMoney, signedMoney } from '../lib/format.js';
import { ICONS, ICON_NAMES, iconOrFallback } from '../lib/icons.js';
import {
  BUDGET_COLUMNS, TRANSACTION_COLUMNS, budgetsToCsv, csvDocument, csvField,
  csvFilename, csvRow, paiseToDecimal, transactionsToCsv,
} from '../lib/csv.js';
import {
  accountBalance, accountBalances, budgetReport, budgetReportForRange, byCategory,
  carryOver, carryOverSeries, dailySpendStats, dailyTotals, dailyTotalsBetween,
  expenseByCategory, expenseTotalPaise, groupByDay, incomeByCategory,
  incomeTotalPaise, ledgerWeightScale, mean, median, monthDelta, monthOverMonth,
  netPaise, netWorth, netWorthPaise, niceTicks, pace, paceForRange, percentile,
  budgetForRange, budgetState, budgetedCategoryIds, periodComparison,
  periodTotals, projectMonthEnd, rollingAverage, topExpenses, totalPaise,
  VIEWS, viewAmount, weightScale, dailySpendStatsForRange,
} from '../lib/analytics.js';
import {
  donutRingPath, donutSegments, linePath, polarToCartesian,
} from '../lib/geometry.js';
import {
  MAX_SLICES, OTHER_SLICE_ID, barSpanFor, bucketDays, enforceMinShare,
  groupSmallSlices, shadeFor, signedTicks,
} from '../lib/chart.js';
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

  /* The three kinds. `KCTX` is the full context a real quick-add line gets:
     both category sets and the account list, because the kind is what
     decides which of them the line is allowed to match against. */
  const KCTX = {
    categories: ALL_CATEGORIES, accounts: ACCOUNTS, today: TODAY,
    defaultCategoryId: 'other', defaultAccountId: 'cash',
  };

  t.group('Parser — a leading + is income');

  {
    const income = parseQuickAdd('+5000 salary', KCTX);
    t.eq(income.ok, true, "'+5000 salary' parses");
    t.eq(income.kind, 'income', 'a leading + makes it income');
    t.eq(income.amountPaise, 500000, 'the + is stripped before the amount is read');
    t.eq(income.categoryId, 'salary', 'and the category is matched from the INCOME set');
    t.eq(income.note, '', 'the category name is consumed from the note');
    t.eq(income.toAccountId, null, 'income has no destination account');
    t.eq(income.accountId, 'cash', 'income lands in the default account');

    t.eq(parseQuickAdd('+ 5000 salary', KCTX).amountPaise, 500000, 'a detached + works too');
    t.eq(parseQuickAdd('+1.2k refunds', KCTX).amountPaise, 120000, 'suffixes still apply after a +');
    t.eq(parseQuickAdd('+5000 salary yesterday', KCTX).date, '2025-08-12', 'dates still parse');

    // The kind gates which categories exist at all, in both directions.
    const unmarked = parseQuickAdd('5000 salary', KCTX);
    t.eq(unmarked.kind, 'expense', 'without a + it stays an expense');
    t.eq(unmarked.categoryId, 'other', 'and CANNOT match the income category "salary"');
    t.eq(unmarked.note, 'salary', 'the unmatched word survives as the note');

    const marked = parseQuickAdd('+800 chai', KCTX);
    t.eq(marked.kind, 'income', 'a + line is income');
    t.eq(marked.categoryId, 'other', 'an expense synonym does not reach the income set');
  }

  t.group('Parser — "to" between two accounts is a transfer');

  {
    const move = parseQuickAdd('2000 bank to cash', KCTX);
    t.eq(move.ok, true, "'2000 bank to cash' parses");
    t.eq(move.kind, 'transfer', 'two accounts around "to" make a transfer');
    t.eq(move.amountPaise, 200000, 'the amount is read as usual');
    t.eq(move.accountId, 'bank', 'the name before "to" is the source');
    t.eq(move.toAccountId, 'cash', 'the name after it is the destination');
    t.eq(move.categoryId, null, 'A TRANSFER HAS NO CATEGORY: not a default, not a sink');
    t.eq(move.note, '', 'the whole transfer expression is consumed');

    t.eq(parseQuickAdd('2000 bank > cash', KCTX).kind, 'transfer', '> is accepted as a separator');
    t.eq(parseQuickAdd('2000 bank → cash', KCTX).toAccountId, 'cash', 'so is an arrow');
    t.eq(parseQuickAdd('2000 BANK to Cash', KCTX).kind, 'transfer', 'account names are case-insensitive');
    t.eq(parseQuickAdd('bank to cash 2000 yesterday', KCTX).date, '2025-08-12',
      'a transfer still takes a date');

    // "to" is an ordinary English word. It only means transfer when both
    // sides are real accounts — otherwise the line is untouched.
    const gift = parseQuickAdd('250 lunch to mom', KCTX);
    t.eq(gift.kind, 'expense', '"to" between two non-accounts is not a transfer');
    t.eq(gift.note, 'lunch to mom', 'and the whole phrase survives as the note');
    t.eq(parseQuickAdd('500 bank to mom', KCTX).kind, 'expense',
      'one real account is not enough');
    t.eq(parseQuickAdd('500 mom to bank', KCTX).kind, 'expense',
      'in either position');

    // Money cannot move from an account into itself.
    const self = parseQuickAdd('2000 cash to cash', KCTX);
    t.eq(self.ok, false, 'a self-transfer is refused');
    t.eq(self.error, 'same-account', 'with an explicit reason');

    // A transfer outranks the income marker: there is nowhere in a transfer
    // for income to live.
    t.eq(parseQuickAdd('+2000 cash to bank', KCTX).kind, 'transfer',
      'a transfer separator beats the + marker');
  }

  t.group('Parser — when an account and a category share a name');

  {
    /* The ambiguous case, stated as data: a "Card" you spend on and a "Card"
       you pay from. Both exist, both are called Card, and the line has to
       resolve to exactly one of them. */
    const collide = {
      categories: [
        ...ALL_CATEGORIES,
        {
          id: 'card-cat', name: 'Card', kind: 'expense', colorToken: 'cat-9',
          budgetPaise: null, icon: 'other', archived: false,
        },
      ],
      accounts: ACCOUNTS,   // seed accounts include one named 'Card'
      today: TODAY,
      defaultCategoryId: 'other',
      defaultAccountId: 'cash',
    };

    // Documented rule 1: with no separator, account names are never consulted.
    const plain = parseQuickAdd('2000 card', collide);
    t.eq(plain.kind, 'expense', 'without a separator the line is an ordinary expense');
    t.eq(plain.categoryId, 'card-cat', 'THE CATEGORY WINS: accounts are not read here at all');
    t.eq(plain.accountId, 'cash', 'the account stays the default');
    t.eq(plain.note, '', 'and the name is consumed as a category name');

    // Documented rule 2: flanking a separator, the same word is an account.
    const moved = parseQuickAdd('2000 bank to card', collide);
    t.eq(moved.kind, 'transfer', 'the separator makes it a transfer');
    t.eq(moved.toAccountId, 'card', 'THE ACCOUNT WINS on the far side of "to"');
    t.eq(moved.categoryId, null, 'and the same-named category is not consulted');

    t.eq(parseQuickAdd('2000 card to bank', collide).accountId, 'card',
      'the account also wins on the near side');
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
    const cats = [CATEGORIES[0], CATEGORIES[1], CATEGORIES[8]].map((c) => ({ ...c }));
    // The budget is a fact about August, not about the category.
    const budgets = { '2025-08': { food: 1000000 } };
    const list = [
      expense('2025-08-02', 6000, 'food'),
      expense('2025-08-03', 2000, 'groceries'),
      expense('2025-08-04', 1000, 'other'),
    ];
    const report = budgetReport(list, cats, budgets, '2025-08', TODAY);
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

  t.group('Budgets — a monthly plan, read over any period');

  {
    // ₹6,200 for food in August; July deliberately untouched.
    const budgets = { '2025-08': { food: 620000, transport: 0 } };

    const august = periodRange('monthly', '2025-08-13');
    t.eq(budgetForRange(budgets, 'food', august), 620000,
      'a whole month gets exactly its own figure, with no arithmetic to drift by');

    // 11–17 August is 7 of August's 31 days.
    const week = periodRange('weekly', '2025-08-13');
    t.eq(budgetForRange(budgets, 'food', week), Math.round((620000 * 7) / 31),
      'a week gets the share of the month it actually covers');

    const quarter = periodRange('3-month', '2025-08-13');
    t.eq(budgetForRange(budgets, 'food', quarter), 620000,
      'a window over three months adds up the months that are budgeted');

    const july = periodRange('monthly', '2025-07-13');
    t.eq(budgetForRange(budgets, 'food', july), null,
      'a month with no entry is untracked, which is not a budget of zero');
    t.eq(budgetForRange(budgets, 'transport', august), 0,
      'and a budget of zero is a real plan, kept and reported as zero');
    t.eq(budgetForRange(budgets, 'rent', august), null, 'an unbudgeted category is null');

    // A week straddling a month boundary draws on both months.
    const straddle = { start: '2025-07-28', end: '2025-08-03', label: 'straddle' };
    t.deepEq(monthsInRange(straddle), ['2025-07', '2025-08'], 'the range names both months');
    t.eq(daysOfMonthInRange('2025-07', straddle), 4, 'four days fall in July');
    t.eq(daysOfMonthInRange('2025-08', straddle), 3, 'and three in August');
    t.eq(
      budgetForRange({ '2025-07': { food: 310000 }, '2025-08': { food: 620000 } }, 'food', straddle),
      Math.round((310000 * 4) / 31) + Math.round((620000 * 3) / 31),
      'and each month contributes only its own share',
    );

    t.deepEq([...budgetedCategoryIds(budgets, august)].sort(), ['food', 'transport'],
      'the budgeted set is every category budgeted in any month the period covers');
    t.eq(budgetedCategoryIds(budgets, july).size, 0, 'and is empty where nothing is budgeted');
  }

  t.group('Budgets — the three bands, and what is outside them');

  {
    t.eq(budgetState(0, null), 'none', 'no budget is not a state a bar can be drawn in');
    t.eq(budgetState(4000, 10000), 'under', 'well inside is under');
    t.eq(budgetState(8500, 10000), 'near', '85% of the money gone is the warning band');
    t.eq(budgetState(10000, 10000), 'near',
      'spending exactly the budget is not an overrun, but it is not "under" either — '
      + 'there is nothing left, and the bar has to say so');
    t.eq(budgetState(10001, 10000), 'over', 'a paisa past it is');
    t.eq(budgetState(0, 0), 'under', 'a budget of zero, unspent, is met rather than "near"');
    t.eq(budgetState(1, 0), 'over', 'and one paisa against it is over');

    const list = [
      expense('2025-08-02', 6000, 'food'),
      expense('2025-08-03', 2000, 'groceries'),
      expense('2025-08-04', 1000, 'other'),
      income('2025-08-05', 9000, 'salary'),
      transfer('2025-08-06', 4000),
    ];
    const report = budgetReportForRange(
      list, ALL_CATEGORIES, { '2025-08': { food: 1000000 } },
      periodRange('monthly', '2025-08-13'), TODAY,
    );

    t.eq(report.budgeted.length, 1, 'one category is budgeted');
    // Every expense category without a budget is listed, spent in or not: the
    // list is both the report of money outside the plan *and* the place a
    // budget gets set, so a category you have not spent in yet has to be
    // reachable. Spend orders it, so the biggest leak reads first.
    t.deepEq(report.unbudgeted.slice(0, 2).map((r) => r.categoryId), ['groceries', 'other'],
      'the money outside the plan is itemised, largest first, never lumped');
    t.eq(report.unbudgeted.length, 8, 'and every other unbudgeted category can still be given one');
    t.ok(report.unbudgeted.slice(2).every((r) => r.spentPaise === 0),
      'the ones with no spend follow rather than leading');
    t.eq(report.unbudgetedPaise, 300000, 'with a total that is never hidden');
    t.eq(
      report.budgetedSpentPaise + report.unbudgetedPaise,
      report.totalPaise,
      'budgeted plus unbudgeted is the whole expense, with nothing counted twice',
    );
    t.eq(report.totalPaise, 900000, 'and neither the income nor the transfer is in it');
    t.ok(
      report.rows.every((r) => ALL_CATEGORIES.find((c) => c.id === r.categoryId).kind === 'expense'),
      'income categories are never given a budget to miss',
    );
  }

  t.group('Budgets — pace, projection, and a period that has already ended');

  {
    const august = periodRange('monthly', '2025-08-13');   // 31 days
    const budget = 3100000;                                // ₹31,000 — ₹1,000 a day

    // 13 August: 13 of 31 days elapsed, so ₹13,000 is exactly on pace.
    const onTrack = paceForRange({
      budgetPaise: budget, spentPaise: 1300000, range: august, today: TODAY,
    });
    t.eq(onTrack.expectedPaise, 1300000,
      'expected spend is the budget times the fraction of the period gone');
    t.eq(onTrack.daysElapsed, 13, 'today counts as elapsed');
    t.eq(onTrack.status, 'on-track', 'and matching it is on track');
    t.eq(onTrack.projectedPaise, budget, 'the projection carries the current rate to the end');

    const ahead = paceForRange({
      budgetPaise: budget, spentPaise: 1500000, range: august, today: TODAY,
    });
    t.eq(ahead.status, 'ahead', 'spending faster than the plan is ahead of pace');
    t.eq(ahead.deltaPaise, 200000, 'by the difference from expected');

    const behind = paceForRange({
      budgetPaise: budget, spentPaise: 1000000, range: august, today: TODAY,
    });
    t.eq(behind.status, 'behind', 'and slower is behind it');

    // A finished period cannot be paced: there is nothing left to predict.
    const july = periodRange('monthly', '2025-07-13');
    const finished = paceForRange({
      budgetPaise: budget, spentPaise: budget + 1, range: july, today: TODAY,
    });
    t.eq(finished.isPast, true, 'a period that has ended knows it');
    t.eq(finished.status, 'over', 'and reports the result rather than a prediction');
    t.eq(finished.daysElapsed, 31, 'with the whole period elapsed');
    t.eq(
      paceForRange({ budgetPaise: budget, spentPaise: budget, range: july, today: TODAY }).status,
      'under',
      'landing exactly on the budget is a period finished under it',
    );
  }

  t.group('Budgets — the store writes them per month, never per category');

  {
    const backend = fakeStorage();
    const store = createStore({ backend, now: () => TODAY });
    store.init();

    t.eq(store.setBudget('2025-08', 'food', 620000).ok, true, 'a budget is set for a month');
    t.eq(store.getState().data.budgets['2025-08'].food, 620000, 'and stored under that month');
    t.eq(store.getState().data.categories.find((c) => c.id === 'food').budgetPaise, undefined,
      'nothing is written back onto the category');

    t.eq(store.setBudget('2025-08', 'salary', 100).reason, 'not-expense',
      'an income category is never given a budget');
    t.eq(store.setBudget('2025-13', 'food', 100).reason, 'bad-month',
      'a month key that is not one is refused');
    t.eq(store.setBudget('2025-08', 'food', -1).reason, 'invalid-amount',
      'so is a negative budget');
    t.eq(store.setBudget('2025-08', 'food', 0).ok, true, 'zero is a real plan and is allowed');

    t.eq(store.clearBudget('2025-08', 'food').ok, true, 'clearing stops tracking');
    t.eq(store.getState().data.budgets['2025-08'], undefined,
      'and a month left empty is dropped rather than kept as an empty object');

    // Copy forward: the affordance that makes budgets survive their first month.
    store.setBudget('2025-07', 'food', 500000);
    store.setBudget('2025-07', 'transport', 200000);
    store.setBudget('2025-08', 'food', 999999);

    const copied = store.copyBudgetsFromPrevious(['2025-08']);
    t.eq(copied.ok, true, 'the previous month can be copied forward');
    t.eq(copied.copied, 1, 'only the categories not already budgeted are copied');
    t.eq(store.getState().data.budgets['2025-08'].food, 999999,
      'a figure already decided for this month is never overwritten by an older one');
    t.eq(store.getState().data.budgets['2025-08'].transport, 200000, 'and the rest come across');
    t.eq(store.copyBudgetsFromPrevious(['2025-08']).reason, 'nothing-to-copy',
      'copying again changes nothing, and says so rather than reporting success');

    // A deleted category takes its budget with it.
    store.setBudget('2025-08', 'health', 100000);
    t.eq(store.deleteCategory('health').ok, true, 'an unused category deletes');
    t.eq(store.getState().data.budgets['2025-08'].health, undefined,
      'and its budget goes too, rather than planning money for nothing');

    store.flush();
    t.eq(
      JSON.parse(backend.getItem('heft:v1')).budgets['2025-08'].transport,
      200000,
      'budgets are persisted with everything else',
    );
  }

  t.group('Budgets — merging a category carries its history and its plan');

  {
    const backend = fakeStorage();
    const store = createStore({ backend, now: () => TODAY });
    store.init();

    const add = (rupees, date, categoryId) => store.addTransaction({
      direction: 'expense', amountPaise: rupees * 100, date, categoryId, accountId: 'cash',
    });
    add(50, '2025-08-02', 'food');
    add(30, '2025-08-03', 'food');
    add(10, '2025-08-04', 'groceries');
    store.setBudget('2025-08', 'food', 400000);
    store.setBudget('2025-08', 'groceries', 100000);

    const before = expenseTotalPaise(store.getState().data.transactions);

    t.eq(store.mergeCategory('food', 'salary').reason, 'kind-mismatch',
      'an expense category cannot be merged into an income one');
    t.eq(store.mergeCategory('food', 'food').reason, 'same-category', 'nor into itself');

    const merged = store.mergeCategory('food', 'groceries');
    t.eq(merged.ok, true, 'a same-kind merge is allowed');
    t.eq(merged.moved, 2, 'and reports how many records moved');
    t.eq(store.countTransactionsIn('food'), 0, 'the source is left holding nothing');
    t.eq(store.countTransactionsIn('groceries'), 3, 'and the target holds everything');
    t.eq(expenseTotalPaise(store.getState().data.transactions), before,
      'no money is created or destroyed by a merge');
    t.eq(store.categoryById('food').archived, true,
      'the source is archived, not deleted, so an older period still resolves its name');
    t.eq(store.getState().data.budgets['2025-08'].groceries, 500000,
      'the two budgets add up rather than one of them quietly disappearing');
    t.eq(store.getState().data.budgets['2025-08'].food, undefined, 'and the source keeps none');

    store.flush();
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

  /* =========================================================== chart === */
  t.group('Chart — the tail of a ranked list becomes one slice');

  {
    const rows = [
      { categoryId: 'rent', totalPaise: 900000 },
      { categoryId: 'food', totalPaise: 60000 },
      { categoryId: 'fuel', totalPaise: 20000 },
      { categoryId: 'chai', totalPaise: 20000 },
    ];
    const { slices, other } = groupSmallSlices(rows);

    t.eq(slices.length, 3, 'the two 2% rows collapse into one slice');
    t.eq(slices[2].categoryId, OTHER_SLICE_ID, 'the grouped slice comes last');
    t.eq(other.totalPaise, 40000, 'and carries exactly the sum of its members');
    t.eq(other.members.length, 2, 'both members are kept, for the list and the table');

    const shareSum = slices.reduce((sum, r) => sum + r.share, 0);
    t.ok(Math.abs(shareSum - 1) < 1e-9, 'the shares still sum to one');
    t.ok(Math.abs(other.share - (other.members[0].share + other.members[1].share)) < 1e-9,
      "and the group's share is its members' shares added up");

    // The refusal that matters: one straggler is named, never hidden behind
    // the word "Other", because the arc is the same size either way.
    const single = groupSmallSlices([
      { categoryId: 'rent', totalPaise: 900000 },
      { categoryId: 'fuel', totalPaise: 2000 },
    ]);
    t.eq(single.other, null, 'a tail of one is left named');
    t.eq(single.slices.length, 2, 'and still drawn as its own slice');

    const many = groupSmallSlices(
      Array.from({ length: 12 }, (_, i) => ({ categoryId: `c${i}`, totalPaise: 10000 })),
    );
    t.eq(many.slices.length, MAX_SLICES + 1, 'a long list is cut to the ring plus one group');
    t.eq(many.other.members.length, 12 - MAX_SLICES, 'everything beyond the cut is in the group');

    t.deepEq(groupSmallSlices([]).slices, [], 'an empty list produces no slices');
    t.eq(groupSmallSlices([{ categoryId: 'a', totalPaise: 0 }]).other, null,
      'a zero total groups nothing rather than dividing by it');
  }

  t.group('Chart — no slice is allowed to disappear');

  {
    const floored = enforceMinShare([100, 1, 1], 0.02);
    const sum = floored.reduce((a, b) => a + b, 0);
    t.ok(Math.abs(sum - 102) < 1e-9, 'the total is preserved exactly, so the ring still closes');
    t.ok(floored.every((v) => v >= 102 * 0.02 - 1e-9), 'every slice clears the minimum arc');
    t.ok(floored[0] < 100, 'the largest slice is the one that gave the sliver up');
    t.ok(floored[0] > floored[1], 'and is still the largest');

    const untouched = enforceMinShare([40, 30, 30], 0.02);
    t.deepEq(untouched, [40, 30, 30], 'values already above the floor are left alone');

    const zeros = enforceMinShare([50, 0, 50], 0.02);
    t.eq(zeros[1], 0, 'a zero takes no arc — it is not a slice at all');

    // A donor pushed under the floor by donating is floored in turn; when
    // that leaves nobody to donate, the honest answer is an equal ring.
    const impossible = enforceMinShare([50, 50, 1], 0.34);
    t.ok(Math.abs(impossible.reduce((a, b) => a + b, 0) - 101) < 1e-9,
      'the total survives even when the floor cannot be met');
    t.ok(Math.abs(impossible[0] - impossible[2]) < 1e-9,
      'and the ring is split equally rather than leaving one slice invisible');

    const crowded = enforceMinShare(new Array(60).fill(1), 0.02);
    t.ok(crowded.every((v) => Math.abs(v - 1) < 1e-9),
      'sixty slices cannot all clear 2%, so they share the ring equally');
  }

  t.group('Chart — long periods are bucketed, not drawn as a picket fence');

  {
    const days = dailyTotalsBetween(
      [expense('2025-08-02', 100), expense('2025-08-09', 50)], '2025-08-01', '2025-08-30',
    );
    t.eq(days.length, 30, 'thirty days in');

    const daily = bucketDays(days, 1);
    t.eq(daily.length, 30, 'a span of one is one bar per day');
    t.eq(daily[1].start, daily[1].end, 'and each bucket is a single date');

    const weekly = bucketDays(days, 7);
    t.eq(weekly.length, 5, 'thirty days make four whole weeks and a short one');
    t.eq(weekly[4].days, 2, 'the short bucket says how short it is');
    t.eq(weekly[0].start, '2025-08-01', 'buckets align to the range, not to the calendar week');
    t.eq(
      weekly.reduce((sum, b) => sum + b.totalPaise, 0),
      days.reduce((sum, d) => sum + d.totalPaise, 0),
      'bucketing moves no money',
    );

    t.eq(barSpanFor(31), 1, 'a month is drawn a day at a time');
    t.eq(barSpanFor(366), 7, 'a year is drawn a week at a time');
  }

  t.group('Chart — a signed axis keeps zero at zero');

  {
    const positive = signedTicks(0, 3847, 4);
    t.deepEq(positive.ticks, niceTicks(3847, 4).ticks,
      'an all-positive series gets exactly the nice-numbers axis');
    t.eq(positive.min, 0, 'and no negative half');

    const both = signedTicks(-300, 500, 4);
    t.eq(both.min, -both.max, 'a signed axis is symmetric, so zero sits on the line');
    t.ok(both.ticks.includes(0), 'zero is a tick');
    t.ok(both.ticks[0] < 0, 'the axis starts below zero');
    const gaps = both.ticks.slice(1).map((v, i) => v - both.ticks[i]);
    t.ok(gaps.every((g) => Math.abs(g - both.step) < 1e-9), 'the step is even across zero');
  }

  t.group('Chart — the value ramp that survives greyscale');

  {
    t.eq(shadeFor(0, 5), 0, 'the largest slice keeps its hue');
    t.eq(shadeFor(0, 1), 0, 'a lone slice is never shaded');
    const ramp = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => shadeFor(i, 8));
    t.ok(ramp.every((v, i) => i === 0 || v > ramp[i - 1]), 'every slice differs from its neighbour');
    t.ok(ramp.every((v) => v <= 54), 'and none is taken so far that the hue is gone');
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
    t.eq(up.data.transactions[0].kind, 'transaction', 'a v0 record chains all the way up');
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
    // A conflict is the one place the two modes disagree, so the preview
    // names it separately from "added" in both directions.
    t.eq(summary.conflicts, 1, 'the preview counts the ids present in both files');
    t.eq(summary.merge.transactionsUpdated, 0, 'merge changes nothing you already have, and says so');
    t.eq(summary.replace.transactionsUpdated, 1, 'replace overwrites the record you share');
    t.eq(summary.replace.transactionsAdded, 2, 'replace adds the two the file has and you do not');
    // Lost, not merely gone from the screen: the shared record is overwritten
    // rather than lost, so it is not counted here. Only the one record that
    // exists here and nowhere in the file actually disappears.
    t.eq(summary.replace.transactionsRemoved, 1, 'replace reports what would be lost for good');
    t.eq(summary.replace.transactionsAfter, 3, 'replace reports the resulting total');
    t.eq(
      summary.replace.transactionsAdded + summary.replace.transactionsUpdated,
      summary.incoming.transactions,
      'every record in the file is either added or overwrites one, with nothing unaccounted for',
    );

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
      budgetReport(
        withMove,
        CATEGORIES,
        { '2025-08': Object.fromEntries(CATEGORIES.map((c) => [c.id, 500000])) },
        '2025-08',
        TODAY,
      ).overall.spentPaise,
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
    const written = JSON.stringify({ schemaVersion: 4, transactions: [], accounts: [], categories: [] });
    const backend = fakeStorage({ 'heft:v1': written });

    t.eq(migrate(JSON.parse(written)).ok, false, 'a v4 blob does not migrate');
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
    // ₹5,000 a month for food, across all three months the window covers.
    const foodBudget = {
      '2025-06': { food: 500000 }, '2025-07': { food: 500000 }, '2025-08': { food: 500000 },
    };
    const report = budgetReportForRange(ledger, ALL_CATEGORIES, foodBudget, q, TODAY);
    t.eq(report.totalPaise, 250000, 'a range-based report sums the whole window');
    t.eq(report.overall.spentPaise, 250000, 'budgeted spend across the range');
    t.eq(report.overall.budgetPaise, 1500000, 'against three months of the monthly figure');
    t.eq(report.overall.daysInPeriod, 30 + 31 + 31, 'paced over the real length of the range');
    t.ok(
      report.rows.every((r) => ALL_CATEGORIES.find((c) => c.id === r.categoryId).kind === 'expense'),
      'income categories are not given budgets to miss',
    );

    // A refund filed as income must not pay down a budget.
    const refunded = [...ledger, income('2025-08-08', 1200, 'refunds')];
    t.eq(
      budgetReportForRange(refunded, ALL_CATEGORIES, foodBudget, q, TODAY).overall.spentPaise,
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
    // `today` is passed, so which month inherits a v1 category budget is a
    // decision the test makes rather than one the clock makes.
    const result = migrate(v1, { today: TODAY });
    const v2 = result.data;
    const after = v2.transactions.reduce((n, t2) => n + t2.amountPaise, 0);

    t.eq(result.ok, true, 'a realistic v1 ledger migrates');
    t.eq(v2.schemaVersion, CURRENT_SCHEMA_VERSION, 'and comes out at the current version');
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
    // A v1 budget applied to every month that ever was. Writing it into all of
    // them would invent a history the user never set, so it lands in the month
    // being migrated in and nowhere else.
    t.eq(v2.budgets['2025-08'].food, 1200000, 'a v1 category budget becomes a budget for this month');
    t.eq(v2.budgets['2025-07'], undefined, 'and not for a month it was never set in');
    t.eq(v2.categories.find((c) => c.id === 'food').budgetPaise, undefined,
      'the field itself is gone, so there is one place a budget can be read from');

    const incomeNames = v2.categories.filter((c) => c.kind === 'income').map((c) => c.name);
    t.deepEq(
      incomeNames,
      ['Salary', 'Refunds', 'Returns', 'Interest & Dividends', 'Gifts', 'Other Income'],
      'the default income category set is seeded',
    );

    t.eq(v2.settings.schemaVersion, CURRENT_SCHEMA_VERSION, 'settings carry the new version');
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

  t.group('Migration — a blob from a newer build fails safe');

  {
    const v3 = {
      schemaVersion: 4,
      transactions: [{ id: 'a', amountPaise: 100, date: '2025-08-01', someFutureField: true }],
      accounts: SEED_ACCOUNTS.map((a) => ({ ...a })),
      categories: ALL_CATEGORIES.map((c) => ({ ...c })),
      settings: {},
    };

    t.eq(migrate(v3).ok, false, 'a schemaVersion 4 blob does not migrate');
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
      4,
      'the newer payload is still on disk, unchanged',
    );
  }

  /* ==================================================== contrast maths */

  t.group('Contrast — the WCAG formulas');
  {
    t.eq(ratio2('#000000', '#FFFFFF'), 21, 'black on white is 21:1, the maximum');
    t.eq(ratio2('#FFFFFF', '#FFFFFF'), 1, 'a colour against itself is 1:1');
    t.eq(ratio2('#FFFFFF', '#000000'), 21, 'order does not matter');
    // A known reference point: #767676 is the lightest grey that still clears
    // 4.5:1 on white, which is why it turns up in so many style guides.
    t.ok(ratio2('#767676', '#FFFFFF') >= 4.5, '#767676 on white clears AA');
    t.ok(ratio2('#787878', '#FFFFFF') < 4.5, 'and one step lighter does not');

    t.eq(parseHex('#abc')?.length, 3, 'three-digit hex expands');
    t.eq(parseHex('abcdef')?.length, 3, 'a missing # is tolerated');
    t.eq(parseHex('not a colour'), null, 'junk returns null rather than throwing');
    t.eq(contrastRatio('#fff', 'nope'), null, 'and propagates as null, not NaN');

    t.ok(meetsAA('#000', '#fff'), 'meetsAA agrees at the extreme');
    t.ok(!meetsAA('#777', '#888'), 'and rejects two mid greys');
    t.eq(AA_TEXT, 4.5, 'the AA text threshold is 4.5');
  }

  /* ============================================================ router */

  t.group('Router — the URL is the view state');
  {
    t.eq(parseRoute('').tab, 'records', 'an empty hash opens on Records');
    t.eq(parseRoute('#/analysis').tab, 'analysis', 'a tab is read from the path');
    t.eq(parseRoute('#/budgets?period=2026-08').period, '2026-08', 'the period is read');
    t.eq(parseRoute('#/records').period, null, 'and is null when absent, not guessed');

    // Total parsing: a hand-edited URL degrades, never throws.
    t.eq(parseRoute('#/nonsense').tab, 'records', 'an unknown tab falls back');
    t.eq(parseRoute('#/records?period=2026-13').period, null, 'month 13 is rejected');
    t.eq(parseRoute('#/records?period=banana').period, null, 'so is junk');
    t.eq(parseRoute('#/records?mode=hourly').mode, 'monthly', 'an unknown view mode falls back');
    t.eq(parseRoute('#/RECORDS').tab, 'records', 'the path is case-insensitive');
    t.eq(parseRoute('#///records').tab, 'records', 'extra slashes are ignored');

    t.eq(parseRoute('#/records?cat=food,rent').categoryIds.length, 2, 'lists split on commas');
    t.eq(parseRoute('#/records?cat=food,,rent').categoryIds.length, 2, 'empty entries are dropped');
    t.eq(parseRoute('#/records?q=chai').query, 'chai', 'the search query round-trips');

    t.eq(parseRoute('#/analysis').view, 'expense', 'the analysis view defaults to expense');
    t.eq(parseRoute('#/analysis?view=net').view, 'net', 'and is read from the URL');
    t.eq(parseRoute('#/analysis?view=sideways').view, 'expense', 'an unknown view falls back');
    t.eq(routeToHash({ ...DEFAULT_ROUTE, tab: 'analysis' }), '#/analysis',
      'the default view is left out of the hash');
    t.eq(
      routeToHash(parseRoute('#/analysis?view=income')), '#/analysis?view=income',
      'a chosen view survives the round trip, so the screen is linkable',
    );

    // Serialising omits defaults, so the common case stays short.
    t.eq(routeToHash(DEFAULT_ROUTE), '#/records', 'the default route is a bare path');
    t.eq(routeToHash({ ...DEFAULT_ROUTE, tab: 'accounts' }), '#/accounts', 'no empty query string');
    t.eq(
      routeToHash({ ...DEFAULT_ROUTE, tab: 'analysis', period: '2026-08' }),
      '#/analysis?period=2026-08',
      'a period is carried',
    );
    t.eq(
      routeToHash({ ...DEFAULT_ROUTE, mode: 'monthly' }),
      '#/records',
      'the default view mode is omitted',
    );

    // The round trip is what makes a link shareable.
    for (const hash of [
      '#/records', '#/analysis?period=2026-08', '#/budgets?mode=weekly',
      '#/accounts?cat=food,rent&q=chai',
    ]) {
      t.eq(routeToHash(parseRoute(hash)), hash, `${hash} survives a round trip`);
    }

    t.ok(sameRoute(parseRoute('#/records'), DEFAULT_ROUTE), 'sameRoute compares by value');
    t.ok(!sameRoute(parseRoute('#/records'), parseRoute('#/budgets')), 'and separates two tabs');
    t.eq(TABS.length, 5, 'there are five tabs');

    /* One vocabulary for view modes. The router and dates.js have to agree
       exactly: a mode the router accepts but periodRange cannot read would
       produce a null range and silently empty the pane. */
    t.eq(ROUTE_VIEW_MODES.join(','), VIEW_MODES.join(','),
      'THE ROUTER AND dates.js NAME THE SAME SIX VIEW MODES');
    for (const mode of ROUTE_VIEW_MODES) {
      t.ok(periodRange(mode, '2026-08-13') !== null, `${mode} produces a real range`);
    }

    /* The period is an anchor, and it comes in two widths. A month is enough
       for monthly and longer; daily and weekly have to say which day. */
    t.eq(parseRoute('#/records?period=2026-08-13').period, '2026-08-13', 'a full date is a period');
    t.eq(parseRoute('#/records?period=2026-08-32').period, null, 'day 32 is rejected');
    t.eq(parseRoute('#/records?period=2026-02-30').period, '2026-02-30',
      'the shape is checked here; whether the day exists is dates.js’ job');
    t.eq(routeToHash(parseRoute('#/records?period=2026-08-13')), '#/records?period=2026-08-13',
      'a dated period round-trips');

    t.eq(anchorOf({ period: '2026-08' }, '2026-01-09'), '2026-08-01',
      'a month key anchors on its first day');
    t.eq(anchorOf({ period: '2026-08-13' }, '2026-01-09'), '2026-08-13',
      'a full date anchors on itself');
    t.eq(anchorOf({ period: null }, '2026-01-09'), '2026-01-09',
      'and no period at all means today');

    t.eq(periodFor('daily', '2026-08-13'), '2026-08-13', 'daily writes the day back');
    t.eq(periodFor('weekly', '2026-08-13'), '2026-08-13', 'so does weekly');
    t.eq(periodFor('monthly', '2026-08-13'), '2026-08', 'monthly writes only the month');
    t.eq(periodFor('yearly', '2026-08-13'), '2026-08', 'and so does everything longer');

    // Any day of a month must select the same month-or-longer range, or
    // stepping would land somewhere different depending on today's date.
    t.eq(
      periodRange('monthly', anchorOf({ period: '2026-08' }, '2026-08-31')).end,
      periodRange('monthly', '2026-08-31').end,
      'the anchor day does not change a monthly range',
    );
  }

  /* =========================================================== format */

  t.group('Format — money at the render boundary');
  {
    const show = { showDecimals: true };
    const hide = { showDecimals: false };

    // Indian grouping is the whole reason Intl is doing this and not us.
    t.eq(money(15000000, show), '₹1,50,000.00', 'a lakh groups as 1,50,000, never 150,000');
    t.eq(money(15000000, hide), '₹1,50,000', 'and the decimals toggle drops the paise');
    t.eq(money(0, show), '₹0.00', 'zero still shows two decimals');
    t.eq(money(1, show), '₹0.01', 'one paisa is not rounded away');

    // The sign is derived from direction, never stored, and is what stops
    // colour being the only signal.
    t.eq(signedMoney(32000, 'expense', show).text, '−₹320.00', 'an expense gets a minus');
    t.eq(signedMoney(20000, 'income', show).text, '+₹200.00', 'income gets a plus');
    t.eq(signedMoney(20000, 'transfer', show).text, '₹200.00', 'a transfer gets neither');
    t.eq(signedMoney(32000, 'expense', show).word, 'expense', 'and carries the word for a reader');
    t.eq(signedMoney(20000, 'income', show).word, 'income', 'likewise for income');

    // U+2212, not a hyphen: it aligns with the digits and reads as a sign.
    t.eq(signedMoney(1, 'expense', show).sign.charCodeAt(0), 0x2212, 'the minus is a real minus sign');

    // A positive amount is the invariant; the formatter must not be where a
    // stray negative sneaks a second sign in.
    t.eq(signedMoney(-32000, 'expense', show).text, '−₹320.00', 'a negative input still renders one minus');

    t.eq(netMoney(5000, show).text, '+₹50.00', 'a surplus is signed');
    t.eq(netMoney(-5000, show).text, '−₹50.00', 'a deficit is signed');
    t.eq(netMoney(0, show).text, '₹0.00', 'breaking even gets no sign at all');
    t.eq(netMoney(0, show).tone, 'flat', 'and is toned flat rather than positive');
  }

  /* ======================================================== analysis === */
  t.group('Analysis — a chart says which of the three views it is drawing');

  {
    t.deepEq([...VIEWS], [...ANALYSIS_VIEWS],
      'the router and analytics name the same three views, not merely compatible ones');

    const move = transfer('2025-08-10', 5000);
    for (const view of VIEWS) {
      t.eq(viewAmount(move, view), 0, `a transfer contributes nothing to the ${view} view`);
    }
    t.eq(viewAmount(expense('2025-08-10', 250), 'net'), -25000, 'an expense is negative in net');
    t.eq(viewAmount(income('2025-08-10', 250), 'net'), 25000, 'and income is positive');
    t.eq(viewAmount(income('2025-08-10', 250), 'expense'), 0, 'income is not spending');

    const base = [expense('2025-08-02', 400), expense('2025-08-05', 100)];
    const range = { start: '2025-08-01', end: '2025-08-31' };
    const spendSeries = (list) => dailyTotalsBetween(list, range.start, range.end, 'expense');

    // E1 and E2, asked of the Analysis tab's own series rather than the
    // ledger's: adding money that is not spending must move no bar of it.
    const withIncome = [...base, income('2025-08-03', 90000)];
    t.deepEq(spendSeries(withIncome), spendSeries(base),
      'adding a ₹90,000 income leaves every daily expense bar bit-identical');

    const withTransfer = [...base, transfer('2025-08-03', 9999)];
    t.deepEq(spendSeries(withTransfer), spendSeries(base),
      'and so does adding a transfer');
    t.deepEq(
      dailyTotalsBetween(withTransfer, range.start, range.end, 'net'),
      dailyTotalsBetween(base, range.start, range.end, 'net'),
      'a transfer moves no bar of the net series either',
    );

    const net = dailyTotalsBetween(withIncome, range.start, range.end, 'net');
    t.eq(net[1].totalPaise, -40000, 'a day that only spent is negative in the net view');
    t.eq(net[2].totalPaise, 9000000, 'a day that only earned is positive');

    const incomeSeries = dailyTotalsBetween(withIncome, range.start, range.end, 'income');
    t.eq(incomeSeries[1].totalPaise, 0, 'the income series ignores a day of spending');
    t.eq(incomeSeries[2].totalPaise, 9000000, 'and reports the day money arrived');

    // The mean/median panel asks the same question of each view.
    const stats = dailySpendStatsForRange(withIncome, range, '2025-08-05', 'net');
    t.eq(stats.days, 5, 'the denominator is days elapsed, not days with a record');
    t.eq(stats.medianPaise, 0, 'the middle day of five nets nothing');
    t.eq(stats.totalPaise, 9000000 - 50000, 'and the total is income less expense');

    const spend = dailySpendStatsForRange(withIncome, range, '2025-08-05', 'expense');
    t.eq(spend.totalPaise, 50000, 'while the expense view of the same period is spending alone');
  }

  /* ============================================================ icons */

  t.group('Icons — the registry');
  {
    t.ok(ICON_NAMES.length >= 40, 'the registry covers the whole set');
    t.eq(iconOrFallback('food'), 'food', 'a known name resolves to itself');
    t.eq(iconOrFallback('no-such-icon'), 'other', 'an unknown one falls back rather than rendering blank');

    let wellFormed = true;
    for (const name of ICON_NAMES) {
      const entry = ICONS[name];
      if (!Array.isArray(entry.d) || entry.d.length === 0) wellFormed = false;
      if (typeof entry.label !== 'string' || entry.label === '') wellFormed = false;
    }
    t.ok(wellFormed, 'every icon has at least one path and a label');

    // Every tab needs its solid twin: the active tab is marked by weight as
    // well as by colour, and a missing `filled` would silently drop that.
    for (const tab of TABS) {
      t.ok(Array.isArray(ICONS[`tab-${tab}`]?.filled), `tab-${tab} has a filled variant`);
    }
  }

  /* ============================================================== csv --
     The report export. The quoting rules are the whole reason this is a
     module with tests rather than a `join(',')` in a click handler: a note
     is free text, and free text is where a hand-rolled writer breaks. */

  t.group('CSV — quoting the three inputs that break hand-rolled writers');
  {
    t.eq(csvField('chai'), 'chai', 'a plain field is written bare');
    t.eq(csvField(''), '', 'an empty field is empty, not a pair of quotes');
    t.eq(csvField(null), '', 'a missing value is an empty cell');
    t.eq(csvField(undefined), '', 'so is an undefined one');

    // 1. the comma
    t.eq(csvField('chai, samosa'), '"chai, samosa"', 'a comma forces quotes');

    // 2. the quote — doubled inside, per RFC 4180, never backslash-escaped
    t.eq(csvField('the "good" chai'), '"the ""good"" chai"', 'a quote is doubled and the field quoted');
    t.eq(csvField('"'), '""""', 'a lone quote becomes four characters');

    // 3. the newline — the one that survives a glance at the file and
    //    corrupts a row three thousand lines down
    t.eq(csvField('chai\nand samosa'), '"chai\nand samosa"', 'a newline is kept inside quotes, not stripped');
    t.eq(csvField('chai\r\nand samosa'), '"chai\r\nand samosa"', 'a CRLF inside a note survives too');

    // all three at once, which is the case the brief asks for
    const nasty = 'chai, "the good one"\nand a samosa';
    t.eq(
      csvField(nasty),
      '"chai, ""the good one""\nand a samosa"',
      'comma, quote and newline together survive in one field',
    );

    // Whitespace a spreadsheet would otherwise trim away.
    t.eq(csvField(' padded '), '" padded "', 'leading and trailing spaces are preserved');

    t.eq(csvRow(['a', 'b,c', 'd']), 'a,"b,c",d', 'a row quotes only the field that needs it');
    t.eq(csvDocument([['a'], ['b']]), 'a\r\nb\r\n', 'records are CRLF-separated and the last one is terminated');
  }

  t.group('CSV — money and the shape of a row');
  {
    t.eq(paiseToDecimal(0), '0.00', 'zero keeps both places');
    t.eq(paiseToDecimal(25000), '250.00', 'a round amount is not written as 250');
    t.eq(paiseToDecimal(120050), '1200.50', 'paise land in the decimal places');
    t.eq(paiseToDecimal(5), '0.05', 'five paise is not five rupees');
    t.eq(paiseToDecimal(15000000), '150000.00', 'no grouping: a spreadsheet wants a number, not a presentation of one');
    t.eq(paiseToDecimal(-400000), '-4000.00', 'a negative opening balance keeps its sign');

    const state = {
      categories: [
        { id: 'food', name: 'Food & Dining', kind: 'expense' },
        { id: 'salary', name: 'Salary', kind: 'income' },
      ],
      accounts: [
        { id: 'cash', name: 'Cash' },
        { id: 'bank', name: 'Bank, current' },
      ],
      budgets: {},
      transactions: [
        {
          id: 't2', kind: 'transaction', direction: 'expense', amountPaise: 25000,
          date: '2026-08-12', categoryId: 'food', accountId: 'cash', toAccountId: null,
          note: 'chai, "the good one"\nand a samosa',
        },
        {
          id: 't1', kind: 'transaction', direction: 'income', amountPaise: 5000000,
          date: '2026-08-01', categoryId: 'salary', accountId: 'bank', toAccountId: null,
          note: '',
        },
        {
          id: 't3', kind: 'transfer', direction: 'expense', amountPaise: 100000,
          date: '2026-08-20', categoryId: null, accountId: 'bank', toAccountId: 'cash',
          note: 'top up',
        },
      ],
    };

    const csv = transactionsToCsv(state);
    const lines = csv.split('\r\n');

    t.eq(lines[0], TRANSACTION_COLUMNS.join(','), 'the header names every column');

    // Oldest first: a running total in a helper column has to accumulate in
    // the direction time runs.
    t.ok(lines[1].startsWith('2026-08-01,'), 'rows are written oldest first');

    t.eq(
      lines[1],
      '2026-08-01,Transaction,income,50000.00,Salary,"Bank, current",,',
      'the account name containing a comma is quoted, and the empty cells stay empty',
    );

    // The nasty note spans two physical lines but is one record. Splitting
    // the document on the record separator must still give three records.
    t.eq(
      csv.split('\r\n').filter((l) => l.startsWith('2026-08-')).length,
      3,
      'three records, even though one note contains a newline',
    );
    t.ok(
      csv.includes('"chai, ""the good one""\nand a samosa"'),
      'the note keeps its comma, its quotes and its newline, all inside one field',
    );

    // A transfer is Transfer in Type and blank in Direction: it is neither an
    // expense nor an income, and the export must not imply it is either.
    const transferRow = lines.find((l) => l.includes('Transfer'));
    t.eq(
      transferRow,
      '2026-08-20,Transfer,,1000.00,,"Bank, current",Cash,top up',
      'a transfer names both accounts, carries no category and no direction',
    );

    // Positive amounts with a separate direction, exactly as stored. A signed
    // amount here would make the export disagree with the app.
    t.ok(
      !csv.includes('-50000.00') && !csv.includes('-250.00'),
      'no amount is signed; direction is its own column',
    );

    // An id that no longer resolves is an empty cell, not a raw uuid.
    const orphan = transactionsToCsv({
      ...state,
      transactions: [{
        id: 'x', kind: 'transaction', direction: 'expense', amountPaise: 100,
        date: '2026-08-01', categoryId: 'deleted-cat', accountId: 'deleted-acct',
        toAccountId: null, note: '',
      }],
    });
    t.eq(orphan.split('\r\n')[1], '2026-08-01,Transaction,expense,1.00,,,,',
      'an unresolvable id leaves the cell blank rather than printing a uuid');

    t.eq(transactionsToCsv({ categories: [], accounts: [], transactions: [] }).trim(),
      TRANSACTION_COLUMNS.join(','), 'an empty ledger still exports its header');
  }

  t.group('CSV — the plan is its own document');
  {
    const state = {
      categories: [{ id: 'food', name: 'Food & Dining' }, { id: 'rent', name: 'Rent & Bills' }],
      accounts: [],
      transactions: [],
      budgets: {
        '2026-08': { rent: 3000000, food: 800000 },
        '2026-07': { food: 750000 },
      },
    };
    const lines = budgetsToCsv(state).split('\r\n');
    t.eq(lines[0], BUDGET_COLUMNS.join(','), 'the budget export names its columns');
    t.eq(lines[1], '2026-07,Food & Dining,7500.00', 'months come out in order, oldest first');
    t.eq(lines[2], '2026-08,Food & Dining,8000.00', 'a month lists its categories');
    t.eq(lines[3], '2026-08,Rent & Bills,30000.00', 'one row per month per category, never one column per month');
    t.eq(budgetsToCsv({ categories: [], budgets: {} }).trim(), BUDGET_COLUMNS.join(','),
      'no plan still exports a header rather than an empty file');
  }

  t.group('CSV — filenames');
  {
    t.eq(csvFilename('records', '2026-08-31T10:20:30.000Z'), 'heft-2026-08-31-records.csv',
      'the filename carries the date and what is in it');
    t.eq(csvFilename('budgets', '2026-01-05T00:00:00.000Z'), 'heft-2026-01-05-budgets.csv',
      'and names the other document differently');
  }
}
