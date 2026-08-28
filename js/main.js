/**
 * main.js — wiring only.
 *
 * Reads from the store, hands derived data to the views, and turns DOM events
 * back into store calls. It owns nothing except the bits that are genuinely
 * about the document: the URL hash, the theme attribute, and focus.
 */

import { createStore, UNDO_WINDOW_MS } from './store.js';
import { formatAmount, formatINR } from './lib/money.js';
import {
  addMonths, formatMonth, monthKey, today as todayISO,
} from './lib/dates.js';
import { monthDelta, totalPaise } from './lib/analytics.js';
import {
  applyFilters, describeFilters, filtersToHash, hasNarrowingFilters, parseFilterHash,
} from './lib/filters.js';
import { createLedger } from './ui/ledger.js';
import { createExpenseForm } from './ui/expense-form.js';
import { createQuickAdd } from './ui/quick-add.js';
import { createCharts } from './ui/charts.js';
import { createBudgets, createBudgetDialog } from './ui/budgets.js';
import { createDataTools } from './ui/data.js';
import { createCategoryManager } from './ui/categories.js';
import { createAnnouncer } from './ui/announcer.js';

const $ = (id) => document.getElementById(id);

const el = {
  themeButton: $('theme-button'),
  themeLabel: $('theme-label'),
  saveBanner: $('save-banner'),
  saveBannerText: $('save-banner-text'),
  saveBannerDismiss: $('save-banner-dismiss'),
  monthPrev: $('month-prev'),
  monthNext: $('month-next'),
  monthName: $('month-name'),
  monthTotal: $('month-total-digits'),
  monthDelta: $('month-delta'),
  filters: $('filters'),
  query: $('filter-query'),
  scope: $('filter-scope'),
  categoryChips: $('category-chips'),
  methodChips: document.querySelectorAll('#filter-methods .chip'),
  filterSummary: $('filter-summary'),
  filterSummaryText: $('filter-summary-text'),
  clearFilters: $('clear-filters'),
  emptyClearFilters: $('empty-clear-filters'),
  ledgerCount: $('ledger-count'),
  ledger: $('ledger'),
  emptyFresh: $('empty-fresh'),
  emptyFiltered: $('empty-filtered'),
  emptyFilteredDetail: $('empty-filtered-detail'),
  loadSample: $('load-sample'),
  footerCount: $('footer-count'),
  undoDock: $('undo-dock'),
  undoText: $('undo-text'),
  undoButton: $('undo-button'),
  undoBar: $('undo-bar'),
  announcer: $('announcer'),
  dialog: $('expense-dialog'),
  qaForm: $('qa-form'),
  qaInput: $('qa-input'),
  qaPreview: $('qa-preview'),
  qaNotice: $('qa-notice'),
  qaLive: $('qa-live'),
  addDetails: $('add-details'),
  helpButton: $('help-button'),
  helpDialog: $('help-dialog'),
  analysis: $('analysis'),
  analysisScope: $('analysis-scope'),
  analysisPanels: $('analysis-panels'),
  budgets: $('budgets'),
  budgetList: $('budget-list'),
  budgetsEmpty: $('budgets-empty'),
  budgetsScope: $('budgets-scope'),
  budgetDialog: $('budget-dialog'),
  importDialog: $('import-dialog'),
  categoryDialog: $('category-dialog'),
  dangerDialog: $('danger-dialog'),
  dataMeta: $('data-meta'),
};

const TODAY = todayISO();
const store = createStore();
const announce = createAnnouncer(el.announcer);

/** The month to return to when the range goes from "all" back to a month. */
let viewMonth = monthKey(TODAY);
/** Set while a render is being driven by month navigation. */
let pendingDirection = null;
/** The first paint fills an empty list; nothing should fly in. */
let hasRendered = false;

const ledger = createLedger({
  list: el.ledger,
  dayTemplate: $('tpl-day'),
  rowTemplate: $('tpl-row'),
  onEdit: handleEdit,
  onDelete: handleDelete,
});

const charts = createCharts({
  root: el.analysisPanels,
  panelTemplate: $('tpl-panel'),
});

