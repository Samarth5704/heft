/**
 * accounts.js — the Accounts tab.
 *
 * One figure at the top for everything you have, then a card per account.
 *
 * **Every balance on this screen is derived**, from an opening balance plus
 * the transactions that touch the account — `analytics.accountBalance`. There
 * is no stored balance field anywhere in the app and nothing increments one
 * in place, which is why a transfer can never make the total drift: its two
 * legs come out of one record, so what leaves one account is exactly what
 * arrives in the other.
 *
 * The figures here are **lifetime**, and the pane says so. The period bar
 * above governs the other tabs; a balance that silently meant "August only"
 * would be the same class of lie as a "total spent" figure that quietly means
 * "spent inside budgets".
 *
 * A negative balance gets three signals, never one: coral ink, an explicit
 * minus sign in the text, and the word "overdrawn" in the accessible name.
 */

import {
  accountBalance, expenseTotalPaise, incomeTotalPaise, netWorthPaise,
} from '../lib/analytics.js';
import { canDeleteAccount, countTransactionsFor } from '../lib/storage.js';
import { toPaise, toRupeeString } from '../lib/money.js';
import { money, MINUS } from '../lib/format.js';
import { categoryChip, icon } from './icon.js';
import { paintChoice, wireChoice } from './choice.js';
import { ACCOUNT_ICONS, buildColorPicker, buildIconPicker } from './picker.js';

const $ = (id) => document.getElementById(id);

const TYPE_LABELS = { cash: 'Cash', bank: 'Bank', card: 'Card', wallet: 'Wallet' };

/** Accounts tint small marks only, so they reuse the hues already measured. */
const ACCOUNT_TOKENS = Object.freeze(['acct-1', 'acct-2', 'acct-3', 'acct-4', 'acct-5', 'acct-6']);

