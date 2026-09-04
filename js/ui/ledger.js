/**
 * ledger.js — the reconciling renderer.
 *
 * Never rebuilds the list with innerHTML. Rows are cloned once from a
 * <template>, kept in a Map keyed by transaction id, and updated field by
 * field only where the value actually changed. That keeps focus, keeps text
 * selection, and keeps the browser from re-laying-out the whole month every
 * time one number moves.
 *
 * JavaScript's only contribution to a row's appearance is `--t`. Everything
 * else — size, weight, ink, padding, rule, spine — is interpolated in CSS.
 *
 * Row anatomy, following the reference:
 *
 *   (disc)  Food & Dining                              −₹320.00
 *           Bank · “Cold cocoa”
 *
 * The whole row is one button that opens the detail sheet. Edit and delete
 * live in that sheet rather than as two more targets per row: at forty rows
 * that would be a hundred and twenty tab stops to walk past.
 */

import { formatDay, formatRelativeDay } from '../lib/dates.js';
import { money, netMoney, signedMoney } from '../lib/format.js';
import { groupByDay, isIncome, isTransfer, ledgerWeightScale } from '../lib/analytics.js';
import { icon } from './icon.js';

const kindOf = (t) => (isTransfer(t) ? 'transfer' : isIncome(t) ? 'income' : 'expense');

const NOUN = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };

/** Typographic quotes, and only ever around a note that exists. */
const quoted = (note) => `“${note}”`;

/**
 * @param {{list: Element, dayTemplate: HTMLTemplateElement,
 *   rowTemplate: HTMLTemplateElement, onOpen: (id: string) => void}} opts
 */
