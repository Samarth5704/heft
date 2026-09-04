/**
 * csv.js — the ledger as a spreadsheet.
 *
 * A second export format, for a different job. The JSON export is a backup:
 * it round-trips, it carries settings and budgets, and importing it restores
 * exactly what left. This one is a *report* — it goes into a spreadsheet, it
 * is read by a person or a pivot table, and it does not come back. Heft does
 * not import CSV and is not going to; guessing at someone else's columns is
 * how a ledger acquires records nobody entered.
 *
 * Pure. No Blob, no DOM, no File. Strings in, one string out.
 *
 * The quoting is RFC 4180 and it is the entire reason this file is separate
 * and tested rather than three lines of `join(',')` inside the click handler.
 * A hand-rolled writer breaks on exactly three inputs, and a note field takes
 * all three:
 *
 *   a comma       "chai, samosa"      splits one column into two
 *   a quote       "the 'good' chai"   ends the field early
 *   a newline     "chai\nand samosa"  splits one row into two
 *
 * The last one is the one that gets missed, because it survives a glance at
 * the file and only shows up as a corrupt row three thousand lines down. All
 * three have a test.
 */

import { isTransfer } from './analytics.js';

/** RFC 4180 says CRLF between records. Excel agrees; everything else copes. */
const CRLF = '\r\n';

/**
 * A field needs quoting if it contains the delimiter, a quote, or either
 * newline character. Inside quotes, a literal `"` is written as `""`.
 *
 * Leading and trailing spaces are quoted too. They are not required to be,
 * but a spreadsheet that trims them silently changes a note, and a note is
 * the one column here that is someone's own words.
 */
export function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  const needsQuotes = /[",\r\n]/.test(text) || text !== text.trim();
  if (!needsQuotes) return text;
  return `"${text.replaceAll('"', '""')}"`;
}

/** One row from an array of values. */
export const csvRow = (values) => values.map(csvField).join(',');

/** Rows to a document. A trailing CRLF, so the last record is terminated. */
export const csvDocument = (rows) => rows.map(csvRow).join(CRLF) + CRLF;

/**
 * Paise to a plain decimal, always two places, no grouping and no symbol.
 *
 * This is a render boundary, so formatting here is correct — but it is a
 * boundary onto a *spreadsheet*, which wants a number and not a presentation
 * of one. `₹1,50,000.00` is text in every cell it lands in; `150000.00` adds
 * up. Integer arithmetic throughout, as everywhere else: the paise are split
 * with division and modulo, never handed to a float.
 */
export function paiseToDecimal(paise) {
  const n = Math.trunc(Number(paise) || 0);
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/**
 * The columns, in order.
 *
 * `Amount` is positive and `Direction` says which way it went, because that
 * is how the record is stored and flattening the two into a signed number
 * here would make the export disagree with the app about what a transfer is.
 * A transfer is `Transfer` in the Type column and blank in Direction: it is
 * neither an expense nor an income, and a spreadsheet that sums the Amount
 * column of a mixed export will get a number that means nothing — so the
 * Type column is what any honest total has to filter on first.
 */
export const TRANSACTION_COLUMNS = [
  'Date', 'Type', 'Direction', 'Amount', 'Category', 'Account', 'To account', 'Note',
];

const TYPE = (t) => (isTransfer(t) ? 'Transfer' : 'Transaction');
const DIRECTION = (t) => (isTransfer(t) ? '' : t.direction);

const nameIndex = (list = []) => Object.fromEntries(list.map((x) => [x.id, x.name]));

/**
 * The whole ledger as one CSV document, oldest first.
 *
 * Oldest first because a spreadsheet is read downward and a running total
 * built in a helper column has to accumulate in the direction time runs. The
 * app's own list is newest first for the opposite reason.
 *
 * An id that no longer resolves is written as an empty cell rather than the
 * raw id: a name is what the column is for, and a uuid in a Category column
 * is noise that looks like data.
 */
export function transactionsToCsv(state) {
  const categories = nameIndex(state.categories);
  const accounts = nameIndex(state.accounts);

  const rows = [...(state.transactions ?? [])]
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
    .map((t) => [
      t.date,
      TYPE(t),
      DIRECTION(t),
      paiseToDecimal(t.amountPaise),
      categories[t.categoryId] ?? '',
      accounts[t.accountId] ?? '',
      accounts[t.toAccountId] ?? '',
      t.note ?? '',
    ]);

  return csvDocument([TRANSACTION_COLUMNS, ...rows]);
}

/**
 * The plan as a second document: one row per month per budgeted category.
 *
 * Separate from the ledger rather than a column on it, because a budget is a
 * fact about a month and a category, not about any one transaction. Bolting
 * it onto every row would repeat the same figure a hundred times and invite
 * someone to sum it.
 */
export const BUDGET_COLUMNS = ['Month', 'Category', 'Budget'];

export function budgetsToCsv(state) {
  const categories = nameIndex(state.categories);
  const rows = [];

  for (const month of Object.keys(state.budgets ?? {}).sort()) {
    const forMonth = state.budgets[month] ?? {};
    for (const categoryId of Object.keys(forMonth).sort()) {
      rows.push([
        month,
        categories[categoryId] ?? '',
        paiseToDecimal(forMonth[categoryId]),
      ]);
    }
  }

  return csvDocument([BUDGET_COLUMNS, ...rows]);
}

/** `heft-2026-08-31-records.csv` — dated and named for what is in it. */
export function csvFilename(kind, exportedAt = new Date().toISOString()) {
  return `heft-${exportedAt.slice(0, 10)}-${kind}.csv`;
}
