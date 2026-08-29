/**
 * data.js — export, import, and deleting everything.
 *
 * The rules that matter here are about consent. An import is read and
 * previewed before anything is applied, and merge versus replace is an
 * explicit choice with the consequences of each spelled out in numbers.
 * Deleting everything requires typing the word.
 *
 * The parsing and the counting live in lib/backup.js and are tested there.
 * This module owns the Blob, the file reader, and the dialogs.
 */

import { buildExport, exportFilename, readImport, summariseImport } from '../lib/backup.js';

const IMPORT_ERRORS = {
  'empty-file': 'That file is empty.',
  'malformed-json': 'That file is not valid JSON. If you edited it by hand, check for a stray comma.',
  'not-an-object': 'That file does not contain a Heft export.',
  'no-data': 'That looks like a Heft export, but it has no data in it.',
  'not-heft-data': 'That JSON is not from Heft — it has no expenses or categories.',
  'future-schema': 'That file was written by a newer version of Heft. Nothing was changed.',
  'not-an-object-payload': 'That file does not contain a Heft export.',
};

const CONFIRM_WORD = 'DELETE';

/**
 * Put focus back on whatever opened the dialog.
 *
 * Deferred by a tick, because <dialog> does its own focus restoration on
 * close and running first means the browser can undo us. Called both from the
 * dismiss buttons and from the close event: the buttons cover the case where
 * nothing inside the dialog had focus to restore from, and the event covers
 * Escape and the backdrop.
 */
function restoreFocus(trigger) {
  if (!trigger) return;
  setTimeout(() => {
    if (document.contains(trigger)) trigger.focus();
  }, 0);
}

