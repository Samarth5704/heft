/**
 * app.js — the shell. Routing, chrome, preferences, focus. No feature logic.
 *
 * Each of the five panes is mounted from its own module — `ui/records.js`,
 * `ui/analysis.js`, `ui/budgets.js`, `ui/accounts.js`, `ui/categories.js`.
 * What this file owns is the furniture: which tab is current, which period is
 * being looked at, the drawer, the sheets, and the fact that all of that
 * lives in the URL.
 */

import { createStore, UNDO_WINDOW_MS } from './store.js';
import {
  anchorOf, createRouter, periodFor, routeToHash, TABS, VIEW_MODES,
} from './lib/router.js';
import { icon } from './ui/icon.js';
import { money, netMoney } from './lib/format.js';
import { periodRange, stepAnchor, today as todayISO } from './lib/dates.js';
import { createAnnouncer } from './ui/announcer.js';
import { createRecords } from './ui/records.js';
import { createAnalysis } from './ui/analysis.js';
import { createBudgets } from './ui/budgets.js';
import { createAccounts } from './ui/accounts.js';
import { createCategories } from './ui/categories.js';
import { createReassignDialog } from './ui/reassign.js';
import { createManageData } from './ui/manage-data.js';
import { restoreFocus } from './ui/focus.js';
import { paintChoice as paintChoiceIn, wireChoice as wireChoiceIn } from './ui/choice.js';

const $ = (id) => document.getElementById(id);

const store = createStore();
const announce = createAnnouncer($('announcer'));
const TODAY = todayISO();

/* -------------------------------------------------------------- icons --
   Every glyph in the chrome is drawn from the registry at boot, so the
   markup carries no duplicated SVG and the set can never drift between
   places that use it. */

const CHROME_ICONS = [
  ['drawer-open', 'menu'], ['search-toggle', 'search'], ['drawer-close', 'close'],
  ['period-prev', 'prev'], ['period-next', 'next'], ['filter-open', 'filter'],
  ['display-open', 'settings'], ['fab', 'plus'], ['prefs-close', 'close'],
  ['display-close', 'close'],
];

for (const [id, name] of CHROME_ICONS) $(id)?.prepend(icon(name));

const TAB_META = {
  records: 'Records', analysis: 'Analysis', budgets: 'Budgets',
  accounts: 'Accounts', categories: 'Categories',
};

/* --------------------------------------------------------------- width --
   One breakpoint, named once, matching the single `@media` in wide.css. Two
   things about the layout cannot be expressed in CSS alone and are decided
   here instead: which panes are painted, and where the add button sits in
   the DOM.

   The second is the reason this is not left entirely to the stylesheet. CSS
   could put the button in the header visually, but it would still be the
   last thing in the document — so a keyboard would reach the primary action
   after the whole ledger, in a layout where it is drawn at the top. Moving
   the node keeps the reading order and the visual order the same thing at
   both sizes. */

const WIDE = matchMedia('(min-width: 45rem)');

/**
 * The second breakpoint: where Records is wide enough to show its breakdown
 * beside it rather than only instead of it. Higher than the sidebar's, and
 * the arithmetic for why is in the matching block of wide.css — the two
 * numbers are one decision and neither may move without the other.
 */
const SPLIT = matchMedia('(min-width: 60rem)');

/** The pane that comes along, and the tab it comes along with. */
const COMPANION = { records: 'analysis' };

/**
 * Put the add button where the current layout draws it: in the header from
 * 45rem up, and back in its own slot below the ledger on a phone, where it
 * floats bottom-right and belongs after the content it sits over.
 */
function placeAddButton() {
  const fab = $('fab');
  if (WIDE.matches) $('header-actions').append(fab);
  else $('app').insertBefore(fab, $('tabbar'));
}

/** A tab is a glyph plus a label; the glyph swaps to its filled twin when current. */
function buildTabs() {
  for (const tab of TABS) {
    const a = $(`tab-${tab}`);
    const label = document.createElement('span');
    label.textContent = TAB_META[tab];
    a.replaceChildren(icon(`tab-${tab}`), label);
  }
}
buildTabs();

function paintTabState(route) {
  for (const tab of TABS) {
    const a = $(`tab-${tab}`);
    const isCurrent = tab === route.tab;
    const label = a.lastElementChild;
    a.replaceChildren(icon(`tab-${tab}`, { filled: isCurrent }), label);
    if (isCurrent) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');

    // The href carries the whole current route, not a bare tab path. Changing
    // tab is a change of section, not of period — a static `#/budgets` would
    // silently throw away the month you had stepped to, and would also make a
    // copied link land somewhere other than where it was copied from.
    a.href = routeToHash({ ...route, tab });
  }
}

