/**
 * reassign.js — the never-orphan delete, for both categories and accounts.
 *
 * The rule the store enforces is that a category or an account with records
 * behind it cannot be deleted on a bare request: the caller has to say, in so
 * many words, what happens to those records. This is the dialog that asks.
 *
 * It always states the count. "Delete Groceries?" is a question nobody can
 * answer; "Groceries has 47 records" is one they can. And the default is the
 * non-destructive one — move them — because the destructive path should be
 * chosen, never fallen into.
 */

import { paintChoice, wireChoice } from './choice.js';
import { icon } from './icon.js';

const $ = (id) => document.getElementById(id);

export function createReassignDialog({ announce }) {
  const dialog = $('reassign-dialog');
  const form = $('reassign-form');
  const lede = $('reassign-lede');
  const targetField = $('reassign-target-field');
  const target = $('reassign-target');
  const warning = $('reassign-warning');
  const modeGroup = $('reassign-mode');

  $('reassign-cancel').prepend(icon('close'));

  let mode = 'reassign';
  let pending = null;

  function paintMode() {
    paintChoice(modeGroup, mode);
    const destructive = mode === 'delete';
    targetField.hidden = destructive;
    warning.hidden = !destructive;
    $('reassign-confirm').textContent = destructive ? 'Delete both' : 'Move and delete';
  }

  wireChoice(modeGroup, (value) => {
    mode = value === 'delete' ? 'delete' : 'reassign';
    paintMode();
  });

  /**
   * @param {{
   *   noun: 'category'|'account', name: string, count: number,
   *   targets: {id: string, name: string}[],
   *   onConfirm: (choice: {mode: 'reassign'|'delete', toId: string|null}) => void,
   *   trigger?: Element,
   * }} opts
   */
  function open({ noun, name, count, targets, onConfirm, trigger }) {
    pending = { onConfirm, name, noun };
    // "Move them" is meaningless with nowhere to move them to, so the choice
    // collapses to the one that is actually available rather than offering a
    // control that cannot work.
    mode = targets.length ? 'reassign' : 'delete';

    $('reassign-title').textContent = `Delete ${name}`;
    lede.replaceChildren();
    const strong = document.createElement('strong');
    strong.textContent = name;
    lede.append(
      strong,
      ` has ${count} record${count === 1 ? '' : 's'}. Deleting the ${noun} cannot leave them `
      + 'pointing at something that is not there, so they either move or go too.',
    );

    warning.textContent = `${count} record${count === 1 ? '' : 's'} will be deleted along with `
      + `the ${noun}. This cannot be undone.`;

    target.replaceChildren(...targets.map((item) => {
      const option = document.createElement('option');
      option.value = item.id;
      option.textContent = item.name;
      return option;
    }));
    modeGroup.querySelector('[data-value="reassign"]').disabled = targets.length === 0;

    paintMode();
    dialog.returnFocusTo = trigger ?? document.activeElement;
    dialog.showModal();
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const choice = { mode, toId: mode === 'reassign' ? target.value : null };
    const done = pending;
    dialog.close();
    done?.onConfirm(choice);
  });

  for (const id of ['reassign-cancel', 'reassign-abort']) {
    $(id).addEventListener('click', () => dialog.close());
  }

  dialog.addEventListener('close', () => {
    pending = null;
    const back = dialog.returnFocusTo;
    // The row that opened this may be the very thing that was just deleted,
    // so falling back rather than assuming it is still in the document.
    if (back && document.contains(back)) back.focus();
    dialog.returnFocusTo = null;
  });

  return { open, announce };
}