export function createDataTools({
  exportButton, importButton, importDialog, dangerButton, dangerDialog,
  metaNode, getState, onImport, onDeleteAll, announce,
}) {
  /* ------------------------------------------------------------- export */

  exportButton.addEventListener('click', () => {
    const state = getState();
    const payload = buildExport(state);
    const json = JSON.stringify(payload, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const link = document.createElement('a');
    link.href = url;
    link.download = exportFilename(payload.exportedAt);
    document.body.append(link);
    link.click();
    link.remove();
    // Revoke on the next turn: revoking synchronously can cancel the download
    // in some browsers before it has started reading the blob.
    setTimeout(() => URL.revokeObjectURL(url), 0);

    announce(`Exported ${state.expenses.length} expenses as ${link.download}.`);
  });

  /* ------------------------------------------------------------- import */

  const fileInput = importDialog.querySelector('#import-file');
  const previewNode = importDialog.querySelector('#import-preview');
  const errorNode = importDialog.querySelector('#import-error');
  const applyButton = importDialog.querySelector('#import-apply');
  const modeInputs = [...importDialog.querySelectorAll('input[name="import-mode"]')];
  let pending = null;
  let importTrigger = null;

  function resetImport() {
    pending = null;
    fileInput.value = '';
    previewNode.replaceChildren();
    previewNode.hidden = true;
    errorNode.textContent = '';
    applyButton.disabled = true;
    for (const input of modeInputs) input.disabled = true;
  }

  function line(label, value, tone) {
    const row = document.createElement('div');
    row.className = 'preview-row';
    if (tone) row.dataset.tone = tone;
    const key = document.createElement('span');
    key.textContent = label;
    const val = document.createElement('span');
    val.className = 'num';
    val.textContent = value;
    row.append(key, val);
    return row;
  }

  function renderPreview() {
    const summary = summariseImport(getState(), pending.state);
    const mode = modeInputs.find((i) => i.checked)?.value ?? 'merge';
    const plan = summary[mode];

    const heading = document.createElement('p');
    heading.className = 'preview-head';
    heading.textContent = pending.exportedAt
      ? `File holds ${summary.incoming.expenses} expenses, exported ${pending.exportedAt.slice(0, 10)}.`
      : `File holds ${summary.incoming.expenses} expenses.`;

    const rows = [
      line('You have now', `${summary.current.expenses}`),
      line('Added', `+${plan.expensesAdded}`, plan.expensesAdded ? 'add' : null),
    ];
    if (mode === 'merge' && plan.expensesSkipped > 0) {
      rows.push(line('Already here, skipped', `${plan.expensesSkipped}`));
    }
    if (plan.expensesRemoved > 0) {
      rows.push(line('Removed for good', `−${plan.expensesRemoved}`, 'remove'));
    }
    if (plan.categoriesAdded > 0) {
      rows.push(line('New categories', `+${plan.categoriesAdded}`, 'add'));
    }
    rows.push(line('You will have', `${plan.expensesAfter}`, 'total'));

    previewNode.replaceChildren(heading, ...rows);
    previewNode.hidden = false;
  }

  fileInput.addEventListener('change', async () => {
    errorNode.textContent = '';
    previewNode.hidden = true;
    applyButton.disabled = true;
    for (const input of modeInputs) input.disabled = true;

    const file = fileInput.files?.[0];
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      errorNode.textContent = 'That file could not be read.';
      return;
    }

    const result = readImport(text);
    if (!result.ok) {
      pending = null;
      errorNode.textContent = IMPORT_ERRORS[result.reason] ?? 'That file could not be imported.';
      return;
    }

    pending = result;
    for (const input of modeInputs) input.disabled = false;
    applyButton.disabled = false;
    renderPreview();
  });

  for (const input of modeInputs) {
    input.addEventListener('change', () => { if (pending) renderPreview(); });
  }

  importDialog.querySelector('#import-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pending) return;
    const mode = modeInputs.find((i) => i.checked)?.value ?? 'merge';
    const trigger = importTrigger;
    onImport(pending.state, mode);
    importDialog.close();
    restoreFocus(trigger);
  });

  importButton.addEventListener('click', () => {
    importTrigger = importButton;
    resetImport();
    importDialog.showModal();
    fileInput.focus();
  });

  for (const id of ['import-cancel', 'import-close']) {
    importDialog.querySelector(`#${id}`).addEventListener('click', () => {
      const trigger = importTrigger;
      importDialog.close();
      restoreFocus(trigger);
    });
  }
  importDialog.addEventListener('close', () => {
    resetImport();
    restoreFocus(importTrigger);
    importTrigger = null;
  });

  /* --------------------------------------------------------- delete all */

  const dangerInput = dangerDialog.querySelector('#danger-input');
  const dangerConfirm = dangerDialog.querySelector('#danger-confirm');
  const dangerCount = dangerDialog.querySelector('#danger-count');
  let dangerTrigger = null;

  function syncDangerButton() {
    dangerConfirm.disabled = dangerInput.value.trim() !== CONFIRM_WORD;
  }

  dangerInput.addEventListener('input', syncDangerButton);

  dangerButton.addEventListener('click', () => {
    dangerTrigger = dangerButton;
    dangerInput.value = '';
    syncDangerButton();
    const count = getState().expenses.length;
    dangerCount.textContent = count === 1
      ? 'This deletes your one recorded expense.'
      : `This deletes all ${count} of your recorded expenses.`;
    dangerDialog.showModal();
    dangerInput.focus();
  });

  dangerDialog.querySelector('#danger-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (dangerInput.value.trim() !== CONFIRM_WORD) return;
    const trigger = dangerTrigger;
    onDeleteAll();
    dangerDialog.close();
    restoreFocus(trigger);
  });

  for (const id of ['danger-cancel', 'danger-close']) {
    dangerDialog.querySelector(`#${id}`).addEventListener('click', () => {
      const trigger = dangerTrigger;
      dangerDialog.close();
      restoreFocus(trigger);
    });
  }
  dangerDialog.addEventListener('close', () => {
    dangerInput.value = '';
    syncDangerButton();
    restoreFocus(dangerTrigger);
    dangerTrigger = null;
  });

  /* ---------------------------------------------------------------- meta */

  function render(state) {
    const bytes = new Blob([JSON.stringify(state)]).size;
    const size = bytes < 1024
      ? `${bytes} bytes`
      : `${(bytes / 1024).toFixed(bytes < 102400 ? 1 : 0)} KB`;
    metaNode.textContent = [
      `${state.expenses.length} ${state.expenses.length === 1 ? 'expense' : 'expenses'}`,
      `${state.categories.length} categories`,
      `${size} in this browser`,
    ].join(' · ');
  }

  return { render };
}