/* ------------------------------------------------------------- period --
   The route carries an anchor — a month for the monthly-and-longer modes, a
   day for daily and weekly. Null means "wherever today falls", which is what
   a bare #/records opens on. The range itself always comes from
   `dates.periodRange`, so the six modes share one implementation. */

const rangeOf = (route) => periodRange(
  route.mode,
  anchorOf(route, TODAY),
  store.getState().data.settings.weekStartsOn ?? 1,
);

/* ------------------------------------------------------------ display --
   The one thing the shell reads out of settings before any data exists. */

const display = () => ({ showDecimals: store.getState().data.settings.showDecimals !== false });

/**
 * Split a formatted amount so the ₹ can be set at a smaller optical size than
 * its digits, without ever hand-building the number — `Intl` produces the
 * string, this only wraps the symbol it already put there.
 */
function renderMoney(node, text, srSuffix = '') {
  node.replaceChildren();
  const match = /^([+−-]?)(₹)(.*)$/u.exec(text);
  if (!match) {
    node.textContent = text;
    return;
  }
  const [, sign, symbol, digits] = match;
  if (sign) node.append(sign);
  const sym = document.createElement('span');
  sym.className = 'money-sym';
  sym.textContent = symbol;
  node.append(sym, digits);
  if (srSuffix) {
    const sr = document.createElement('span');
    sr.className = 'visually-hidden';
    sr.textContent = `, ${srSuffix}`;
    node.append(sr);
  }
}

/**
 * The triad: what went out, what came in, and the difference.
 *
 * Every figure carries its sign and, for a screen reader, its word — the
 * colour is the third signal, never the only one. The income column stays
 * present at zero rather than collapsing the grid on a month with no income.
 */
function paintTriad(totals = { expensePaise: 0, incomePaise: 0, netPaise: 0, openingPaise: 0 }) {
  const d = display();
  renderMoney($('fig-expense'), `\u2212${money(totals.expensePaise, d)}`, 'expense');
  renderMoney($('fig-income'), `+${money(totals.incomePaise, d)}`, 'income');

  const net = netMoney(totals.netPaise, d);
  const carried = totals.openingPaise !== 0;
  renderMoney($('fig-net'), net.text, carried ? `${net.word}, carried over` : net.word);
  $('triad').querySelector('[data-figure="net"]').dataset.tone = net.tone;

  // Show-total hides the figure, not the fact that it exists: the column keeps
  // its place so the other two do not move when it is switched off.
  const showTotal = store.getState().data.settings.showTotal !== false;
  $('triad').dataset.total = showTotal ? 'shown' : 'hidden';
}

function paintPeriod(route) {
  // The range names itself — 'August 2026', '11-17 August 2025', '2026'. The
  // label is the mode's own vocabulary rather than a month key dressed up.
  $('period-label').textContent = rangeOf(route)?.label ?? '';
}

/* ------------------------------------------------------------- router */

let painted = false;

const canAnimate = () => typeof document.startViewTransition === 'function'
  && !matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Run a DOM update inside a view transition when one is available.
 *
 * The watchdog is the point. `startViewTransition` defers its callback to the
 * next rendering opportunity, and a document that is not currently producing
 * them — backgrounded, throttled, or being driven headlessly — may not invoke
 * it for a long time or at all. Without the timer the route would update, the
 * URL would change, and the interface would sit a whole navigation behind it.
 *
 * So the update is guaranteed to run, once, either way. The transition is
 * allowed to decorate it and never to gate it.
 */
function withTransition(update) {
  if (!canAnimate()) {
    update();
    return;
  }
  let done = false;
  const once = () => {
    if (done) return;
    done = true;
    update();
  };
  const guard = setTimeout(once, 120);
  const transition = document.startViewTransition(() => {
    clearTimeout(guard);
    once();
  });
  // A transition interrupted by a second navigation rejects. Expected, not
  // an error; swallow it rather than leaving an unhandled rejection.
  transition.ready.catch(() => {});
  transition.finished.catch(() => {});
}