const dataTools = createDataTools({
  exportButton: $('export-json'),
  importButton: $('import-open'),
  importDialog: el.importDialog,
  dangerButton: $('delete-all'),
  dangerDialog: el.dangerDialog,
  metaNode: el.dataMeta,
  getState: () => store.getState().data,
  onImport(incoming, mode) {
    const result = store.importState(incoming, mode);
    announce.say(result.ok
      ? `Imported. You now have ${result.expenses} expenses.`
      : 'That import could not be applied.');
  },
  onDeleteAll() {
    const result = store.clearAll();
    announce.say(`Deleted ${result.removed} expenses. Your categories and budgets are still here.`);
  },
  announce: announce.say,
});

const categoryManager = createCategoryManager({
  dialog: el.categoryDialog,
  openButtons: document.querySelectorAll('[data-action="edit-categories"]'),
  getState: () => store.getState().data,
  onRename: (id, name) => store.updateCategory(id, { name }),
  onRecolour: (id, colorToken) => store.updateCategory(id, { colorToken }),
  onAdd: (draft) => store.addCategory(draft),
  onDelete: (id, options) => store.deleteCategory(id, options),
  announce: announce.say,
});

const budgetDialog = createBudgetDialog({
  dialog: el.budgetDialog,
  onSave(changes) {
    for (const change of changes) store.updateCategory(change.id, { budgetPaise: change.budgetPaise });
    const tracked = changes.filter((c) => c.budgetPaise !== null).length;
    announce.say(tracked === 0
      ? 'Budgets cleared. No categories are tracked.'
      : `Budgets saved. ${tracked} ${tracked === 1 ? 'category is' : 'categories are'} tracked.`);
  },
  announce: announce.say,
});

const budgets = createBudgets({
  root: el.budgetList,
  rowTemplate: $('tpl-budget'),
  emptyNode: el.budgetsEmpty,
  scopeNode: el.budgetsScope,
  onEdit(trigger) {
    budgetDialog.open({ categories: store.getState().data.categories, trigger });
  },
});

const expenseForm = createExpenseForm({
  dialog: el.dialog,
  onSave(id, values) {
    // id is null in add mode.
    const result = id ? store.updateExpense(id, values) : store.addExpense(values);
    if (!result.ok) {
      announce.say('That expense could not be saved.');
      return;
    }
    announce.say(id
      ? `Saved. ${formatINR(values.amountPaise)}.`
      : `Added ${formatINR(values.amountPaise)}.`);
    if (!id) reportWhereItLanded(result.expense);
  },
  announce: announce.say,
});

const quickAdd = createQuickAdd({
  form: el.qaForm,
  input: el.qaInput,
  preview: el.qaPreview,
  hint: el.qaNotice,
  live: el.qaLive,
  getContext() {
    const { data, ui } = store.getState();
    return {
      categories: data.categories,
      today: TODAY,
      defaultCategoryId: ui.filters.categoryIds.length === 1
        // Filtering to one category is a strong hint about what you are logging.
        ? ui.filters.categoryIds[0]
        : data.settings.defaultCategoryId,
    };
  },
  onSubmit(draft) {
    const result = store.addExpense(draft);
    if (!result.ok) {
      announce.say('That expense could not be added.');
      return;
    }
    announce.say(`Added ${formatINR(draft.amountPaise)}.`);
    reportWhereItLanded(result.expense);
  },
  onOpenDetails: openAddDialog,
});

/**
 * An expense added while looking at another month, or under filters that
 * exclude it, would vanish on submit. Say where it went, and offer to go
 * there — rather than silently swallowing it or hijacking the view.
 */
function reportWhereItLanded(expense) {
  const { ui } = store.getState();
  const visible = applyFilters([expense], ui.filters).length === 1;
  if (visible) {
    quickAdd.clearNotice();
    return;
  }
  const target = monthKey(expense.date);
  const sameMonth = ui.filters.month === 'all' || ui.filters.month === target;
  quickAdd.showNotice(
    sameMonth
      ? `Added ${formatINR(expense.amountPaise)}, but your filters hide it.`
      : `Added ${formatINR(expense.amountPaise)} to ${formatMonth(target)}.`,
    {
      label: sameMonth ? 'Clear filters' : `Show ${formatMonth(target)}`,
      run() {
        if (sameMonth) {
          store.setFilters({ categoryIds: [], methods: [], query: '' });
          el.query.value = '';
        } else {
          viewMonth = target;
          store.setFilters({ month: target, categoryIds: [], methods: [], query: '' });
          el.query.value = '';
        }
        announce.say('Showing the expense you just added.');
      },
    },
  );
}

