/**
 * money.js — all money is an integer number of paise. Never a float.
 *
 * Rupee amounts arrive from humans as strings ('1,200', '₹1200.50') and leave
 * as formatted strings. In between, every value in the app is an integer.
 * Pure module: no DOM, no globals.
 */

const WHITESPACE_AND_SYMBOL = /[₹\s]/g;
const RUPEE_WORD = /^(?:rs|inr)\.?|(?:rs|inr)\.?$/gi;

/**
 * Parse a human-typed rupee string into integer paise.
 * Accepts: '1200' '1,200' '1200.50' '₹1200' 'Rs 1200' '1200.5' '.5' '0'
 * Rejects (returns null): '' 'abc' '-50' '1.2.3' '12,34,56.789.0'
 * More than two decimal places round half-up on the third digit.
 * @returns {number|null} integer paise, or null when the input is not an amount
 */
export function toPaise(input) {
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    return Math.round(input * 100);
  }
  if (typeof input !== 'string') return null;

  const s = input
    .replace(WHITESPACE_AND_SYMBOL, '')
    .replace(RUPEE_WORD, '')
    .replace(/,/g, '');
  if (s === '') return null;
  if (!/^\d+(?:\.\d*)?$|^\.\d+$/.test(s)) return null;

  const dot = s.indexOf('.');
  const whole = dot === -1 ? s : s.slice(0, dot);
  const fracRaw = dot === -1 ? '' : s.slice(dot + 1);

  const rupees = whole === '' ? 0 : Number(whole);
  if (!Number.isSafeInteger(rupees)) return null;

  const frac = (fracRaw + '00').slice(0, 2);
  let paise = rupees * 100 + Number(frac);
  if (fracRaw.length > 2 && Number(fracRaw[2]) >= 5) paise += 1;

  return Number.isSafeInteger(paise) ? paise : null;
}

const FORMATTERS = new Map();
function formatter(fractionDigits) {
  let f = FORMATTERS.get(fractionDigits);
  if (!f) {
    // minimumFractionDigits must be set too: INR defaults to 2, and a
    // minimum above the maximum throws a RangeError.
    f = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    FORMATTERS.set(fractionDigits, f);
  }
  return f;
}

/**
 * Format integer paise as INR with Indian digit grouping (₹1,50,000).
 * Intl does the lakh/crore grouping; never hand-roll comma insertion.
 * @param {number} paise
 * @param {{ paise?: boolean }} [opts] pass { paise: true } for two decimals
 */
export function formatINR(paise, opts = {}) {
  const n = Number.isFinite(paise) ? paise : 0;
  const digits = opts.paise ? 2 : 0;
  return formatter(digits).format(n / 100);
}

/** Format paise as a bare grouped number, no currency symbol: '1,50,000'. */
export function formatAmount(paise, opts = {}) {
  const n = Number.isFinite(paise) ? paise : 0;
  const digits = opts.paise ? 2 : 0;
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n / 100);
}

/** Paise -> a plain editable rupee string ('120050' -> '1200.50'). */
export function toRupeeString(paise) {
  const n = Math.max(0, Math.trunc(Number(paise) || 0));
  const whole = Math.trunc(n / 100);
  const frac = n % 100;
  return frac === 0 ? String(whole) : `${whole}.${String(frac).padStart(2, '0')}`;
}

/** Exact integer sum. No float ever enters the accumulator. */
export function sumPaise(list, pick = (x) => x) {
  let total = 0;
  for (const item of list) {
    const v = pick(item);
    if (Number.isFinite(v)) total += Math.trunc(v);
  }
  return total;
}

/** Integer percentage share, guarded against a zero denominator. */
export function sharePercent(partPaise, wholePaise) {
  if (!wholePaise) return 0;
  return (partPaise / wholePaise) * 100;
}