const router = createRouter({
  onChange(route, prev) {
    // A tab change or a period step is one movement worth animating; a
    // keystroke in the search field is not.
    const worthAnimating = painted && prev
      && (prev.tab !== route.tab || prev.period !== route.period);
    if (worthAnimating) withTransition(() => paint(route));
    else paint(route);
  },
});

/* ------------------------------------------------------------- records --
   The one pane that is built. It owns everything below the period bar and
   reports the period's figures back up so the shell can paint the triad --
   the figures belong to the data, the furniture belongs here. */

const records = createRecords({
  store,
  router,
  announce,
  today: TODAY,
  undoWindowMs: UNDO_WINDOW_MS,
  onTotals: paintTriad,
});

records.setStepper(stepPeriod);

/* ------------------------------------------------------------ analysis --
   The second pane that is built. It reads the same route and the same store,
   and owns nothing above the period bar. */

const analysis = createAnalysis({ store, router, announce, today: TODAY });

/* -------------------------------------------- budgets, accounts, categories --
   The three management panes. Each reads the same store and the same route
   and owns nothing above the period bar. The never-orphan delete dialog is
   shared: the rule it enforces is the same for a category and an account, and
   a second copy is how the two would drift apart. */

const reassign = createReassignDialog({ announce });

const budgets = createBudgets({ store, router, announce, today: TODAY });

const accounts = createAccounts({
  store,
  router,
  announce,
  reassign,
  // Moving money is the same dialog the FAB opens, started on Transfer —
  // not a second, nearly-identical form that could validate differently.
  onTransfer: (trigger) => records.openAdd(trigger, { kind: 'transfer' }),
});

const categories = createCategories({ store, router, announce, reassign });

function paint(route) {
  paintTabState(route);
  paintPeriod(route);

  // On a wide screen Records is shown with its breakdown beside it, so the
  // ledger and the shape of it are legible together. The route is unchanged
  // — Records is still the tab you are on, and the companion is a second
  // column of it rather than a second selection.
  const companion = SPLIT.matches ? COMPANION[route.tab] ?? null : null;
  $('pane-region').dataset.split = companion ? 'true' : 'false';

  for (const tab of TABS) {
    const pane = $(`pane-${tab}`);
    pane.hidden = tab !== route.tab && tab !== companion;
    pane.style.viewTransitionName = tab === route.tab ? 'pane' : '';
  }

  // Records always paints: it owns the period figures in the header, which
  // are true of the period whichever tab is showing them. Analysis rebuilds
  // its charts whole, so it paints only when it is on screen — as the tab,
  // or as the companion column beside Records.
  records.paint(route);
  // The other panes rebuild whole, so each paints only when it is on screen.
  if (route.tab === 'analysis' || companion === 'analysis') analysis.paint(route);
  else if (route.tab === 'budgets') budgets.paint(route);
  else if (route.tab === 'accounts') accounts.paint(route);
  else if (route.tab === 'categories') categories.paint(route);

  // Filters are part of the URL, so the field reflects the route rather than
  // the route reflecting the field.
  const search = $('search-input');
  if (document.activeElement !== search && search.value !== route.query) {
    search.value = route.query;
  }
  if (route.query && $('search-field').hidden) openSearch(false);

  paintChoice('opt-mode', route.mode);
  painted = true;
}

/* ------------------------------------------------------------ steppers */

/**
 * One step of whatever mode is current — a day, a week, a month, a quarter, a
 * half or a year. The announcement is the point of the live region on the
 * label: a stepper that changes the whole screen silently leaves a screen
 * reader user with no idea where they now are.
 */
function stepPeriod(delta) {
  const route = router.route;
  const anchor = stepAnchor(route.mode, anchorOf(route, TODAY), delta);
  if (!anchor) return;
  router.go({ period: periodFor(route.mode, anchor) });
  const label = periodRange(route.mode, anchor, weekStart())?.label ?? '';
  announce.say(`Showing ${label}.`);
}

const weekStart = () => store.getState().data.settings.weekStartsOn ?? 1;

$('period-prev').addEventListener('click', () => stepPeriod(-1));
$('period-next').addEventListener('click', () => stepPeriod(1));

/* -------------------------------------------------------------- search */

function openSearch(focus = true) {
  $('search-field').hidden = false;
  $('search-toggle').setAttribute('aria-expanded', 'true');
  if (focus) $('search-input').focus();
}

function closeSearch() {
  $('search-field').hidden = true;
  $('search-toggle').setAttribute('aria-expanded', 'false');
  if (router.route.query) router.go({ query: '' });
  $('search-input').value = '';
}

