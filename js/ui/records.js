/**
 * records.js — the Records tab.
 *
 * Owns everything between the period bar and the tab bar: the filter chips,
 * the quick-add line, the ledger, the three empty states, the detail sheet
 * and the undo bar. It reads the route, derives the visible set, and hands it
 * to the reconciling renderer. It writes nothing to storage — every mutation
 * goes through the store, and the store notifies back.
 *
 * The filter state lives in the URL and nowhere else. There is no local copy
 * to fall out of step with it: a chip removal is a route change, and the
 * repaint that follows is the same repaint a pasted link would produce.
 */

import { applyFilters, describeFilters, hasNarrowingFilters, makeFilters } from '../lib/filters.js';
import { anchorOf } from '../lib/router.js';
import { formatDay, periodRange } from '../lib/dates.js';
import { netPaise, periodTotals } from '../lib/analytics.js';
import { money, netMoney, signedMoney } from '../lib/format.js';
import { createLedger } from './ledger.js';
import { createQuickAdd } from './quick-add.js';
import { createTransactionForm, draftShapeFor, kindOf } from './transaction-form.js';
import { icon } from './icon.js';

const $ = (id) => document.getElementById(id);

const KIND_LABELS = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };

/** How often the undo bar redraws its countdown. */
const TICK_MS = 250;

