/**
 * picker.js — the icon grid and the colour grid, as real radio groups.
 *
 * Both the account sheet and the category sheet need them, and a second copy
 * is how the two end up disagreeing about arrow-key behaviour. The
 * radiogroup mechanics come from `ui/choice.js`, which is the same code the
 * preference sheets and the Analysis view switch use — the buttons carry the
 * `.opt-choice` class it keys on, plus their own class for the drawing.
 *
 * The colour picker marks its choice with a tick, not with a ring alone. A
 * picker whose only "chosen" signal is a colour is unusable in precisely the
 * palette it exists to choose from.
 */

import { icon } from './icon.js';
import { paintChoice, wireChoice } from './choice.js';
import { CATEGORY_TOKENS } from '../lib/icons.js';

/**
 * The glyphs offered for a category, grouped so the list reads as a set
 * rather than as the whole registry dumped on screen. Shell and tab icons are
 * deliberately absent: a category called "Menu" with the hamburger on it
 * would be indistinguishable from chrome.
 */
export const CATEGORY_ICONS = Object.freeze([
  'food', 'groceries', 'transport', 'cab', 'car', 'fuel', 'rent', 'bills',
  'shopping', 'clothing', 'health', 'entertainment', 'education', 'electronics',
  'travel', 'gifts', 'salary', 'refunds', 'returns', 'interest', 'rental',
  'stocks', 'other',
]);

/** An account is a place money sits, so the set is small and concrete. */
export const ACCOUNT_ICONS = Object.freeze([
  'cash', 'bank', 'card', 'wallet', 'stocks', 'salary', 'gifts', 'other',
]);

/** The ten measured hues, plus the neutral. Every one clears 4.5:1 on its glyph. */
export const PICKER_TOKENS = Object.freeze([...CATEGORY_TOKENS, 'cat-neutral']);

/**
 * Fill a container with icon options.
 *
 * @param {Element} host a `role="radiogroup"`
 * @param {readonly string[]} names registry keys
 * @param {(name: string) => void} onPick
 */
export function buildIconPicker(host, names, onPick) {
  host.replaceChildren(...names.map((name) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'opt-choice glyph';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.tabIndex = -1;
    button.dataset.value = name;
    // The glyph is the whole content, so the button needs its own name.
    button.setAttribute('aria-label', name.replace(/-/g, ' '));
    button.append(icon(name));
    return button;
  }));
  wireChoice(host, onPick);
}

/**
 * Fill a container with colour options.
 *
 * The swatch carries a tick when chosen and nothing when not, so the state is
 * legible without seeing the hue at all.
 */
export function buildColorPicker(host, tokens, onPick) {
  host.replaceChildren(...tokens.map((token) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'opt-choice swatch';
    button.setAttribute('role', 'radio');
    button.setAttribute('aria-checked', 'false');
    button.tabIndex = -1;
    button.dataset.value = token;
    button.style.setProperty('--swatch-color', `var(--${token})`);
    button.setAttribute('aria-label', `Colour ${token.replace(/^cat-/, '')}`);
    button.append(icon('check'));
    return button;
  }));
  wireChoice(host, onPick);
}

export { paintChoice };
