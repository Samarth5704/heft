/**
 * categories.js — the Categories tab.
 *
 * Two lists, because there are two kinds and they are never mixed: an expense
 * category and an income category are counted separately in every total,
 * chart and budget in the app.
 *
 * **Kind is chosen once and fixed afterwards.** Flipping it would not
 * reclassify anything — it would silently rewrite every figure the category
 * has ever been part of, turning spending into earnings across months already
 * looked at and decided on. The control says so in words rather than merely
 * going grey, because a control that refuses without explaining reads as a
 * bug. The way to move records between kinds is to make the category you want
 * and merge into it.
 *
 * Three destructive-ish operations, each with the count stated before it
 * happens:
 *
 * - **Archive** keeps everything and takes the category off the pickers. It
 *   is the default for anything with history.
 * - **Merge** moves every record to a target of the same kind and archives
 *   the source, so an older period still resolves the name it was filed under.
 * - **Delete** is only offered where nothing points at the category; where
 *   something does, the never-orphan dialog demands an explicit
 *   reassign-or-delete first.
 */

import { canDeleteCategory, countTransactionsIn } from '../lib/storage.js';
import { categoryChip, icon } from './icon.js';
import { paintChoice, wireChoice } from './choice.js';
import { CATEGORY_ICONS, PICKER_TOKENS, buildColorPicker, buildIconPicker } from './picker.js';

const $ = (id) => document.getElementById(id);

const KIND_LABELS = { expense: 'Expense', income: 'Income' };