function openAddDialog(draft) {
  const { data, ui } = store.getState();
  expenseForm.openAdd({
    draft: draft && !draft.error ? draft : { date: TODAY },
    categories: data.categories,
    defaultCategoryId: ui.filters.categoryIds.length === 1
      ? ui.filters.categoryIds[0]
      : data.settings.defaultCategoryId,
    trigger: document.activeElement,
  });
}

el.addDetails.addEventListener('click', () => openAddDialog(quickAdd.parse));

/* ----------------------------------------------------------------- help */

let helpTrigger = null;

function openHelp(trigger) {
  helpTrigger = trigger ?? null;
  el.helpDialog.showModal();
}
el.helpButton.addEventListener('click', () => openHelp(el.helpButton));
for (const id of ['help-close', 'help-done']) {
  $(id).addEventListener('click', () => el.helpDialog.close());
}
el.helpDialog.addEventListener('close', () => {
  if (helpTrigger && document.contains(helpTrigger)) helpTrigger.focus();
  helpTrigger = null;
});

/* ------------------------------------------------------------------ theme */

const THEMES = ['system', 'light', 'dark'];
const THEME_LABEL = { system: 'System', light: 'Light', dark: 'Dark' };

function applyTheme(theme) {
  if (theme === 'system') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
  el.themeLabel.textContent = THEME_LABEL[theme];
  el.themeButton.setAttribute('aria-label', `Theme: ${THEME_LABEL[theme]}. Change theme.`);
  const icon = el.themeButton.querySelector('use');
  icon.setAttribute('href', theme === 'dark' ? '#i-moon' : '#i-sun');
}

el.themeButton.addEventListener('click', () => {
  const current = store.getState().data.settings.theme ?? 'system';
  const next = THEMES[(THEMES.indexOf(current) + 1) % THEMES.length];
  store.setSetting('theme', next);
  applyTheme(next);
  announce.say(`Theme set to ${THEME_LABEL[next].toLowerCase()}.`);
});

/* ------------------------------------------------------------ URL state */

let writingHash = false;

function pushFiltersToHash(filters) {
  const hash = filtersToHash(filters, 'all');
  const url = `${location.pathname}${location.search}${hash}`;
  if (`${location.pathname}${location.search}${location.hash}` === url) return;
  writingHash = true;
  history.replaceState(null, '', url || location.pathname);
  writingHash = false;
}

function readFiltersFromHash() {
  const filters = parseFilterHash(location.hash, { month: monthKey(TODAY) });
  if (filters.month !== 'all') viewMonth = filters.month;
  store.setFilters(filters);
}

window.addEventListener('hashchange', () => {
  if (writingHash) return;
  readFiltersFromHash();
});

/* ----------------------------------------------------------- filter UI */

let chipSignature = null;

function buildCategoryChips(categories) {
  // Categories are editable now, so compare identity and not just the count.
  const signature = categories.map((c) => `${c.id}:${c.name}:${c.colorToken}`).join('|');
  if (signature === chipSignature) return;
  chipSignature = signature;
  el.categoryChips.replaceChildren(...categories.map((cat) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'chip';
    button.dataset.category = cat.id;
    button.setAttribute('aria-pressed', 'false');

    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.setProperty('--cat', `var(--${cat.colorToken})`);

    button.append(dot, document.createTextNode(cat.name));
    button.addEventListener('click', () => toggleCategory(cat.id));
    return button;
  }));
}

function toggleCategory(id) {
  const current = store.getState().ui.filters.categoryIds;
  const next = current.includes(id) ? current.filter((c) => c !== id) : [...current, id];
  store.setFilters({ categoryIds: next });
}

