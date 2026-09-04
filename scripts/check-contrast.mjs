/**
 * check-contrast.mjs — reads the real css/tokens.css and proves the palette.
 *
 * The point is that this parses the shipped stylesheet rather than a copy of
 * the values kept next to the test. If someone nudges a hex in tokens.css and
 * breaks a pair, this fails; there is no second source of truth to drift
 * from.
 *
 *   node --experimental-default-type=module scripts/check-contrast.mjs
 *
 * (The flag is only needed because the project has no package.json; the
 * browser loads the same .js files as modules without it.)
 *
 * Exits non-zero on any failing pair.
 */

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { AA_NON_TEXT, AA_TEXT, ratio2 } from '../js/lib/contrast.js';

const here = dirname(fileURLToPath(import.meta.url));
const css = await readFile(join(here, '..', 'css', 'tokens.css'), 'utf8');

/**
 * Pull one theme's declarations. Light is bare `:root` (the second one, which
 * carries the colours); dark is the explicit `[data-theme="dark"]` block.
 */
function block(startMarker) {
  const at = css.indexOf(startMarker);
  if (at === -1) throw new Error(`could not find block: ${startMarker}`);
  const open = css.indexOf('{', at);
  let depth = 0;
  for (let i = open; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(open + 1, i);
    }
  }
  throw new Error(`unterminated block: ${startMarker}`);
}

function tokensIn(text) {
  const out = {};
  for (const m of text.matchAll(/--([a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) {
    out[m[1]] = m[2];
  }
  return out;
}

// The light colours live in the second bare `:root` — the first holds type,
// spacing and the weight scale and declares no hexes.
const light = tokensIn(block('LIGHT — defined on bare'));
const dark = tokensIn(css.slice(css.indexOf(':root[data-theme="dark"]')));

const THEMES = [['light', light], ['dark', dark]];

/* Which ink is drawn on which ground. This list is the actual contract: if a
   component starts drawing --ink-3 on a new ground, it belongs here. */
const TEXT_PAIRS = [
  ['ink', ['bg', 'surface', 'band']],
  ['ink-2', ['bg', 'surface', 'band']],
  ['ink-3', ['bg', 'surface', 'band']],
  ['accent-text', ['bg', 'surface', 'band']],
  // Money is never drawn on the header band: the period bar sits on the page
  // ground precisely so these two do not have to survive that light olive.
  ['money-out', ['bg', 'surface']],
  ['money-in', ['bg', 'surface']],
  // The tinted ground. A wash mixed at render time out of the very ink drawn
  // on it is how a pair that measures 5.73 on the plain surface ends up at
  // 4.11 on the tinted one — so the wash is a flat token and both inks that
  // land on it are checked here rather than assumed from the surface row.
  ['danger-ink', ['danger-wash']],
  ['ink-2', ['danger-wash']],
];

const failures = [];
const lines = [];

for (const [name, t] of THEMES) {
  lines.push(`\n${name.toUpperCase()}`);

  for (const [ink, grounds] of TEXT_PAIRS) {
    for (const ground of grounds) {
      const r = ratio2(t[ink], t[ground]);
      const ok = r !== null && r >= AA_TEXT;
      if (!ok) failures.push(`${name}: --${ink} on --${ground} = ${r} (need ${AA_TEXT})`);
      lines.push(`  --${ink.padEnd(11)} on --${ground.padEnd(7)} ${String(r).padStart(6)}  ${ok ? 'ok' : 'FAIL'}`);
    }
  }

  // The accent is a surface: a glyph sits on it, and its own boundary has to
  // be discernible against the page it floats over.
  const glyph = ratio2(t['accent-ink'], t.accent);
  const glyphOk = glyph !== null && glyph >= AA_TEXT;
  if (!glyphOk) failures.push(`${name}: --accent-ink on --accent = ${glyph}`);
  lines.push(`  --accent-ink on --accent  ${String(glyph).padStart(6)}  ${glyphOk ? 'ok' : 'FAIL'}`);

  // The FAB's edge: either the fill itself clears 3:1 against the page, or the
  // ring does. Light theme needs the ring; dark theme does not.
  const fill = ratio2(t.accent, t.bg);
  const edge = t['accent-edge'] === 'transparent' ? null : ratio2(t['accent-edge'], t.bg);
  const boundaryOk = (fill !== null && fill >= AA_NON_TEXT) || (edge !== null && edge >= AA_NON_TEXT);
  if (!boundaryOk) failures.push(`${name}: FAB boundary indiscernible (fill ${fill}, ring ${edge})`);
  lines.push(`  FAB boundary: fill ${fill}, ring ${edge ?? 'none'}  ${boundaryOk ? 'ok' : 'FAIL'}`);

  // Category discs: the glyph on the disc, and the disc against the page.
  // The neutral disc is checked with the rest — it is what every category
  // without a hue of its own falls back to, so it is the most-drawn one here.
  for (const i of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 'neutral']) {
    const disc = t[`cat-${i}`];
    const g = ratio2(t['cat-glyph'], disc);
    const d = ratio2(disc, t.bg);
    const ok = g >= AA_TEXT && d >= AA_NON_TEXT;
    if (!ok) failures.push(`${name}: cat-${i} glyph ${g}, disc/bg ${d}`);
    lines.push(`  cat-${String(i).padEnd(2)} glyph ${String(g).padStart(6)}  disc/bg ${String(d).padStart(6)}  ${ok ? 'ok' : 'FAIL'}`);
  }
}

console.log(lines.join('\n'));

if (failures.length) {
  console.error(`\n${failures.length} FAILING PAIR(S):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\nAll pairs pass. ${THEMES.length} themes checked against the shipped tokens.css.`);
