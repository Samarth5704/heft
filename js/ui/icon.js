/**
 * icon.js — turns a registry entry into an <svg>.
 *
 * Two things every caller gets for free:
 *
 * - A decorative icon is `aria-hidden`. An icon that carries meaning on its
 *   own gets `role="img"` and a name. There is no third option, and no way to
 *   accidentally ship an unlabelled meaningful icon.
 * - `filled` variants are drawn as filled shapes with the detail knocked back
 *   out, which is what lets the active tab differ in weight and not only hue.
 */

import { ICONS, iconOrFallback } from '../lib/icons.js';

const NS = 'http://www.w3.org/2000/svg';

function path(d, { fill = 'none' } = {}) {
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', d);
  if (fill !== 'none') p.setAttribute('fill', fill);
  return p;
}

/**
 * @param {string} name registry key
 * @param {{filled?: boolean, label?: string|null, size?: string}} [opts]
 *   `label` null (the default) means decorative.
 */
export function icon(name, { filled = false, label = null, size } = {}) {
  const key = iconOrFallback(name);
  const entry = ICONS[key];
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.9');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('fill', 'none');
  if (size) {
    svg.style.inlineSize = size;
    svg.style.blockSize = size;
  }

  if (filled && entry.filled) {
    for (const d of entry.filled) {
      const p = path(d, { fill: 'currentColor' });
      p.setAttribute('stroke', 'none');
      svg.append(p);
    }
    // The detail is punched back out of the solid body in the ground colour,
    // so a filled tab icon still reads as the same drawing.
    for (const d of entry.knockout ?? []) {
      const p = path(d);
      p.setAttribute('stroke', 'var(--icon-knockout, var(--band))');
      svg.append(p);
    }
  } else {
    for (const d of entry.d) svg.append(path(d));
  }

  if (label) {
    svg.setAttribute('role', 'img');
    const title = document.createElementNS(NS, 'title');
    title.textContent = label;
    svg.prepend(title);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  return svg;
}

/**
 * A category mark: the glyph on a filled disc in the category's hue. 40px by
 * default, matching the reference's density.
 *
 * Always decorative — the row's text label is the accessible name, and a chip
 * that repeated it would make every row announce its category twice.
 */
export function categoryChip(iconName, colorToken, { size = '40px' } = {}) {
  const span = document.createElement('span');
  span.className = 'cat-chip';
  span.setAttribute('aria-hidden', 'true');
  span.style.setProperty('--chip-size', size);
  span.style.setProperty('--chip-color', `var(--${colorToken})`);
  span.append(icon(iconName));
  return span;
}