for (const chip of el.methodChips) {
  chip.addEventListener('click', () => {
    const method = chip.dataset.method;
    const current = store.getState().ui.filters.methods;
    const next = current.includes(method)
      ? current.filter((m) => m !== method)
      : [...current, method];
    store.setFilters({ methods: next });
  });
}

let queryTimer = null;
el.query.addEventListener('input', () => {
  clearTimeout(queryTimer);
  queryTimer = setTimeout(() => store.setFilters({ query: el.query.value }), 160);
});

el.scope.addEventListener('change', () => {
  store.setFilters({ month: el.scope.value === 'all' ? 'all' : viewMonth });
});

el.filters.addEventListener('submit', (event) => event.preventDefault());

function clearFilters() {
  store.setFilters({ categoryIds: [], methods: [], query: '' });
  el.query.value = '';
  el.query.focus();
  announce.say('Filters cleared.');
}
el.clearFilters.addEventListener('click', clearFilters);
el.emptyClearFilters.addEventListener('click', clearFilters);

/* ---------------------------------------------------------- month nav */

function stepMonth(delta) {
  const filters = store.getState().ui.filters;
  if (filters.month === 'all') return;
  viewMonth = addMonths(filters.month, delta);
  pendingDirection = delta > 0 ? 'next' : 'prev';
  store.setFilters({ month: viewMonth });
  announce.say(`Showing ${formatMonth(viewMonth)}.`);
}

el.monthPrev.addEventListener('click', () => stepMonth(-1));
el.monthNext.addEventListener('click', () => stepMonth(1));

/* --------------------------------------------------------------- rows */

function handleEdit(id) {
  const { data } = store.getState();
  const expense = data.expenses.find((e) => e.id === id);
  if (!expense) return;
  expenseForm.openEdit({
    expense,
    categories: data.categories,
    trigger: document.activeElement,
  });
}

function handleDelete(id) {
  const { data } = store.getState();
  const expense = data.expenses.find((e) => e.id === id);
  if (!expense) return;
  const categoriesById = Object.fromEntries(data.categories.map((c) => [c.id, c]));
  const described = ledger.describe(
    expense,
    categoriesById[expense.categoryId]?.name ?? 'Unknown',
    TODAY,
  );

  const result = store.deleteExpense(id);
  if (!result.ok) return;

  el.undoText.textContent = `Deleted ${described}.`;
  announce.say(`Deleted ${described}. Undo is available for eight seconds.`);
  // Focus the undo itself: the user just did something destructive, so the
  // remedy should be the next thing under their hands, not a hunt for it.
  el.undoButton.focus();
}

el.undoButton.addEventListener('click', () => {
  const result = store.undoDelete();
  if (result.ok) {
    announce.say('Restored.');
    focusRow(result.expense.id);
  }
});

/**
 * After an undo the row is back but the undo button that had focus is gone.
 * Put focus on the restored row rather than letting it fall to <body>.
 * A timer rather than a frame: frames are throttled in a hidden tab.
 */
function focusRow(id) {
  setTimeout(() => {
    const button = el.ledger.querySelector(`[data-id="${CSS.escape(id)}"] .row-edit`);
    if (button) button.focus();
  }, 0);
}