$('search-toggle').addEventListener('click', () => {
  if ($('search-field').hidden) openSearch();
  else closeSearch();
});
$('search-clear').addEventListener('click', () => {
  closeSearch();
  $('search-toggle').focus();
});

let searchTimer = null;
$('search-input').addEventListener('input', () => {
  clearTimeout(searchTimer);
  // Debounced, and replacing rather than pushing: typing eight characters
  // should not cost eight presses of the back button.
  searchTimer = setTimeout(() => router.go({ query: $('search-input').value }, { replace: true }), 200);
});

/* -------------------------------------------------------------- drawer */

let drawerReturnFocus = null;

function openDrawer() {
  const drawer = $('drawer');
  // Whatever had focus, falling back to the control that opens the drawer —
  // a programmatic open, or a click the browser did not focus, would
  // otherwise strand focus on <body> when the drawer closes again.
  drawerReturnFocus = document.activeElement === document.body
    ? $('drawer-open')
    : document.activeElement;

  drawer.dataset.open = 'true';
  drawer.removeAttribute('inert');
  drawer.setAttribute('aria-hidden', 'false');
  $('drawer-scrim').hidden = false;
  $('drawer-open').setAttribute('aria-expanded', 'true');
  document.body.style.overflow = 'hidden';

  // The panel is `visibility: hidden` until it slides in, and nothing inside
  // a hidden subtree can take focus. Force the style to settle before asking
  // — waiting a frame would be the usual trick, but a document that is not
  // rendering never gives you the frame.
  void drawer.offsetWidth;
  $('drawer-close').focus();
}

function closeDrawer() {
  const drawer = $('drawer');
  delete drawer.dataset.open;
  drawer.setAttribute('inert', '');
  drawer.setAttribute('aria-hidden', 'true');
  $('drawer-scrim').hidden = true;
  $('drawer-open').setAttribute('aria-expanded', 'false');
  $('drawer-note').textContent = '';
  document.body.style.overflow = '';
  const back = drawerReturnFocus && document.contains(drawerReturnFocus)
    ? drawerReturnFocus
    : $('drawer-open');
  back.focus();
  drawerReturnFocus = null;
}

$('drawer-open').addEventListener('click', openDrawer);
$('drawer-close').addEventListener('click', closeDrawer);
$('drawer-scrim').addEventListener('click', closeDrawer);

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && $('drawer').dataset.open) {
    event.preventDefault();
    closeDrawer();
  }
});

/* ------------------------------------------------------- the data tools --
   Export, restore and delete, plus the storage-problem banner. It is given
   `closeDrawer` rather than reaching for it: the drawer is the shell's, and
   a sheet opened from it has to close it before showing itself. */

const manageData = createManageData({ store, announce, closeDrawer });

/* The banner and the drawer's inventory are the only two things in the shell
   that follow the data rather than the route, so this is the shell's one
   subscription. Everything else here is furniture. */
store.subscribe((snapshot) => manageData.render(snapshot));

/* ---------------------------------------------------------- the FAB --
   One button, opening the full form with its kind control at the top. Not a
   speed dial: three fanned targets to reach the same dialog is three chances
   to hit the wrong one. */

$('fab').addEventListener('click', () => records.openAdd($('fab')));

$('filter-open').addEventListener('click', () => records.openFilters($('filter-open')));

/* `/` is the quick-add shortcut, `n` opens the full form. Both are ignored
   while a field or a dialog already has the keyboard. */
document.addEventListener('keydown', (event) => {
  if (event.ctrlKey || event.metaKey || event.altKey) return;
  const el = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
    || el.tagName === 'SELECT' || el.isContentEditable);
  if (typing || document.querySelector('dialog[open]')) return;

  if (event.key === '/') {
    event.preventDefault();
    records.focusQuickAdd();
  } else if (event.key === 'n') {
    event.preventDefault();
    records.openAdd(document.activeElement);
  }
});

/* ------------------------------------------------- radiogroup helper --
   The behaviour lives in ui/choice.js, so the sheets and the Analysis view
   switch are the same control. These two adapters exist only so the call
   sites below can keep naming a group by its id. */

const paintChoice = (groupId, value) => paintChoiceIn($(groupId), value);
const wireChoice = (groupId, onPick) => wireChoiceIn($(groupId), onPick);

/* ---------------------------------------------------------- the sheets */