export function createRecords({ store, router, announce, today, undoWindowMs, onTotals }) {
  const els = {
    pane: $('pane-records'),
    ledger: $('ledger'),
    chips: $('chips'),
    chipList: $('chip-list'),
    chipsClear: $('chips-clear'),
    emptyAll: $('empty-all'),
    emptyPeriod: $('empty-period'),
    emptyFiltered: $('empty-filtered'),
    emptyFilterNames: $('empty-filter-names'),
    emptyPeriodBody: $('empty-period-body'),
    undobar: $('undobar'),
    undoText: $('undo-text'),
    undoButton: $('undo-button'),
    undoClock: $('undo-clock'),
    detail: $('detail-dialog'),
    detailAmount: $('detail-amount'),
    detailList: $('detail-list'),
    filterDialog: $('filter-dialog'),
    filterKinds: $('filter-kinds'),
    filterCategories: $('filter-categories'),
    filterAccounts: $('filter-accounts'),
    filterQuery: $('filter-query'),
  };

  for (const [id, name] of [
    ['detail-close', 'close'], ['filter-close', 'close'], ['transaction-cancel', 'close'],
  ]) $(id)?.prepend(icon(name));

  /** The last snapshot the store handed us. */
  let snap = store.getState();
  /** The transaction the detail sheet is showing. */
  let detailId = null;
  /** Set while an undo is offered, so the bar can count down. */
  let undoUntil = 0;
  let undoTimer = 0;

  const display = () => ({ showDecimals: snap.data.settings.showDecimals !== false });
  const byId = (items) => Object.fromEntries(items.map((i) => [i.id, i]));

  /* ------------------------------------------------------------ derived */

  /** The route, as filters. The period is a range, never a month. */
  function filtersFor(route) {
    const weekStartsOn = snap.data.settings.weekStartsOn ?? 1;
    return makeFilters({
      range: periodRange(route.mode, anchorOf(route, today), weekStartsOn),
      kinds: route.kinds,
      categoryIds: route.categoryIds,
      accountIds: route.accountIds,
      query: route.query,
    });
  }

  /* -------------------------------------------------------------- ledger */

  const ledger = createLedger({
    list: els.ledger,
    dayTemplate: $('tpl-day'),
    rowTemplate: $('tpl-row'),
    onOpen: openDetail,
  });

  /* --------------------------------------------------------------- form */

  const form = createTransactionForm({
    dialog: $('transaction-dialog'),
    onSave(id, values) {
      const result = id === null
        ? store.addTransaction(values)
        : store.updateTransaction(id, values);
      if (!result.ok) {
        announce.say(`Could not save: ${result.reason}.`);
        return;
      }
      announce.say(id === null ? 'Added.' : 'Saved.');
    },
    announce,
  });

  /* ---------------------------------------------------------- quick add */

  const quickAdd = createQuickAdd({
    form: $('qa-form'),
    input: $('qa-input'),
    preview: $('qa-preview'),
    hint: $('qa-notice'),
    live: $('qa-live'),
    getContext: () => ({
      categories: snap.data.categories,
      accounts: snap.data.accounts,
      today,
      defaultCategoryId: snap.data.settings.defaultExpenseCategoryId,
      defaultAccountId: snap.data.settings.defaultAccountId,
      display: display(),
    }),
    onSubmit(parsed) {
      const result = store.addTransaction(draftFromParse(parsed));
      if (!result.ok) {
        quickAdd.showNotice(`Could not add that: ${result.reason}.`);
        return;
      }
      const described = ledger.describe(result.transaction, {
        categoriesById: byId(snap.data.categories),
        accountsById: byId(snap.data.accounts),
        today,
        display: display(),
      });
      announce.say(`Added ${described}.`);

      // Added outside what is on screen? Say so, and offer the way there —
      // silently adding a record the user cannot see is how a ledger loses
      // someone's trust.
      const filters = filtersFor(router.route);
      if (applyFilters([result.transaction], filters).length === 0) {
        quickAdd.showNotice('Added outside this view.', {
          label: 'Show it',
          run: () => router.go({
            period: result.transaction.date, mode: 'daily', kinds: [], categoryIds: [], accountIds: [], query: '',
          }),
        });
      }
    },
    onOpenDetails(parsed) {
      form.openAdd({
        draft: parsed?.ok ? draftFromParse(parsed) : {},
        categories: snap.data.categories,
        accounts: snap.data.accounts,
        defaultCategoryId: snap.data.settings.defaultExpenseCategoryId,
        defaultAccountId: snap.data.settings.defaultAccountId,
        kind: parsed?.kind,
        trigger: $('qa-input'),
      });
    },
  });

  /**
   * The parser reports one word — 'expense' | 'income' | 'transfer'. The store
   * stores two fields, `kind` and `direction`, so that "is this a transfer"
   * and "which way does the money go" stay independent questions.
   * `draftShapeFor` is the one place that translation happens.
   */
  function draftFromParse(parsed) {
    return {
      ...draftShapeFor(parsed.kind),
      amountPaise: parsed.amountPaise,
      date: parsed.date,
      categoryId: parsed.categoryId,
      accountId: parsed.accountId,
      toAccountId: parsed.toAccountId,
      note: parsed.note,
    };
  }

  /* --------------------------------------------------------------- chips */

  /** One chip per filter atom, each removing exactly the thing it names. */
  function chipsFor(route) {
    const categories = byId(snap.data.categories);
    const accounts = byId(snap.data.accounts);
    const out = [];

    for (const kind of route.kinds) {
      out.push({
        label: KIND_LABELS[kind] ?? kind,
        remove: { kinds: route.kinds.filter((k) => k !== kind) },
      });
    }
    for (const id of route.categoryIds) {
      out.push({
        label: categories[id]?.name ?? id,
        token: categories[id]?.colorToken,
        remove: { categoryIds: route.categoryIds.filter((c) => c !== id) },
      });
    }
    for (const id of route.accountIds) {
      out.push({
        label: accounts[id]?.name ?? id,
        remove: { accountIds: route.accountIds.filter((a) => a !== id) },
      });
    }
    if (route.query.trim()) {
      out.push({ label: `“${route.query.trim()}”`, remove: { query: '' } });
    }
    return out;
  }

  function paintChips(route) {
    const chips = chipsFor(route);
    els.chips.hidden = chips.length === 0;
    if (chips.length === 0) {
      els.chipList.replaceChildren();
      return;
    }

    els.chipList.replaceChildren(...chips.map((chip) => {
      const li = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chip';
      // The name says what pressing it does, not merely what it is — a chip
      // reading only "Food" gives a screen reader no clue it is a control.
      button.setAttribute('aria-label', `Remove filter: ${chip.label}`);

      if (chip.token) {
        const dot = document.createElement('span');
        dot.className = 'chip-dot';
        dot.setAttribute('aria-hidden', 'true');
        dot.style.setProperty('--chip-color', `var(--${chip.token})`);
        button.append(dot);
      }
      button.append(chip.label, icon('close'));
      button.addEventListener('click', () => {
        router.go(chip.remove);
        announce.say(`${chip.label} filter removed.`);
      });
      li.append(button);
      return li;
    }));
  }

  els.chipsClear.addEventListener('click', clearFilters);
  $('empty-clear').addEventListener('click', clearFilters);

  function clearFilters() {
    router.go({ kinds: [], categoryIds: [], accountIds: [], query: '' });
    announce.say('Filters cleared.');
  }

  /* -------------------------------------------------------- empty states */

  /**
   * Three different facts, three different remedies. Which one is true is
   * decided here and nowhere else:
   *
   *   nothing stored at all      → how to make the first record
   *   nothing in this period     → how to reach a period that has some
   *   nothing matching filters   → one tap to drop them
   */
  function paintEmpty(route, filters, visible) {
    const nothingStored = snap.data.transactions.length === 0;
    const narrowed = hasNarrowingFilters(filters);
    const empty = visible.length === 0;

    els.emptyAll.hidden = !(empty && nothingStored);
    els.emptyFiltered.hidden = !(empty && !nothingStored && narrowed);
    els.emptyPeriod.hidden = !(empty && !nothingStored && !narrowed);
    els.ledger.hidden = empty;

    if (!els.emptyFiltered.hidden) {
      els.emptyFilterNames.textContent = describeFilters(
        filters, byId(snap.data.categories), byId(snap.data.accounts),
      );
    }
    if (!els.emptyPeriod.hidden) {
      // The range names itself, year included — "January 2020", "11–17 August
      // 2025". Spelling the bounds out by hand would drop the year and read
      // as "between 1 January and 31 January" from six years away.
      const label = filters.range?.label;
      els.emptyPeriodBody.textContent = label
        ? `Nothing recorded in ${label}. Your other records are still there.`
        : 'Your other records are still there.';
    }
  }

  $('empty-sample').addEventListener('click', () => {
    const result = store.loadSampleData({ months: 3 });
    if (result.ok) announce.say(`Loaded ${result.count} sample transactions.`);
  });

  $('empty-period-prev').addEventListener('click', () => stepPeriod(-1));
  $('empty-period-today').addEventListener('click', () => {
    router.go({ period: null });
    announce.say('Back to today.');
  });

  /** Wired by app.js, which owns the stepper buttons on the period bar. */
  let stepPeriod = () => {};
  const setStepper = (fn) => { stepPeriod = fn; };

  /* --------------------------------------------------------- detail sheet */

  function openDetail(id) {
    const transaction = snap.data.transactions.find((t) => t.id === id);
    if (!transaction) return;
    detailId = id;

    const kind = kindOf(transaction);
    const categories = byId(snap.data.categories);
    const accounts = byId(snap.data.accounts);
    const signed = signedMoney(transaction.amountPaise, kind, display());

    $('detail-title').textContent = KIND_LABELS[kind];
    els.detailAmount.textContent = signed.text;
    els.detailAmount.dataset.tone = signed.tone;
    // The word beside the figure, so the tone is never the only thing saying
    // which way the money went.
    const word = document.createElement('span');
    word.className = 'detail-word';
    word.textContent = signed.word;
    els.detailAmount.append(' ', word);

    const rows = [];
    if (kind === 'transfer') {
      rows.push(['From', accounts[transaction.accountId]?.name ?? 'Unknown']);
      rows.push(['To', accounts[transaction.toAccountId]?.name ?? 'Unknown']);
    } else {
      rows.push(['Category', categories[transaction.categoryId]?.name ?? 'Uncategorised']);
      rows.push(['Account', accounts[transaction.accountId]?.name ?? 'Unknown']);
    }
    rows.push(['Date', formatDay(transaction.date, { weekday: true })]);
    // The row truncates its note to one line; this is where the whole of it
    // is readable, however long it runs.
    if (transaction.note) rows.push(['Note', transaction.note]);

    els.detailList.replaceChildren(...rows.flatMap(([term, value]) => {
      const dt = document.createElement('dt');
      dt.textContent = term;
      const dd = document.createElement('dd');
      dd.textContent = value;
      if (term === 'Note') dd.className = 'detail-note';
      return [dt, dd];
    }));

    els.detail.returnFocusTo = document.activeElement;
    els.detail.showModal();
  }

  $('detail-close').addEventListener('click', () => els.detail.close());

  els.detail.addEventListener('close', () => {
    const back = els.detail.returnFocusTo;
    // The row may have been deleted out from under us, in which case there is
    // nothing to go back to and the undo bar takes focus instead.
    if (back && document.contains(back)) back.focus();
    els.detail.returnFocusTo = null;
  });

  $('detail-edit').addEventListener('click', () => {
    const transaction = snap.data.transactions.find((t) => t.id === detailId);
    if (!transaction) return;
    const trigger = els.detail.returnFocusTo;
    els.detail.close();
    form.openEdit({
      transaction,
      categories: snap.data.categories,
      accounts: snap.data.accounts,
      trigger: document.contains(trigger) ? trigger : null,
    });
  });

  $('detail-delete').addEventListener('click', () => {
    const transaction = snap.data.transactions.find((t) => t.id === detailId);
    if (!transaction) return;
    const described = ledger.describe(transaction, {
      categoriesById: byId(snap.data.categories),
      accountsById: byId(snap.data.accounts),
      today,
      display: display(),
    });

    els.detail.close();
    const result = store.deleteTransaction(transaction.id);
    if (!result.ok) {
      announce.say(`Could not delete: ${result.reason}.`);
      return;
    }
    offerUndo(described);
  });

  /* ------------------------------------------------------------ the undo --
     The case most implementations get wrong, so it is worth being explicit
     about what "right" means here:

     - The row disappears at once. An undo that leaves the row on screen is a
       confirmation dialog wearing a different hat.
     - The record is held in memory, not deleted and re-added, so undo
       restores it at its original index rather than appending it.
     - The button is a real button in the tab order, and focus moves to it.
       That is not stealing focus: the delete just destroyed the element that
       had it, so without this, focus falls to <body> and a keyboard user has
       to tab in from the top of the document to reach an eight-second
       control. Restoring focus somewhere useful IS the accessible behaviour.
     - It announces politely, once, with the same wording the row itself used.
     - It stays operable for the whole window and commits exactly when the
       store's timer fires. */

  function offerUndo(described) {
    undoUntil = Date.now() + undoWindowMs;
    els.undoText.textContent = `Deleted ${described}.`;
    els.undobar.hidden = false;
    paintClock();

    clearInterval(undoTimer);
    undoTimer = setInterval(paintClock, TICK_MS);

    els.undoButton.focus();
    const seconds = Math.round(undoWindowMs / 1000);
    announce.say(`Deleted ${described}. Undo is available for ${seconds} seconds.`);
  }

  function paintClock() {
    const left = Math.max(0, undoUntil - Date.now());
    els.undoClock.style.setProperty('--left', String(left / undoWindowMs));
    if (left === 0) clearInterval(undoTimer);
  }

  function hideUndo() {
    clearInterval(undoTimer);
    // The window can close while the button still holds focus — the offer
    // simply timed out under the user's hands. Hiding it then would leave the
    // keyboard on a hidden element with nowhere to tab from, so focus is
    // handed on deliberately before the bar goes.
    if (document.activeElement === els.undoButton) {
      const firstRow = els.ledger.querySelector('.row-open');
      (firstRow ?? $('qa-input')).focus();
    }
    els.undobar.hidden = true;
    undoUntil = 0;
  }

  els.undoButton.addEventListener('click', () => {
    const result = store.undoDelete();
    if (!result.ok) {
      hideUndo();
      return;
    }

    /* Focus first, hide second. The store's notify has already repainted the
       ledger synchronously, so the restored row exists to receive focus — and
       hiding the bar while its button still holds focus is what would strand
       the keyboard on a `hidden` element. */
    const row = els.ledger.querySelector(
      `[data-id="${CSS.escape(result.transaction.id)}"] .row-open`,
    );
    (row ?? $('qa-input')).focus();
    hideUndo();
    announce.say('Restored.');
  });

  /* ------------------------------------------------------- filter dialog */

  function fillFilterDialog(route) {
    for (const box of els.filterKinds.querySelectorAll('input')) {
      box.checked = route.kinds.includes(box.value);
    }

    const checkList = (host, items, selected) => {
      host.replaceChildren(...items.filter((i) => !i.archived).map((item) => {
        const label = document.createElement('label');
        label.className = 'check';
        const box = document.createElement('input');
        box.type = 'checkbox';
        box.value = item.id;
        box.checked = selected.includes(item.id);
        const text = document.createElement('span');
        text.textContent = item.name;
        label.append(box, text);
        return label;
      }));
    };

    checkList(els.filterCategories, snap.data.categories, route.categoryIds);
    checkList(els.filterAccounts, snap.data.accounts, route.accountIds);
    els.filterQuery.value = route.query;
  }

  const checkedIn = (host) => [...host.querySelectorAll('input:checked')].map((b) => b.value);

  function openFilters(trigger) {
    fillFilterDialog(router.route);
    els.filterDialog.returnFocusTo = trigger ?? document.activeElement;
    els.filterDialog.showModal();
  }

  $('filter-close').addEventListener('click', () => els.filterDialog.close());

  $('filter-reset').addEventListener('click', () => {
    els.filterDialog.close();
    clearFilters();
  });

  els.filterDialog.querySelector('form').addEventListener('submit', () => {
    router.go({
      kinds: checkedIn(els.filterKinds),
      categoryIds: checkedIn(els.filterCategories),
      accountIds: checkedIn(els.filterAccounts),
      query: els.filterQuery.value,
    });
  });

  els.filterDialog.addEventListener('close', () => {
    const back = els.filterDialog.returnFocusTo;
    if (back && document.contains(back)) back.focus();
    els.filterDialog.returnFocusTo = null;
  });

  /* -------------------------------------------------------------- paint */

  /**
   * The period figures, as the header shows them.
   *
   * Carry-over adds what was left over before this period opened. That is the
   * net of everything strictly earlier — identical to chaining every previous
   * period's surplus, because the surpluses telescope, and it cannot break on
   * a period with no data in it. Transfers are excluded by `netPaise` itself,
   * so money moved between your own accounts never enters the chain.
   */
  function totalsFor(filters, visible) {
    const totals = periodTotals(visible);
    const carry = snap.data.settings.carryOver === true && filters.range?.start
      ? netPaise(snap.data.transactions.filter((t) => t.date < filters.range.start))
      : 0;
    return { ...totals, openingPaise: carry, netPaise: totals.netPaise + carry };
  }

  function paint(route = router.route) {
    const filters = filtersFor(route);
    const visible = applyFilters(snap.data.transactions, filters);

    paintChips(route);
    paintEmpty(route, filters, visible);

    ledger.render(visible, {
      categoriesById: byId(snap.data.categories),
      accountsById: byId(snap.data.accounts),
      today,
      display: display(),
    });

    // The header figures describe the list underneath them, filters included.
    // A triad that ignored the filters would contradict what is on screen.
    onTotals(totalsFor(filters, visible));
  }

  /* ------------------------------------------------------- store updates --
     One repaint path. A route change and a store change both land here, so
     there is no second rendering route to fall out of step. */

  store.subscribe((next) => {
    snap = next;
    // The store clears its pending delete when the window closes; that is the
    // moment the removal is final and the offer has to go.
    if (!snap.ui.pendingDelete && !els.undobar.hidden) hideUndo();
    quickAdd.refresh();
    paint();
  });

  return {
    paint,
    openFilters,
    setStepper,
    focusQuickAdd: () => quickAdd.focus(),
    /**
     * The full form. `kind` starts it on a different segment — the Accounts
     * tab's "Move money" is this dialog opened on Transfer, not a second
     * nearly-identical form that could come to validate differently.
     */
    openAdd: (trigger, { kind, draft } = {}) => form.openAdd({
      categories: snap.data.categories,
      accounts: snap.data.accounts,
      defaultCategoryId: snap.data.settings.defaultExpenseCategoryId,
      defaultAccountId: snap.data.settings.defaultAccountId,
      kind,
      draft,
      trigger,
    }),
  };
}