export function createAccounts({ store, router, announce, reassign, onTransfer }) {
  const els = {
    figure: $('networth-figure'),
    expense: $('networth-expense'),
    income: $('networth-income'),
    list: $('account-list'),
    archived: $('account-archived'),
    archivedSection: $('account-archived-section'),
    dialog: $('account-dialog'),
    name: $('account-name'),
    nameError: $('account-name-error'),
    opening: $('account-opening'),
    openingError: $('account-opening-error'),
    template: $('tpl-account'),
  };

  $('account-cancel').prepend(icon('close'));

  let snap = store.getState();
  /** The account being edited, or null while adding. */
  let editingId = null;
  let draft = { type: 'cash', icon: 'wallet', colorToken: 'acct-1' };

  const display = () => ({ showDecimals: snap.data.settings.showDecimals !== false });
  const amount = (paise) => money(paise, display());

  /* -------------------------------------------------------- the pickers */

  wireChoice($('account-type'), (value) => {
    draft.type = value;
    paintChoice($('account-type'), value);
  });

  buildIconPicker($('account-icon'), ACCOUNT_ICONS, (value) => {
    draft.icon = value;
    paintChoice($('account-icon'), value);
  });

  buildColorPicker($('account-color'), ACCOUNT_TOKENS, (value) => {
    draft.colorToken = value;
    paintChoice($('account-color'), value);
  });

  /* --------------------------------------------------------- the sheet */

  function openSheet(account, trigger) {
    editingId = account?.id ?? null;
    draft = {
      type: account?.type ?? 'cash',
      icon: account?.icon ?? 'wallet',
      colorToken: account?.colorToken ?? 'acct-1',
    };

    $('account-dialog-title').textContent = account ? `Edit ${account.name}` : 'New account';
    $('account-save').textContent = account ? 'Save changes' : 'Add account';
    els.name.value = account?.name ?? '';
    els.opening.value = account ? toRupeeString(Math.abs(account.openingBalancePaise)) : '';
    // A negative opening balance is written with its sign, the same way it is
    // read back: a card with a bill outstanding really does start below zero.
    if (account && account.openingBalancePaise < 0) {
      els.opening.value = `-${els.opening.value}`;
    }
    els.nameError.textContent = '';
    els.openingError.textContent = '';
    els.name.setAttribute('aria-invalid', 'false');

    paintChoice($('account-type'), draft.type);
    paintChoice($('account-icon'), draft.icon);
    paintChoice($('account-color'), draft.colorToken);

    // Delete is offered only where it can succeed without stranding records;
    // the never-orphan choice below handles the rest.
    $('account-delete').hidden = !account || snap.data.accounts.length <= 1;

    els.dialog.returnFocusTo = trigger ?? document.activeElement;
    els.dialog.showModal();
    els.name.focus();
    els.name.select();
  }

  /**
   * An opening balance may be negative, so it is parsed by hand rather than
   * through `toPaise`, which rejects a minus sign — and rightly, since every
   * *transaction* amount in this app is positive by construction.
   */
  function parseOpening(raw) {
    const text = String(raw ?? '').trim();
    if (text === '') return 0;
    const negative = text.startsWith('-') || text.startsWith(MINUS);
    const paise = toPaise(negative ? text.slice(1) : text);
    if (paise === null) return null;
    return negative ? -paise : paise;
  }

  $('account-form').addEventListener('submit', (event) => {
    event.preventDefault();

    const name = els.name.value.trim();
    const opening = parseOpening(els.opening.value);
    let ok = true;

    if (!name) {
      els.nameError.textContent = 'Give the account a name.';
      els.name.setAttribute('aria-invalid', 'true');
      ok = false;
    }
    if (opening === null) {
      els.openingError.textContent = 'Enter an amount, like 4000 or -4000.';
      els.opening.setAttribute('aria-invalid', 'true');
      ok = false;
    }
    if (!ok) {
      els.dialog.querySelector('[aria-invalid="true"]')?.focus();
      return;
    }

    const values = {
      name, type: draft.type, openingBalancePaise: opening, colorToken: draft.colorToken, icon: draft.icon,
    };
    const result = editingId === null
      ? store.addAccount(values)
      : store.updateAccount(editingId, values);

    if (!result.ok) {
      els.nameError.textContent = result.reason === 'duplicate-name'
        ? 'There is already an account with that name.'
        : `Could not save: ${result.reason}.`;
      els.name.setAttribute('aria-invalid', 'true');
      els.name.focus();
      return;
    }

    announce.say(editingId === null ? `${name} added.` : `${name} saved.`);
    els.dialog.close();
  });

  $('account-cancel').addEventListener('click', () => els.dialog.close());

  els.dialog.addEventListener('close', () => {
    editingId = null;
    const back = els.dialog.returnFocusTo;
    if (back && document.contains(back)) back.focus();
    els.dialog.returnFocusTo = null;
  });

  /* ------------------------------------------------------------ delete */

  $('account-delete').addEventListener('click', () => {
    const account = store.accountById(editingId);
    if (!account) return;

    const allowed = canDeleteAccount(snap.data.accounts, account.id, snap.data.transactions);
    if (allowed.ok) {
      els.dialog.close();
      const result = store.deleteAccount(account.id);
      if (result.ok) announce.say(`${account.name} deleted.`);
      return;
    }
    if (allowed.reason !== 'in-use') {
      announce.say(
        allowed.reason === 'last-account'
          ? 'This is the only account. Money has to sit somewhere, so it cannot go.'
          : `Cannot delete: ${allowed.reason}.`,
      );
      return;
    }

    els.dialog.close();
    reassign.open({
      noun: 'account',
      name: account.name,
      count: allowed.count,
      // Not archived: moving records into an account taken off the pickers
      // puts them somewhere the user has already said they are done with.
      targets: snap.data.accounts
        .filter((a) => a.id !== account.id && !a.archived)
        .map((a) => ({ id: a.id, name: a.name })),
      onConfirm({ mode, toId }) {
        const result = store.deleteAccount(account.id, { mode, toId });
        if (!result.ok) {
          announce.say(`Could not delete ${account.name}: ${result.reason}.`);
          return;
        }
        announce.say(mode === 'reassign'
          ? `${account.name} deleted. Its records moved to ${store.accountById(toId)?.name ?? 'another account'}.`
          : `${account.name} deleted, along with ${result.removedTransactions} records.`);
      },
    });
  });

  /* ------------------------------------------------------------- cards */

  function buildCard(account) {
    const li = els.template.content.firstElementChild.cloneNode(true);
    const balance = accountBalance(account, snap.data.transactions);
    const overdrawn = balance < 0;

    li.dataset.archived = String(account.archived === true);

    const chip = categoryChip(account.icon, account.colorToken, { size: '2.5rem' });
    chip.classList.add('account-chip');
    li.querySelector('.account-chip').replaceWith(chip);

    li.querySelector('.account-name').textContent = account.name;
    li.querySelector('.account-type').textContent = account.archived
      ? `${TYPE_LABELS[account.type] ?? account.type} · archived`
      : (TYPE_LABELS[account.type] ?? account.type);

    const figure = li.querySelector('.account-balance');
    figure.dataset.tone = overdrawn ? 'out' : 'flat';
    li.querySelector('.account-balance-text').textContent =
      `${overdrawn ? MINUS : ''}${amount(Math.abs(balance))}`;
    // The third signal. Coral and a minus sign say it on screen; this says it
    // to a screen reader, which sees neither.
    li.querySelector('.account-balance-word').textContent =
      overdrawn ? ', overdrawn' : '';

    li.querySelector('.account-opening').textContent = account.openingBalancePaise === 0
      ? 'Opened at ₹0 — set an opening balance if this account already held money.'
      : `Opened at ${account.openingBalancePaise < 0 ? MINUS : ''}${amount(Math.abs(account.openingBalancePaise))}.`;

    /* Every control names its account, so a screen reader never meets a
       column of identical "Edit"s. */
    const view = li.querySelector('.account-view');
    view.append(icon('tab-records'), 'Records');
    view.setAttribute('aria-label', `Show records for ${account.name}`);
    view.addEventListener('click', () => {
      // The account filter, pre-applied — and the other filters cleared, so
      // the destination is the account rather than the account *and*
      // whatever was narrowing the last screen.
      router.go({
        tab: 'records', accountIds: [account.id], categoryIds: [], kinds: [], query: '',
      });
      announce.say(`Showing records for ${account.name}.`);
    });

    const edit = li.querySelector('.account-edit');
    edit.append(icon('edit'), 'Edit');
    edit.setAttribute('aria-label', `Edit ${account.name}`);
    edit.addEventListener('click', () => openSheet(account, edit));

    const archive = li.querySelector('.account-archive');
    const isArchived = account.archived === true;
    archive.append(icon(isArchived ? 'restore' : 'archive'), isArchived ? 'Restore' : 'Archive');
    archive.setAttribute('aria-label', `${isArchived ? 'Restore' : 'Archive'} ${account.name}`);
    archive.addEventListener('click', () => {
      const result = isArchived ? store.restoreAccount(account.id) : store.archiveAccount(account.id);
      if (!result.ok) {
        announce.say(`Could not do that: ${result.reason}.`);
        return;
      }
      announce.say(isArchived
        ? `${account.name} restored to the pickers.`
        : `${account.name} archived. It keeps its balance and its records.`);
    });

    return li;
  }

  /* -------------------------------------------------------------- paint */

  function paint() {
    const { accounts, transactions } = snap.data;

    // Archived accounts still hold money, so they still count. The list may
    // hide them; the figure may not.
    const total = netWorthPaise(accounts, transactions);
    els.figure.textContent = `${total < 0 ? MINUS : ''}${amount(Math.abs(total))}`;
    els.figure.dataset.tone = total < 0 ? 'out' : 'flat';

    els.expense.textContent = amount(expenseTotalPaise(transactions));
    els.income.textContent = amount(incomeTotalPaise(transactions));

    const live = accounts.filter((a) => !a.archived);
    const put = accounts.filter((a) => a.archived);

    els.list.replaceChildren(...live.map(buildCard));
    els.archived.replaceChildren(...put.map(buildCard));
    els.archivedSection.hidden = put.length === 0;

    // Moving money needs somewhere to move it to.
    $('account-transfer').disabled = live.length < 2;
  }

  $('account-add').addEventListener('click', () => openSheet(null, $('account-add')));
  $('account-transfer').addEventListener('click', () => onTransfer($('account-transfer')));

  store.subscribe((next) => {
    snap = next;
    if (router.route.tab === 'accounts') paint();
  });

  return { paint, countFor: (id) => countTransactionsFor(snap.data.transactions, id) };
}
