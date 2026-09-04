/**
 * format.js — money as the interface shows it.
 *
 * `money.js` owns the arithmetic and the raw `Intl` call and does not change.
 * This layer sits above it and adds the two things the interface needs and
 * the maths does not: the decimals preference, and the explicit sign.
 *
 * The sign is not decoration. A transaction stores a positive `amountPaise`
 * plus a direction, so the sign is derived at the render boundary — and it is
 * the reason income and expense are never told apart by colour alone.
 */

import { formatINR } from './money.js';

export const MINUS = '−';   // U+2212 MINUS SIGN, not a hyphen
export const PLUS = '+';

/** Settings shape this module reads. Everything else is ignored. */
export const DEFAULT_DISPLAY = Object.freeze({ showDecimals: true });

/**
 * @param {number} paise positive integer
 * @param {{showDecimals?: boolean}} [display]
 * @returns {string} e.g. '₹1,50,000.00'
 */
export function money(paise, display = DEFAULT_DISPLAY) {
  return formatINR(paise, { paise: display.showDecimals !== false });
}

/**
 * The signed form, for anything with a direction.
 *
 * @param {number} paise positive integer — a negative one is a bug upstream
 * @param {'expense'|'income'|'transfer'|null} direction
 * @returns {{text: string, sign: string, tone: string, word: string}}
 *   `text` is the full string; `sign` and `word` are exposed separately so a
 *   row can render the sign visually and hand the word to a screen reader.
 */
export function signedMoney(paise, direction, display = DEFAULT_DISPLAY) {
  const amount = money(Math.abs(paise), display);
  if (direction === 'income') {
    return { text: `${PLUS}${amount}`, sign: PLUS, tone: 'in', word: 'income' };
  }
  if (direction === 'expense') {
    return { text: `${MINUS}${amount}`, sign: MINUS, tone: 'out', word: 'expense' };
  }
  // A transfer moves money without creating or destroying any, so it gets
  // neither sign. Giving it one would imply it belongs in a total.
  return { text: amount, sign: '', tone: 'neutral', word: 'transfer' };
}

/**
 * The net of a period. Zero is neither positive nor negative and gets no
 * sign — a "+₹0.00" would be a small lie about a month that broke even.
 */
export function netMoney(netPaise, display = DEFAULT_DISPLAY) {
  const amount = money(Math.abs(netPaise), display);
  if (netPaise > 0) return { text: `${PLUS}${amount}`, sign: PLUS, tone: 'in', word: 'surplus' };
  if (netPaise < 0) return { text: `${MINUS}${amount}`, sign: MINUS, tone: 'out', word: 'deficit' };
  return { text: amount, sign: '', tone: 'flat', word: 'even' };
}
