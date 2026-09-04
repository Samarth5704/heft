/**
 * contrast.js — WCAG relative luminance and contrast ratio.
 *
 * Pure, no DOM, no state. Exists so the palette's legibility is a checked
 * property rather than a claim in a comment: `scripts/check-contrast.mjs`
 * reads the real `css/tokens.css` and runs every pair through this.
 *
 * The formulas are WCAG 2.2 §relative-luminance and §contrast-ratio.
 */

/** '#RGB' or '#RRGGBB' -> [r, g, b] in 0..1. Returns null for anything else. */
export function parseHex(input) {
  const raw = String(input ?? '').trim().replace(/^#/, '');
  const full = raw.length === 3 ? raw.split('').map((c) => c + c).join('') : raw;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
}

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** @returns {number|null} 0..1, or null if the colour could not be read. */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex);
  if (!rgb) return null;
  const [r, g, b] = rgb.map(channel);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/**
 * Contrast ratio between two colours, 1..21. Order does not matter.
 * @returns {number|null} null if either colour is unreadable.
 */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const [hi, lo] = la >= lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA thresholds. Large text is 18.66px bold or 24px regular and up. */
export const AA_TEXT = 4.5;
export const AA_LARGE_TEXT = 3;
/** Non-text: the boundary of a UI component or a meaningful graphic. */
export const AA_NON_TEXT = 3;

export const meetsAA = (a, b, min = AA_TEXT) => {
  const r = contrastRatio(a, b);
  return r !== null && r >= min;
};

/** Rounded to two places, the way the ratios are written in tokens.css. */
export const ratio2 = (a, b) => {
  const r = contrastRatio(a, b);
  return r === null ? null : Math.round(r * 100) / 100;
};