export function createCategories({ store, router, announce, reassign }) {
  const els = {
    expense: $('category-expense'),
    income: $('category-income'),
    archived: $('category-archived'),
    archivedSection: $('category-archived-section'),
    dialog: $('category-dialog'),
    name: $('category-name'),
    nameError: $('category-name-error'),
    kindGroup: $('category-kind'),
    kindHelp: $('category-kind-help'),
    menu: $('category-menu'),
    menuList: $('category-menu-list'),
    mergeDialog: $('merge-dialog'),
    mergeTarget: $('merge-target'),
    mergeLede: $('merge-lede'),
    mergeHelp: $('merge-help'),
    template: $('tpl-category'),
  };

  for (const [id, name] of [['category-cancel', 'close'], ['category-menu-close', 'close'], ['merge-cancel', 'close']]) {
    $(id).prepend(icon(name));
  }

  let snap = store.getState();
  let editingId = null;
  let draft = { kind: 'expense', icon: 'other', colorToken: 'cat-1' };
  /** The category the action menu, and then the merge sheet, is acting on. */
  let acting = null;

  const countIn = (id) => countTransactionsIn(snap.data.transactions, id);
  const categoriesOfKind = (kind) => snap.data.categories.filter(
    (c) => (c.kind ?? 'expense') === kind,
  );

  /* -------------------------------------------------------- the pickers */

  wireChoice(els.kindGroup, (value) => {
    // Editing never changes kind. The group is left navigable so a screen
    // reader can still read what the kind *is*; it just does not move.
    if (editingId !== null) {
      announce.say('A category’s kind cannot be changed after it is made.');
      paintChoice(els.kindGroup, draft.kind);
      return;
    }
    draft.kind = value === 'income' ? 'income' : 'expense';
    paintChoice(els.kindGroup, draft.kind);
  });

  buildIconPicker($('category-icon'), CATEGORY_ICONS, (value) => {
    draft.icon = value;
    paintChoice($('category-icon'), value);
  });

  buildColorPicker($('category-color'), PICKER_TOKENS, (value) => {
    draft.colorToken = value;
    paintChoice($('category-color'), value);
  });

  /* ---------------------------------------------------------- the sheet */

  function openSheet(category, trigger) {
    editingId = category?.id ?? null;
    draft = {
      kind: category?.kind ?? 'expense',
      icon: category?.icon ?? 'other',
      colorToken: category?.colorToken ?? 'cat-1',
    };

    $('category-dialog-title').textContent = category ? `Edit ${category.name}` : 'New category';
    $('category-save').textContent = category ? 'Save changes' : 'Add category';
    els.name.value = category?.name ?? '';
    els.nameError.textContent = '';
    els.name.setAttribute('aria-invalid', 'false');

    const locked = editingId !== null;
    for (const button of els.kindGroup.querySelectorAll('.opt-choice')) {
      button.disabled = locked;
    }
    // The explanation changes with the situation. On a new category it is a
    // warning about a choice still to be made; on an existing one it is the
    // reason the control will not move.
    els.kindHelp.textContent = locked
      ? `${KIND_LABELS[draft.kind]}, and fixed. Expense and income are counted separately `
        + 'in every total, chart and budget, so switching this now would rewrite figures '
        + 'you have already read rather than reclassify anything. To move its records, '
        + 'merge it into a category of the kind you want.'
      : 'Chosen once, and fixed afterwards. Expense and income are counted separately in '
        + 'every total, chart and budget, so a category that already has records cannot '
        + 'change sides without rewriting history.';

    const allowed = category
      ? canDeleteCategory(snap.data.categories, category.id, snap.data.transactions)
      : { ok: false };
    // The two sinks are the reassignment target of last resort and the
    // validator's fallback, so they never go.
    $('category-delete').hidden = !category || allowed.reason === 'protected';

    paintChoice(els.kindGroup, draft.kind);
    paintChoice($('category-icon'), draft.icon);
    paintChoice($('category-color'), draft.colorToken);

    els.dialog.returnFocusTo = trigger ?? document.activeElement;
    els.dialog.showModal();
    els.name.focus();
    els.name.select();
  }

  $('category-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const name = els.name.value.trim();
    if (!name) {
      els.nameError.textContent = 'Give the category a name.';
      els.name.setAttribute('aria-invalid', 'true');
      els.name.focus();
      return;
    }

    const result = editingId === null
      ? store.addCategory({ name, kind: draft.kind, colorToken: draft.colorToken, icon: draft.icon })
      : store.updateCategory(editingId, { name, colorToken: draft.colorToken, icon: draft.icon });

    if (!result.ok) {
      els.nameError.textContent = result.reason === 'duplicate-name'
        ? `There is already a ${KIND_LABELS[draft.kind].toLowerCase()} category called that.`
        : `Could not save: ${result.reason}.`;
      els.name.setAttribute('aria-invalid', 'true');
      els.name.focus();
      return;
    }

    announce.say(editingId === null
      ? `${name} added as ${draft.kind === 'income' ? 'an income' : 'an expense'} category.`
      : `${name} saved.`);
    els.dialog.close();
  });

  $('category-cancel').addEventListener('click', () => els.dialog.close());

  els.dialog.addEventListener('close', () => {
    editingId = null;
    const back = els.dialog.returnFocusTo;
    if (back && document.contains(back)) back.focus();
    els.dialog.returnFocusTo = null;
  });

  /* ------------------------------------------------------------ delete */

  $('category-delete').addEventListener('click', () => {
    const category = store.categoryById(editingId);
    if (!category) return;

    const allowed = canDeleteCategory(snap.data.categories, category.id, snap.data.transactions);
    if (allowed.ok) {
      els.dialog.close();
      if (store.deleteCategory(category.id).ok) announce.say(`${category.name} deleted.`);
      return;
    }
    if (allowed.reason !== 'in-use') {
      announce.say(reasonFor(allowed.reason, category.name));
      return;
    }

    els.dialog.close();
    askDelete(category, allowed.count);
  });

  function reasonFor(reason, name) {
    if (reason === 'protected') {
      return `${name} is where records go when their own category is removed, so it stays.`;
    }
    if (reason === 'last-of-kind') return `${name} is the last of its kind, so it stays.`;
    return `Cannot delete ${name}: ${reason}.`;
  }

  function askDelete(category, count) {
    reassign.open({
      noun: 'category',
      name: category.name,
      count,
      // Same kind, and not archived: moving records into a category that has
      // been taken off the pickers hides them somewhere the user has already
      // said they are done with.
      targets: categoriesOfKind(category.kind ?? 'expense')
        .filter((c) => c.id !== category.id && !c.archived)
        .map((c) => ({ id: c.id, name: c.name })),
      onConfirm({ mode, toId }) {
        const result = store.deleteCategory(category.id, { mode, toId });
        if (!result.ok) {
          announce.say(`Could not delete ${category.name}: ${result.reason}.`);
          return;
        }
        announce.say(mode === 'reassign'
          ? `${category.name} deleted. ${count} record${count === 1 ? '' : 's'} moved to `
            + `${store.categoryById(toId)?.name ?? 'another category'}.`
          : `${category.name} deleted, along with ${result.removedTransactions} records.`);
      },
    });
  }

  /* -------------------------------------------------------- the merge --
     Pick a target of the same kind, move every record, archive the source.
     The count is stated before it happens, and confirming is a separate act
     from choosing. */

  function openMerge(category, trigger) {
    acting = category;
    const count = countIn(category.id);
    const targets = categoriesOfKind(category.kind ?? 'expense')
      .filter((c) => c.id !== category.id && !c.archived);

    if (targets.length === 0) {
      announce.say(`There is no other ${category.kind} category to merge ${category.name} into.`);
      return;
    }

    els.mergeLede.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = category.name;
    els.mergeLede.append(
      strong,
      count === 0
        ? ' has no records. Merging archives it and leaves the other category as it was.'
        : ` has ${count} record${count === 1 ? '' : 's'}. All of them move to the category `
          + 'you pick, and nothing is deleted.',
    );

    els.mergeTarget.replaceChildren(...targets.map((c) => {
      const option = document.createElement('option');
      option.value = c.id;
      option.textContent = c.name;
      return option;
    }));

    els.mergeHelp.textContent = `Only ${category.kind} categories are offered: moving records `
      + 'across kinds would turn spending into earnings.';

    els.mergeDialog.returnFocusTo = trigger ?? document.activeElement;
    els.mergeDialog.showModal();
  }

  $('merge-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!acting) return;
    const source = acting;
    const toId = els.mergeTarget.value;
    els.mergeDialog.close();

    const result = store.mergeCategory(source.id, toId);
    if (!result.ok) {
      announce.say(`Could not merge ${source.name}: ${result.reason}.`);
      return;
    }
    announce.say(
      `${result.moved} record${result.moved === 1 ? '' : 's'} moved from ${source.name} to `
      + `${result.to.name}. ${source.name} is archived, so older periods still show its name.`,
    );
  });

  for (const id of ['merge-cancel', 'merge-abort']) {
    $(id).addEventListener('click', () => els.mergeDialog.close());
  }

  els.mergeDialog.addEventListener('close', () => {
    acting = null;
    const back = els.mergeDialog.returnFocusTo;
    if (back && document.contains(back)) back.focus();
    els.mergeDialog.returnFocusTo = null;
  });

  /* --------------------------------------------------------- the menu --
     A sheet, not a floating dropdown: it traps focus, closes on Escape and
     returns focus to the button that opened it, none of which a hand-rolled
     popup gets for free. */

  function openMenu(category, trigger) {
    acting = category;
    const count = countIn(category.id);
    const isArchived = category.archived === true;

    $('category-menu-title').textContent = category.name;

    const items = [
      {
        icon: 'edit',
        label: 'Edit',
        sub: 'Name, icon and colour.',
        run: () => openSheet(category, trigger),
      },
      {
        icon: 'merge',
        label: 'Merge into…',
        sub: count === 0
          ? 'Archive this one and keep another.'
          : `Move ${count} record${count === 1 ? '' : 's'} to another ${category.kind} category.`,
        run: () => openMerge(category, trigger),
      },
      {
        icon: isArchived ? 'restore' : 'archive',
        label: isArchived ? 'Restore' : 'Archive',
        sub: isArchived
          ? 'Put it back on the pickers.'
          : 'Take it off the pickers, keep every record it holds.',
        run: () => {
          const result = isArchived
            ? store.restoreCategory(category.id)
            : store.archiveCategory(category.id);
          if (!result.ok) {
            announce.say(`Could not do that: ${result.reason}.`);
            return;
          }
          announce.say(isArchived
            ? `${category.name} restored.`
            : `${category.name} archived. Its ${count} record${count === 1 ? '' : 's'} are untouched.`);
        },
      },
      {
        icon: 'danger',
        label: 'Delete',
        danger: true,
        sub: count === 0
          ? 'Nothing points at it, so it can just go.'
          : `${count} record${count === 1 ? '' : 's'} would have to move or go too.`,
        run: () => {
          const allowed = canDeleteCategory(snap.data.categories, category.id, snap.data.transactions);
          if (allowed.ok) {
            if (store.deleteCategory(category.id).ok) announce.say(`${category.name} deleted.`);
          } else if (allowed.reason === 'in-use') {
            askDelete(category, allowed.count);
          } else {
            announce.say(reasonFor(allowed.reason, category.name));
          }
        },
      },
    ];

    const protectedCategory = canDeleteCategory(
      snap.data.categories, category.id, snap.data.transactions,
    ).reason === 'protected';

    els.menuList.replaceChildren(...items
      .filter((item) => !(item.label === 'Delete' && protectedCategory))
      .map((item) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = item.danger ? 'menu-item menu-item-danger' : 'menu-item';
        const text = document.createElement('span');
        text.append(item.label);
        const sub = document.createElement('span');
        sub.className = 'menu-item-sub';
        sub.textContent = item.sub;
        text.append(sub);
        button.append(icon(item.icon), text);
        button.addEventListener('click', () => {
          els.menu.close();
          // The menu's own close returns focus to the row button; run the
          // action after that has happened so the action's dialog captures
          // the right element to come back to.
          item.run();
        });
        return button;
      }));

    els.menu.returnFocusTo = trigger ?? document.activeElement;
    els.menu.showModal();
    els.menuList.querySelector('.menu-item')?.focus();
  }

  $('category-menu-close').addEventListener('click', () => els.menu.close());

  els.menu.addEventListener('close', () => {
    const back = els.menu.returnFocusTo;
    if (back && document.contains(back)) back.focus();
    els.menu.returnFocusTo = null;
  });

  /* -------------------------------------------------------------- rows */

  function buildRow(category) {
    const li = els.template.content.firstElementChild.cloneNode(true);
    const count = countIn(category.id);

    li.dataset.archived = String(category.archived === true);

    const chip = categoryChip(category.icon, category.colorToken, { size: '2.25rem' });
    chip.classList.add('category-chip');
    li.querySelector('.category-chip').replaceWith(chip);

    li.querySelector('.category-name').textContent = category.name;
    li.querySelector('.category-count').textContent = count === 0
      ? 'No records'
      : `${count} record${count === 1 ? '' : 's'}`;

    const menu = li.querySelector('.category-menu-open');
    menu.append(icon('more'));
    // Never forty bare "More"s: the name is in the label.
    menu.setAttribute('aria-label', `Actions for ${category.name}`);
    menu.setAttribute('aria-haspopup', 'dialog');
    menu.addEventListener('click', () => openMenu(category, menu));

    return li;
  }

  /* ------------------------------------------------------------- paint */

  function paint() {
    const live = snap.data.categories.filter((c) => !c.archived);
    const put = snap.data.categories.filter((c) => c.archived);

    els.expense.replaceChildren(...live.filter((c) => (c.kind ?? 'expense') === 'expense').map(buildRow));
    els.income.replaceChildren(...live.filter((c) => c.kind === 'income').map(buildRow));
    els.archived.replaceChildren(...put.map(buildRow));
    els.archivedSection.hidden = put.length === 0;
  }

  $('category-add').addEventListener('click', () => openSheet(null, $('category-add')));

  store.subscribe((next) => {
    snap = next;
    if (router.route.tab === 'categories') paint();
  });

  return { paint };
}
