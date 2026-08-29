/**
 * categories.js — renaming, recolouring, adding and removing categories.
 *
 * The rule the data model insists on: deleting a category must not orphan its
 * expenses. So deletion is never a single click. It opens an inline panel —
 * not a second dialog stacked on the first — that states how many expenses
 * are affected and makes you choose: move them somewhere, or delete them too.
 */

import { canDeleteCategory, countTransactionsIn } from '../lib/storage.js';
import { formatINR } from '../lib/money.js';

const COLOR_TOKENS = [
  ['cat-1', 'Sienna'], ['cat-2', 'Teal'], ['cat-3', 'Slate'], ['cat-4', 'Indigo'],
  ['cat-5', 'Mauve'], ['cat-6', 'Clay'], ['cat-7', 'Ochre'], ['cat-8', 'Sage'],
  ['cat-neutral', 'Grey'],
];

export function createCategoryManager({
  dialog, openButtons, getState, onRename, onRecolour, onAdd, onDelete, announce,
}) {
  const list = dialog.querySelector('#category-rows');
  const addName = dialog.querySelector('#category-new-name');
  const addColour = dialog.querySelector('#category-new-colour');
  const addError = dialog.querySelector('#category-add-error');
  let returnFocusTo = null;
  /** id of the category whose delete panel is open, if any */
  let confirming = null;

  function colourSelect(value, id) {
    const select = document.createElement('select');
    select.className = 'category-colour';
    select.id = id;
    for (const [token, label] of COLOR_TOKENS) {
      const option = document.createElement('option');
      option.value = token;
      option.textContent = label;
      select.append(option);
    }
    select.value = value;
    return select;
  }

  function buildDeletePanel(category, state) {
    const count = countTransactionsIn(state.expenses, category.id);
    const others = state.categories.filter((c) => c.id !== category.id);

    const panel = document.createElement('div');
    panel.className = 'category-confirm';
    panel.setAttribute('role', 'group');
    panel.setAttribute('aria-label', `Remove ${category.name}`);

    const question = document.createElement('p');
    question.className = 'category-confirm-text';
    question.textContent = count === 0
      ? `${category.name} has no expenses. Removing it changes nothing else.`
      : `${category.name} holds ${count} ${count === 1 ? 'expense' : 'expenses'} worth ${formatINR(
        state.expenses.filter((e) => e.categoryId === category.id)
          .reduce((sum, e) => sum + e.amountPaise, 0),
      )}. Choose what happens to them.`;
    panel.append(question);

    const controls = document.createElement('div');
    controls.className = 'category-confirm-actions';

    if (count > 0) {
      const label = document.createElement('label');
      label.className = 'visually-hidden';
      label.htmlFor = `reassign-${category.id}`;
      label.textContent = `Move expenses from ${category.name} to`;

      const select = document.createElement('select');
      select.id = `reassign-${category.id}`;
      for (const other of others) {
        const option = document.createElement('option');
        option.value = other.id;
        option.textContent = other.name;
        select.append(option);
      }
      select.value = others.find((c) => c.id === 'other')?.id ?? others[0]?.id;

      const move = document.createElement('button');
      move.type = 'button';
      move.className = 'btn btn-primary';
      move.textContent = 'Move them';
      move.addEventListener('click', () => {
        onDelete(category.id, { mode: 'reassign', toId: select.value });
        const target = others.find((c) => c.id === select.value);
        announce(`${category.name} removed. ${count} ${count === 1 ? 'expense' : 'expenses'} moved to ${target?.name ?? 'Other'}.`);
        confirming = null;
        render();
      });

      const dropBoth = document.createElement('button');
      dropBoth.type = 'button';
      dropBoth.className = 'btn btn-danger';
      dropBoth.textContent = `Delete all ${count}`;
      dropBoth.addEventListener('click', () => {
        onDelete(category.id, { mode: 'delete' });
        announce(`${category.name} and its ${count} ${count === 1 ? 'expense' : 'expenses'} deleted.`);
        confirming = null;
        render();
      });

      controls.append(label, select, move, dropBoth);
    } else {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-primary';
      remove.textContent = 'Remove it';
      remove.addEventListener('click', () => {
        onDelete(category.id, { mode: 'delete' });
        announce(`${category.name} removed.`);
        confirming = null;
        render();
      });
      controls.append(remove);
    }

    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'btn btn-quiet';
    cancel.textContent = 'Keep it';
    cancel.addEventListener('click', () => {
      confirming = null;
      render();
      const button = list.querySelector(`[data-remove="${CSS.escape(category.id)}"]`);
      if (button) button.focus();
    });
    controls.append(cancel);

    panel.append(controls);
    return panel;
  }

  function buildRow(category, state) {
    const row = document.createElement('li');
    row.className = 'category-row';

    const main = document.createElement('div');
    main.className = 'category-main';

    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.setProperty('--cat', `var(--${category.colorToken})`);

    const nameLabel = document.createElement('label');
    nameLabel.className = 'visually-hidden';
    nameLabel.htmlFor = `category-name-${category.id}`;
    nameLabel.textContent = `Name of ${category.name}`;

    const name = document.createElement('input');
    name.type = 'text';
    name.id = `category-name-${category.id}`;
    name.className = 'category-name';
    name.value = category.name;
    name.addEventListener('change', () => {
      const clean = name.value.trim();
      if (!clean || clean === category.name) {
        name.value = category.name;
        return;
      }
      onRename(category.id, clean);
      announce(`Renamed to ${clean}.`);
    });

    const colourLabel = document.createElement('label');
    colourLabel.className = 'visually-hidden';
    colourLabel.htmlFor = `category-colour-${category.id}`;
    colourLabel.textContent = `Colour of ${category.name}`;

    const colour = colourSelect(category.colorToken, `category-colour-${category.id}`);
    colour.addEventListener('change', () => {
      onRecolour(category.id, colour.value);
      dot.style.setProperty('--cat', `var(--${colour.value})`);
    });

    const count = countTransactionsIn(state.expenses, category.id);
    const meta = document.createElement('span');
    meta.className = 'category-count num';
    meta.textContent = count === 1 ? '1 expense' : `${count} expenses`;

    main.append(dot, nameLabel, name, colourLabel, colour, meta);

    const allowed = canDeleteCategory(state.categories, category.id);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'icon-btn category-remove';
    remove.dataset.remove = category.id;
    remove.innerHTML = '';
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#i-delete');
    svg.append(use);
    remove.append(svg);

    if (allowed.ok) {
      remove.setAttribute('aria-label', `Remove ${category.name}`);
      remove.addEventListener('click', () => {
        confirming = confirming === category.id ? null : category.id;
        render();
      });
    } else {
      remove.disabled = true;
      remove.setAttribute(
        'aria-label',
        allowed.reason === 'protected'
          ? 'Other cannot be removed — it is where unassigned expenses go'
          : 'This category cannot be removed',
      );
      remove.title = remove.getAttribute('aria-label');
    }
    main.append(remove);

    row.append(main);
    if (confirming === category.id) row.append(buildDeletePanel(category, state));
    return row;
  }

  function render() {
    const state = getState();
    list.replaceChildren(...state.categories.map((c) => buildRow(c, state)));
  }

  dialog.querySelector('#category-add-form').addEventListener('submit', (event) => {
    event.preventDefault();
    addError.textContent = '';
    const result = onAdd({ name: addName.value, colorToken: addColour.value });
    if (!result.ok) {
      addError.textContent = result.reason === 'duplicate-name'
        ? 'You already have a category with that name.'
        : 'Give the category a name.';
      addName.focus();
      return;
    }
    announce(`Added ${result.category.name}.`);
    addName.value = '';
    render();
    addName.focus();
  });

  for (const button of openButtons) {
    button.addEventListener('click', () => {
      returnFocusTo = button;
      confirming = null;
      addError.textContent = '';
      addName.value = '';
      render();
      dialog.showModal();
      list.querySelector('input')?.focus();
    });
  }

  /**
   * Deferred by a tick, because <dialog> restores focus itself on close and
   * running first lets the browser undo us. Wired to the dismiss buttons as
   * well as the close event, so Escape and the buttons both land somewhere.
   */
  function restoreFocus(trigger) {
    if (!trigger) return;
    setTimeout(() => {
      if (document.contains(trigger)) trigger.focus();
    }, 0);
  }

  function dismiss() {
    const trigger = returnFocusTo;
    returnFocusTo = null;
    confirming = null;
    dialog.close();
    restoreFocus(trigger);
  }

  dialog.querySelector('#category-close').addEventListener('click', dismiss);
  dialog.querySelector('#category-done').addEventListener('click', dismiss);
  dialog.addEventListener('close', () => {
    confirming = null;
    const trigger = returnFocusTo;
    returnFocusTo = null;
    restoreFocus(trigger);
  });

  // Populate the "new category" colour picker once.
  addColour.replaceChildren(...COLOR_TOKENS.map(([token, label]) => {
    const option = document.createElement('option');
    option.value = token;
    option.textContent = label;
    return option;
  }));

  return { render, refresh: render };
}