/** Is the user typing? Single-key shortcuts must not fire inside a field. */
function isTyping(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

document.addEventListener('keydown', (event) => {
  const chord = event.ctrlKey || event.metaKey;

  if (chord && event.key.toLowerCase() === 'z' && store.getState().ui.pendingDelete) {
    event.preventDefault();
    el.undoButton.click();
    return;
  }

  // A dialog is modal; let it own the keyboard.
  if (document.querySelector('dialog[open]')) return;
  if (chord || event.altKey) return;

  if (event.key === '/' && !isTyping(event.target)) {
    event.preventDefault();
    quickAdd.focus();
    return;
  }
  if (event.key === '?' && !isTyping(event.target)) {
    event.preventDefault();
    openHelp(document.activeElement);
    return;
  }
  if (event.key.toLowerCase() === 'n' && !isTyping(event.target)) {
    event.preventDefault();
    openAddDialog(null);
  }
});

/* --------------------------------------------------------- sample data */

el.loadSample.addEventListener('click', () => {
  const result = store.loadSampleData();
  announce.say(`Loaded ${result.count} sample expenses across three months.`);
});

el.saveBannerDismiss.addEventListener('click', () => store.dismissSaveError());

/* -------------------------------------------------------------- render */

const SAVE_MESSAGES = {
  'quota-exceeded': 'Storage is full, so your latest change was not saved. Export your data, then remove some expenses to free space.',
  'write-failed': 'This browser refused to save to local storage. Your changes are in memory only and will be lost on reload.',
};
const LOAD_MESSAGES = {
  'malformed-json': 'Saved data could not be read, so Heft started empty. Nothing was overwritten.',
  'future-schema': 'Your saved data comes from a newer version of Heft. It was left untouched and Heft started empty.',
  unreadable: 'Local storage is unavailable in this browser context, so nothing will persist.',
};

function render(snapshot) {
  const { data, ui } = snapshot;
  const { filters } = ui;
  const categoriesById = Object.fromEntries(data.categories.map((c) => [c.id, c]));

  buildCategoryChips(data.categories);

  /* filter controls reflect state, not the other way round */
  for (const chip of el.categoryChips.children) {
    chip.setAttribute('aria-pressed', String(filters.categoryIds.includes(chip.dataset.category)));
  }
  for (const chip of el.methodChips) {
    chip.setAttribute('aria-pressed', String(filters.methods.includes(chip.dataset.method)));
  }
  const scopeValue = filters.month === 'all' ? 'all' : 'month';
  if (el.scope.value !== scopeValue) el.scope.value = scopeValue;
  if (document.activeElement !== el.query && el.query.value !== filters.query) {
    el.query.value = filters.query;
  }

  /* month header */
  const allMonths = filters.month === 'all';
  el.monthPrev.disabled = allMonths;
  el.monthNext.disabled = allMonths;
  el.monthName.textContent = allMonths ? 'All months' : formatMonth(filters.month);

  if (allMonths) {
    el.monthTotal.textContent = formatAmount(totalPaise(data.expenses));
    el.monthDelta.textContent = `${data.expenses.length} expenses, all time`;
    el.monthDelta.removeAttribute('data-direction');
  } else {
    const delta = monthDelta(data.expenses, filters.month);
    el.monthTotal.textContent = formatAmount(delta.totalPaise);
    el.monthDelta.dataset.direction = delta.direction;
    renderDelta(delta);
  }

  /* the visible set */
  const visible = applyFilters(data.expenses, filters);
  const narrowed = hasNarrowingFilters(filters);

  el.filterSummary.hidden = !narrowed;
  if (narrowed) {
    el.filterSummaryText.textContent = describeFilters(filters, categoriesById);
  }

  ledger.render(visible, { categoriesById, today: TODAY, animateEntry: hasRendered });
  hasRendered = true;

  /* Analysis is inherently per-month, so it picks one even when the ledger is
     showing every month. The narrowing filters still apply, which is what
     makes the donut's single-category case reachable. */
  const analysisMonth = allMonths ? monthKey(TODAY) : filters.month;
  const monthExpenses = applyFilters(data.expenses, { ...filters, month: analysisMonth });
  const historyExpenses = applyFilters(data.expenses, { ...filters, month: 'all' });

  el.analysisScope.textContent = narrowed
    ? `${formatMonth(analysisMonth)} · ${describeFilters(filters, categoriesById)}`
    : formatMonth(analysisMonth);

  /* Budgets deliberately use the whole month, not the filtered view: a budget
     is a fact about the month, and "Food ₹0 of ₹5,000" while filtered to
     Transport would simply be wrong. */
  budgets.render({
    expenses: data.expenses,
    categories: data.categories,
    monthKey: analysisMonth,
    today: TODAY,
  });
  el.budgets.hidden = data.expenses.length === 0
    && data.categories.every((c) => c.budgetPaise === null);

  charts.render({
    expenses: monthExpenses,
    allExpenses: historyExpenses,
    monthKey: analysisMonth,
    categoriesById,
    today: TODAY,
  });
  el.analysis.hidden = data.expenses.length === 0;

  const scoped = allMonths ? data.expenses.length : applyFilters(data.expenses, {
    ...filters, categoryIds: [], methods: [], query: '',
  }).length;
  el.ledgerCount.textContent = visible.length === scoped
    ? `${visible.length} ${visible.length === 1 ? 'expense' : 'expenses'} · ${formatINR(totalPaise(visible))}`
    : `${visible.length} of ${scoped} · ${formatINR(totalPaise(visible))} shown`;
  el.ledgerCount.hidden = visible.length === 0;

  /* the two empty states are different situations and read differently */
  const nothingAtAll = data.expenses.length === 0;
  el.emptyFresh.hidden = !nothingAtAll;
  el.emptyFiltered.hidden = nothingAtAll || visible.length > 0;
  if (!el.emptyFiltered.hidden) {
    el.emptyFilteredDetail.textContent = narrowed
      ? `Nothing in ${allMonths ? 'your ledger' : formatMonth(filters.month)} matches ${describeFilters(filters, categoriesById)}.`
      : `You have no expenses recorded in ${formatMonth(filters.month)}.`;
  }

  el.footerCount.textContent = String(data.expenses.length);
  dataTools.render(data);
  if (el.categoryDialog.open) categoryManager.refresh();

  /* undo dock */
  const pending = ui.pendingDelete;
  if (pending && el.undoDock.hidden) {
    el.undoDock.hidden = false;
    restartUndoBar();
  } else if (!pending && !el.undoDock.hidden) {
    el.undoDock.hidden = true;
  }

  /* storage problems are shown, never swallowed */
  const problem = SAVE_MESSAGES[ui.saveError] ?? LOAD_MESSAGES[ui.loadWarning] ?? null;
  el.saveBanner.hidden = !problem;
  if (problem) el.saveBannerText.textContent = problem;

  pushFiltersToHash(filters);
}

function renderDelta(delta) {
  el.monthDelta.replaceChildren();
  if (delta.previousPaise === 0 && delta.totalPaise === 0) {
    el.monthDelta.append('Nothing recorded this month');
    return;
  }
  if (delta.deltaPercent === null) {
    el.monthDelta.append(`No spending in ${formatMonth(delta.previousKey)} to compare`);
    return;
  }
  if (delta.direction !== 'flat') {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', delta.direction === 'up' ? '#i-rise' : '#i-fall');
    svg.append(use);
    el.monthDelta.append(svg);
  }
  const sign = delta.direction === 'up' ? '+' : delta.direction === 'down' ? '−' : '';
  const pct = Math.abs(delta.deltaPercent);
  el.monthDelta.append(
    `${formatINR(Math.abs(delta.deltaPaise))} ${sign}${pct.toFixed(0)}% vs ${formatMonth(delta.previousKey, { short: true })}`,
  );
}

function restartUndoBar() {
  const bar = el.undoBar;
  bar.style.animation = 'none';
  void bar.offsetWidth; // reflow, so the animation restarts from full width
  bar.style.animation = '';
}

/* ---------------------------------------------------------------- boot */

// Order matters: the incoming hash is read and the data loaded BEFORE the
// first render, because rendering writes the hash back. Subscribing first
// would rewrite the URL from default filters and discard a shared link.
readFiltersFromHash();
store.init();
applyTheme(store.getState().data.settings.theme ?? 'system');

store.subscribe((snapshot) => {
  if (pendingDirection && document.startViewTransition
      && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    // A month change swaps the entire list; a view transition sells that as
    // one movement. Ordinary filter changes deliberately skip it, so the CSS
    // interpolation is visible as the topography re-forms in place.
    pendingDirection = null;
    const transition = document.startViewTransition(() => render(snapshot));
    // A transition interrupted by a reload or a second navigation rejects.
    // That is expected, not an error; swallow it rather than leaving an
    // unhandled rejection in the console.
    transition.ready.catch(() => {});
    transition.finished.catch(() => {});
  } else {
    pendingDirection = null;
    render(snapshot);
  }
});

// Never lose a change to a debounce that never fired.
addEventListener('pagehide', () => store.flush());
addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') store.flush();
});