export function createLedger({ list, dayTemplate, rowTemplate, onOpen }) {
  /** date -> { li, ul, refs, snap } */
  const days = new Map();
  /** id -> { li, refs, snap } */
  const rows = new Map();

  const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function buildRow(id) {
    const li = rowTemplate.content.firstElementChild.cloneNode(true);
    const refs = {
      button: li.querySelector('.row-open'),
      chip: li.querySelector('.row-chip'),
      title: li.querySelector('.row-title'),
      account: li.querySelector('.row-account'),
      accountMark: li.querySelector('.row-account-mark'),
      accountName: li.querySelector('.row-account-name'),
      note: li.querySelector('.row-note'),
      amount: li.querySelector('.row-amount-text'),
    };
    li.dataset.id = id;
    refs.button.addEventListener('click', () => onOpen(id));
    return { li, refs, snap: {} };
  }

  function buildDay(date) {
    const li = dayTemplate.content.firstElementChild.cloneNode(true);
    return {
      li,
      ul: li.querySelector('.day-rows'),
      refs: {
        relative: li.querySelector('.day-relative'),
        date: li.querySelector('.day-date'),
        net: li.querySelector('.day-net'),
        netText: li.querySelector('.day-net-text'),
        netWord: li.querySelector('.day-net-word'),
      },
      snap: {},
    };
  }

  /** Collapse, then detach. The Map entry is dropped by the caller first. */
  function detach(node, { animate }) {
    if (!animate) {
      node.remove();
      return;
    }
    node.dataset.leaving = 'true';
    const drop = () => node.remove();
    node.addEventListener('animationend', drop, { once: true });
    setTimeout(drop, 700);
  }

  /**
   * @param {object[]} visible already filtered, in no particular order
   * @param {{categoriesById: object, accountsById: object, today: string,
   *   display: object, animateEntry?: boolean}} ctx
   */
  function render(visible, {
    categoriesById, accountsById = {}, today, display, animateEntry = true,
  }) {
    // Read phase: everything derived up front, no DOM touched yet.
    // Expenses and income are scaled independently and transfers sit at a
    // fixed neutral weight, so one salary cannot flatten a month of chai.
    const scale = ledgerWeightScale(visible);
    const groups = groupByDay(visible);
    const visibleIds = new Set(visible.map((t) => t.id));
    const seenDays = new Set();
    const seenRows = new Set();
    const motion = !reduceMotion();

    // A bulk load should not animate three hundred rows in at once.
    const arriving = visible.reduce((n, t) => n + (rows.has(t.id) ? 0 : 1), 0);
    const animateArrivals = animateEntry && motion && arriving > 0 && arriving <= 12;

    // Write phase.
    let dayCursor = list.firstElementChild;

    for (const group of groups) {
      seenDays.add(group.date);
      let day = days.get(group.date);
      if (!day) {
        day = buildDay(group.date);
        days.set(group.date, day);
      }
      if (day.li !== dayCursor) list.insertBefore(day.li, dayCursor);
      else dayCursor = dayCursor.nextElementSibling;

      updateDay(day, group, { today, display });

      let rowCursor = day.ul.firstElementChild;
      for (const transaction of group.transactions) {
        seenRows.add(transaction.id);
        let row = rows.get(transaction.id);
        const isNew = !row;
        if (isNew) {
          row = buildRow(transaction.id);
          rows.set(transaction.id, row);
          if (animateArrivals) {
            row.li.dataset.entering = 'true';
            row.li.addEventListener('animationend', () => {
              delete row.li.dataset.entering;
            }, { once: true });
          }
        }
        if (row.li !== rowCursor) day.ul.insertBefore(row.li, rowCursor);
        else rowCursor = rowCursor.nextElementSibling;

        updateRow(row, transaction, {
          categoriesById, accountsById, scale, today, display,
        });
      }

      // Anything left after the cursor is not part of this day any more.
      // A row that merely moved to another date is detached now and
      // re-inserted when that date is processed; a row that is actually going
      // away is left in place so it can collapse on screen.
      while (rowCursor) {
        const next = rowCursor.nextElementSibling;
        if (visibleIds.has(rowCursor.dataset.id)) rowCursor.remove();
        rowCursor = next;
      }
    }

    for (const [id, row] of rows) {
      if (!seenRows.has(id)) {
        rows.delete(id);
        detach(row.li, { animate: motion });
      }
    }
    // A day header outlives its rows just long enough for them to collapse
    // inside it — no animation of its own, only the delay.
    for (const [date, day] of days) {
      if (!seenDays.has(date)) {
        days.delete(date);
        detach(day.li, { animate: motion });
      }
    }

    return { scale, count: visible.length };
  }

  /**
   * The day header: the weekday, the date, and the day's net.
   *
   * Net rather than spend, because a day that took in ₹5,000 and spent ₹300
   * did not have a ₹300 day. Today and yesterday are named instead of their
   * weekday — that is the one thing a person reads faster than "Wednesday".
   */
  function updateDay(day, group, { today, display }) {
    const { refs, snap } = day;
    const relative = formatRelativeDay(group.date, today);
    const named = relative === 'Today' || relative === 'Yesterday';
    const weekday = formatDay(group.date, { weekday: true }).split(',')[0];
    const lead = named ? relative : weekday;

    if (snap.lead !== lead) {
      refs.relative.textContent = lead;
      snap.lead = lead;
    }
    if (snap.date !== group.date) {
      refs.date.textContent = formatDay(group.date);
      refs.date.setAttribute('datetime', group.date);
      snap.date = group.date;
    }

    const net = netMoney(group.netPaise, display);
    const key = `${net.text}|${net.tone}`;
    if (snap.net !== key) {
      refs.netText.textContent = net.text;
      // The tone is the colour; the word is the same fact as text, so the
      // day's direction is never carried by colour alone.
      refs.netWord.textContent = `, ${net.word} on the day`;
      refs.net.dataset.tone = net.tone;
      snap.net = key;
    }

    const isToday = String(group.date === today);
    if (day.li.dataset.today !== isToday) day.li.dataset.today = isToday;
  }

  function updateRow(row, transaction, {
    categoriesById, accountsById, scale, today, display,
  }) {
    const { refs, snap, li } = row;
    const kind = kindOf(transaction);
    const category = categoriesById[transaction.categoryId];
    const account = accountsById[transaction.accountId];
    const toAccount = accountsById[transaction.toAccountId];

    /* A transfer has no category. What it has instead is a destination, and
       that is what belongs in the title slot: "Cash → Bank" says everything a
       transfer row has to say. */
    const title = kind === 'transfer'
      ? `${account?.name ?? 'Unknown'} → ${toAccount?.name ?? 'Unknown'}`
      : category?.name ?? 'Unknown';

    const t = scale.t(transaction).toFixed(3);

    if (snap.kind !== kind) {
      li.dataset.kind = kind;
      snap.kind = kind;
    }
    if (snap.t !== t) {
      li.style.setProperty('--t', t);
      snap.t = t;
    }
    if (snap.title !== title) {
      refs.title.textContent = title;
      snap.title = title;
    }

    /* The mark. A transfer's is the transfer glyph, not a category's: it is
       the one row type that is about movement rather than about a subject. */
    const glyph = kind === 'transfer' ? 'transfer' : category?.icon ?? 'other';
    const token = kind === 'transfer' ? 'cat-neutral' : category?.colorToken ?? 'cat-neutral';
    if (snap.glyph !== glyph || snap.token !== token) {
      refs.chip.style.setProperty('--chip-color', `var(--${token})`);
      refs.chip.replaceChildren(icon(glyph));
      snap.glyph = glyph;
      snap.token = token;
    }

    /* The account, with its own small mark. Already named inside a transfer's
       title, so repeating it underneath would say the same thing twice. */
    const accountName = kind === 'transfer' ? '' : account?.name ?? '';
    const accountIcon = kind === 'transfer' ? '' : account?.icon ?? 'wallet';
    if (snap.account !== `${accountName}|${accountIcon}`) {
      refs.account.hidden = accountName === '';
      if (accountName) {
        refs.accountName.textContent = accountName;
        refs.accountMark.replaceChildren(icon(accountIcon));
      }
      snap.account = `${accountName}|${accountIcon}`;
    }

    if (snap.note !== transaction.note) {
      refs.note.textContent = transaction.note ? quoted(transaction.note) : '';
      refs.note.hidden = transaction.note === '';
      snap.note = transaction.note;
    }

    const signed = signedMoney(transaction.amountPaise, kind, display);
    if (snap.amount !== signed.text) {
      refs.amount.textContent = signed.text;
      snap.amount = signed.text;
    }
    if (snap.tone !== signed.tone) {
      refs.amount.dataset.tone = signed.tone;
      snap.tone = signed.tone;
    }

    /* The accessible name carries the whole row, in reading order, so it is
       never a bare repeated "Delete". The sign is spoken as a word here,
       which is what keeps direction off colour alone. */
    const described = describe(transaction, {
      categoriesById, accountsById, today, display,
    });
    if (snap.described !== described) {
      refs.button.setAttribute('aria-label', described);
      snap.described = described;
    }
  }

  /**
   * "Expense, ₹320.00, Food & Dining, Bank, Cold cocoa, 18 August" — the kind
   * leads, because a name that opens with the amount does not say what the
   * amount is for. Shared with the undo announcement, so the wording a user
   * hears on delete matches the one they heard on the row.
   */
  function describe(transaction, { categoriesById, accountsById, today, display }) {
    const kind = kindOf(transaction);
    const parts = [NOUN[kind], money(transaction.amountPaise, display)];

    if (kind === 'transfer') {
      parts.push(
        `from ${accountsById[transaction.accountId]?.name ?? 'unknown account'}`,
        `to ${accountsById[transaction.toAccountId]?.name ?? 'unknown account'}`,
      );
    } else {
      parts.push(categoriesById[transaction.categoryId]?.name ?? 'Uncategorised');
      const account = accountsById[transaction.accountId]?.name;
      if (account) parts.push(account);
    }

    if (transaction.note) parts.push(transaction.note);
    parts.push(transaction.date === today ? 'today' : formatDay(transaction.date));
    return parts.join(', ');
  }

  return {
    render,
    describe,
    clear() {
      list.replaceChildren();
      days.clear();
      rows.clear();
    },
  };
}