function openSheet(dialog, trigger) {
  dialog.returnFocusTo = trigger ?? document.activeElement;
  dialog.showModal();
}

for (const [dialogId, closeId] of [['prefs-dialog', 'prefs-close'], ['display-dialog', 'display-close']]) {
  const dialog = $(dialogId);
  $(closeId).addEventListener('click', () => dialog.close());
  dialog.addEventListener('close', () => {
    // Preferences is opened from the drawer, so its trigger is inert by the
    // time this runs; Display options is opened from the period bar and its
    // trigger is still there. One rule covers both.
    restoreFocus(dialog.returnFocusTo, $('drawer-open'));
    dialog.returnFocusTo = null;
  });
}

$('open-prefs').addEventListener('click', () => {
  const trigger = $('open-prefs');
  closeDrawer();
  openSheet($('prefs-dialog'), trigger);
});

$('display-open').addEventListener('click', () => openSheet($('display-dialog'), $('display-open')));

/* ---------------------------------------------------------- preferences */

const THEMES = ['system', 'light', 'dark'];

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

wireChoice('opt-theme', (value) => {
  if (!THEMES.includes(value)) return;
  store.setSetting('theme', value);
  applyTheme(value);
  paintChoice('opt-theme', value);
  announce.say(`Theme set to ${value}.`);
});

wireChoice('opt-decimals', (value) => {
  const on = value === 'yes';
  store.setSetting('showDecimals', on);
  paintChoice('opt-decimals', value);
  records.paint(router.route);
  announce.say(on ? 'Decimals shown.' : 'Decimals hidden.');
});

/* Heft view flips one attribute on <html>; the CSS consuming --t does the
   rest. The scale that produces --t is untouched by the toggle. */
wireChoice('opt-heft', (value) => {
  const on = value === 'on';
  store.setSetting('heftView', on);
  document.documentElement.dataset.heft = String(on);
  paintChoice('opt-heft', value);
  announce.say(on ? 'Heft view on: rows scale with amount.' : 'Heft view off: uniform rows.');
});

/**
 * Switching mode keeps the day you were looking at and re-reads it under the
 * new mode, so stepping from a week in August into monthly lands on August
 * rather than on today.
 */
wireChoice('opt-mode', (value) => {
  if (!VIEW_MODES.includes(value)) return;
  const anchor = anchorOf(router.route, TODAY);
  store.setSetting('viewMode', value);
  router.go({ mode: value, period: periodFor(value, anchor) });
  paintChoice('opt-mode', value);
  announce.say(`${periodRange(value, anchor, weekStart())?.label ?? value} shown.`);
});

wireChoice('opt-total', (value) => {
  const on = value === 'on';
  store.setSetting('showTotal', on);
  paintChoice('opt-total', value);
  records.paint(router.route);
  announce.say(on ? 'Total shown.' : 'Total hidden.');
});

/* Carry-over is not a display toggle in the way the others are: it changes
   the number rather than only whether it is drawn. The copy in the sheet says
   so, and the repaint below is what makes it true. */
wireChoice('opt-carry', (value) => {
  const on = value === 'on';
  store.setSetting('carryOver', on);
  paintChoice('opt-carry', value);
  records.paint(router.route);
  announce.say(on
    ? 'Carry over on: the total opens with what was left over.'
    : 'Carry over off: each period stands alone.');
});

/* Crossing the breakpoint changes which panes are on screen and where the
   add button lives, neither of which CSS can do on its own. Repainting the
   current route is enough: every other difference is in the stylesheet. */
const onBreakpoint = () => {
  placeAddButton();
  if (painted) paint(router.route);
};
WIDE.addEventListener('change', onBreakpoint);
SPLIT.addEventListener('change', onBreakpoint);

/* ---------------------------------------------------------------- boot */

placeAddButton();

store.init();

const settings = store.getState().data.settings;
applyTheme(settings.theme ?? 'system');
document.documentElement.dataset.heft = String(settings.heftView === true);
paintChoice('opt-theme', settings.theme ?? 'system');
paintChoice('opt-decimals', settings.showDecimals === false ? 'no' : 'yes');
paintChoice('opt-heft', settings.heftView === true ? 'on' : 'off');
paintChoice('opt-total', settings.showTotal === false ? 'off' : 'on');
paintChoice('opt-carry', settings.carryOver === true ? 'on' : 'off');

router.start();

addEventListener('pagehide', () => store.flush());
