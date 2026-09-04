/**
 * manage-data.js — the drawer's three data tools: Export Report, Backup &
 * Restore, and Delete & Reset.
 *
 * Everything here is about consent. The three sheets do the three things a
 * person can do to a whole ledger at once, and each one is destructive in a
 * different way, so each one is arranged so that the destructive step is the
 * *last* thing that happens and is preceded by a statement of what it will
 * do, in numbers.
 *
 *   Export     reads and writes a file. Harmless, and the only one of the
 *              three with no confirmation.
 *   Restore    reads a file, validates it, previews the change, and only then
 *              offers merge or replace. It never applies a default.
 *   Delete     names the two different things it could mean, states the
 *              counts, and asks for a different word for each.
 *
 * The counting and the parsing live in lib/backup.js and lib/csv.js and are
 * tested there. What this module owns is the Blob, the file reader, the
 * dialogs, and the focus.
 *
 * (This replaced ui/data.js, which did the same job for the v1 page against the
 * v1 schema. Two modules answering to one drawer is the two-vocabularies
 * failure this project keeps closing, so ui/data.js was retired along with
 * legacy.html and the rest of the v1 page.)
 */

import {
  buildExport, exportFilename, readImport, summariseImport,
} from '../lib/backup.js';
import { budgetsToCsv, csvFilename, transactionsToCsv } from '../lib/csv.js';
import { paintChoice, wireChoice } from './choice.js';
import { restoreFocus } from './focus.js';

const $ = (id) => document.getElementById(id);

/* Why an import was refused, in the terms of the person holding the file —
   never a reason code, and never "invalid". Each one says what was wrong and,
   where there is one, what to do about it. */
const IMPORT_ERRORS = {
  'empty-file': 'That file is empty.',
  'malformed-json': 'That file is not valid JSON. If you edited it by hand, look for a stray comma.',
  'not-an-object': 'That file does not contain a Heft backup.',
  'not-an-object-payload': 'That file does not contain a Heft backup.',
  'no-data': 'That looks like a Heft backup, but there is no data inside it.',
  'not-heft-data': 'That JSON is not from Heft — it has no transactions, accounts or categories.',
  'future-schema': 'That backup was written by a newer version of Heft than this one. Nothing was changed.',
};

const SAVE_MESSAGES = {
  'quota-exceeded': {
    title: 'Storage is full — your last change was not saved',
    text: 'What is on screen is correct, but this browser had no room to write it down, '
      + 'and it will be gone when you reload. Export a backup now, then delete some '
      + 'records to free space.',
  },
  'write-failed': {
    title: 'This browser refused to save',
    text: 'Your changes are in memory only and will be lost on reload. Private browsing '
      + 'and blocked site data both do this. Export a backup to keep them.',
  },
};

const LOAD_MESSAGES = {
  'malformed-json': {
    title: 'Saved data could not be read',
    text: 'Heft started empty rather than guessing. Nothing was overwritten — the '
      + 'unreadable data is still in this browser, and restoring a backup will replace it.',
  },
  'future-schema': {
    title: 'Your saved data comes from a newer version of Heft',
    text: 'It has been left exactly as it is and Heft is running read-only, because '
      + 'writing a version it cannot read would destroy it. Update Heft, or restore a backup.',
  },
  unreadable: {
    title: 'Local storage is unavailable',
    text: 'Nothing you enter will persist past this tab. Export a backup before you close it.',
  },
};

/**
 * Hand a string to the browser as a file.
 *
 * The BOM is not decoration. Excel reads a CSV without one as the system code
 * page, which turns every ₹ and every non-ASCII note into mojibake — and the
 * notes are the whole reason someone opens the file. It goes on the Blob and
 * never into the CSV module, which stays a pure string function with no
 * opinion about who is going to read it.
 */
function download(text, filename, type) {
  const parts = type.startsWith('text/csv') ? ['﻿', text] : [text];
  const url = URL.createObjectURL(new Blob(parts, { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next turn: revoking synchronously can cancel the download
  // in some browsers before they have finished reading the blob.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function createManageData({ store, announce, closeDrawer }) {
  /**
   * Every sheet here restores focus to whatever opened it. `<dialog>` does
   * some of this itself, but not when the sheet was opened from the drawer —
   * the drawer closes underneath it, so the element `<dialog>` would restore
   * to is gone by the time it tries. Tracking the trigger explicitly is the
   * only version that survives that.
   */
  function openSheet(dialog, trigger, focus) {
    dialog.returnFocusTo = trigger ?? null;
    dialog.showModal();
    if (focus) focus.focus();
  }

  for (const id of ['report-dialog', 'backup-dialog', 'danger-dialog']) {
    $(id).addEventListener('close', () => {
      // All three of these are opened from the drawer, so by now the trigger
      // is inside an inert subtree and cannot take focus. The fallback is
      // stated rather than left to chance — see ui/focus.js.
      restoreFocus($(id).returnFocusTo, $('drawer-open'));
      $(id).returnFocusTo = null;
    });
  }

  const closeWith = (dialogId, buttonIds) => {
    for (const id of buttonIds) {
      $(id).addEventListener('click', () => $(dialogId).close());
    }
  };

  /* ============================================================ export -- */

  const REPORT_FORMATS = {
    json: {
      label: 'Backup · JSON',
      help: 'Everything: transactions, accounts, categories, the plan and your '
        + 'preferences. This is the file Restore reads — the only one that comes back.',
      build: (state) => ({
        text: JSON.stringify(buildExport(state), null, 2),
        name: exportFilename(),
        type: 'application/json',
      }),
    },
    records: {
      label: 'Records · CSV',
      help: 'One row per transaction, oldest first, for a spreadsheet. Amounts are '
        + 'positive with the direction in its own column, and transfers are marked '
        + 'as transfers — so a total has to say which rows it means. Heft does not '
        + 'read CSV back.',
      build: (state) => ({
        text: transactionsToCsv(state),
        name: csvFilename('records'),
        type: 'text/csv;charset=utf-8',
      }),
    },
    budgets: {
      label: 'Budgets · CSV',
      help: 'One row per month per budgeted category. Separate from the records '
        + 'because a budget belongs to a month, not to any one transaction.',
      build: (state) => ({
        text: budgetsToCsv(state),
        name: csvFilename('budgets'),
        type: 'text/csv;charset=utf-8',
      }),
    },
  };

  let reportFormat = 'json';

  /** What is actually in the file, counted from the state rather than promised. */
  function paintReport() {
    const { data } = store.getState();
    const format = REPORT_FORMATS[reportFormat];
    $('report-help').textContent = format.help;

    const budgetMonths = Object.keys(data.budgets ?? {}).length;
    const counts = reportFormat === 'budgets'
      ? [plural(budgetMonths, 'month'), 'of budgets']
      : [
        plural(data.transactions.length, 'record'),
        `· ${plural(data.accounts.length, 'account')}`,
        `· ${plural(data.categories.length, 'category', 'categories')}`,
        ...(reportFormat === 'json' ? [`· ${plural(budgetMonths, 'month')} of budgets`] : []),
      ];
    $('report-contents').textContent = counts.join(' ');

    const empty = reportFormat === 'budgets' ? budgetMonths === 0 : data.transactions.length === 0;
    // Still downloadable when empty — a header-only CSV is a valid answer to
    // "what have I got", and refusing would be a puzzle rather than a help.
    $('report-download').textContent = empty ? 'Download anyway' : 'Download';
  }

  wireChoice($('report-format'), (value) => {
    if (!REPORT_FORMATS[value]) return;
    reportFormat = value;
    paintChoice($('report-format'), value);
    paintReport();
  });

  function openReport(trigger) {
    $('report-lede').textContent = 'A backup you can restore, or a spreadsheet you can read. '
      + 'Nothing leaves this browser — the file is written here and saved by you.';
    paintChoice($('report-format'), reportFormat);
    paintReport();
    openSheet($('report-dialog'), trigger);
  }

  $('report-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const { data } = store.getState();
    const { text, name, type } = REPORT_FORMATS[reportFormat].build(data);
    download(text, name, type);
    announce.say(`Exported ${name}.`);
    $('report-dialog').close();
  });

  closeWith('report-dialog', ['report-close', 'report-cancel']);

  /* =========================================================== restore -- */

  /** The parsed, migrated file, or null. Nothing downstream runs without it. */
  let pending = null;
  let restoreMode = 'merge';

  const MODE_HELP = {
    merge: 'Adds what the file has and you do not. Anything you already have is kept '
      + 'exactly as it is, including records the file also contains — so a backup from '
      + 'last week cannot revert an edit you made this morning.',
    replace: 'Throws away this ledger and takes the file’s instead. Records you have '
      + 'that the file does not are gone for good.',
  };

  function resetRestore() {
    pending = null;
    restoreMode = 'merge';
    $('backup-file').value = '';
    $('backup-error').textContent = '';
    $('backup-preview').hidden = true;
    $('backup-summary').replaceChildren();
    $('backup-warning').hidden = true;
    $('backup-apply').disabled = true;
    $('backup-apply').textContent = 'Restore';
    paintChoice($('backup-mode'), 'merge');
  }

  /** One labelled figure. `tone` is styling; the label carries the meaning. */
  function previewRow(label, value, tone) {
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

  /**
   * Exactly what the chosen mode would do, as a list of figures.
   *
   * Every line is present in both modes even when the figure is zero, and
   * "Changed" showing 0 under Merge is the most important line in the sheet:
   * it is the difference between promising not to overwrite anything and
   * merely not mentioning it.
   */
  function paintRestorePreview() {
    const { data } = store.getState();
    const summary = summariseImport(data, pending.state);
    const plan = summary[restoreMode];

    const head = document.createElement('p');
    head.className = 'preview-head';
    head.textContent = pending.exportedAt
      ? `This file holds ${plural(summary.incoming.transactions, 'record')}, exported ${pending.exportedAt.slice(0, 10)}.`
      : `This file holds ${plural(summary.incoming.transactions, 'record')}.`;

    const rows = [
      previewRow('You have now', String(summary.current.transactions)),
      previewRow('Added', `+${plan.transactionsAdded}`, plan.transactionsAdded ? 'add' : null),
      previewRow('Changed', String(plan.transactionsUpdated), plan.transactionsUpdated ? 'remove' : null),
      previewRow(
        restoreMode === 'merge' ? 'Already here, left alone' : 'In both files',
        String(summary.conflicts),
      ),
      previewRow('Deleted for good', `−${plan.transactionsRemoved}`, plan.transactionsRemoved ? 'remove' : null),
    ];
    if (plan.categoriesAdded) rows.push(previewRow('New categories', `+${plan.categoriesAdded}`, 'add'));
    if (plan.accountsAdded) rows.push(previewRow('New accounts', `+${plan.accountsAdded}`, 'add'));
    rows.push(previewRow('You will have', String(plan.transactionsAfter), 'total'));

    $('backup-summary').replaceChildren(head, ...rows);
    $('backup-mode-help').textContent = MODE_HELP[restoreMode];

    // The warning is not styling on the button. It is a sentence naming the
    // number of records that will cease to exist, shown only when that number
    // is not zero.
    const losing = plan.transactionsRemoved;
    $('backup-warning').hidden = losing === 0;
    $('backup-warning').textContent = losing === 0 ? '' : `Replacing deletes ${plural(losing, 'record')} that this file does not contain. There is no undo for this.`;

    $('backup-apply').textContent = restoreMode === 'replace' ? 'Replace everything' : 'Merge in';
    $('backup-apply').className = restoreMode === 'replace' ? 'btn btn-danger' : 'btn btn-primary';
  }

  wireChoice($('backup-mode'), (value) => {
    if (value !== 'merge' && value !== 'replace') return;
    restoreMode = value;
    paintChoice($('backup-mode'), value);
    if (pending) paintRestorePreview();
  });

  $('backup-file').addEventListener('change', async () => {
    // Every previous answer goes before a new file is read, so a rejected
    // file can never leave a live Restore button behind it.
    pending = null;
    $('backup-error').textContent = '';
    $('backup-preview').hidden = true;
    $('backup-apply').disabled = true;

    const file = $('backup-file').files?.[0];
    if (!file) return;

    let text;
    try {
      text = await file.text();
    } catch {
      $('backup-error').textContent = 'That file could not be read.';
      return;
    }

    const result = readImport(text);
    if (!result.ok) {
      const message = IMPORT_ERRORS[result.reason] ?? 'That file could not be restored.';
      $('backup-error').textContent = message;
      announce.say(message);
      return;
    }

    pending = result;
    $('backup-preview').hidden = false;
    $('backup-apply').disabled = false;
    paintRestorePreview();
    announce.say(`${file.name} read. Check what it will change before restoring.`);
  });

  $('backup-form').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!pending) return;
    const result = store.importState(pending.state, restoreMode);
    if (result.ok) {
      announce.say(restoreMode === 'merge'
        ? `Merged. You now have ${plural(result.transactions, 'record')}.`
        : `Replaced. You now have ${plural(result.transactions, 'record')}.`);
    }
    $('backup-dialog').close();
  });

  closeWith('backup-dialog', ['backup-close', 'backup-cancel']);
  $('backup-dialog').addEventListener('close', resetRestore);

  /* ============================================================ delete -- */

  /* A different word for each, on purpose: having typed one must not carry
     you through the other by muscle memory. */
  const DANGER = {
    transactions: {
      word: 'CLEAR',
      button: 'Clear transactions',
      consequence: (data) => `Deletes ${plural(data.transactions.length, 'record')}. `
        + `Your ${plural(data.accounts.length, 'account')}, `
        + `${plural(data.categories.length, 'category', 'categories')}, your budgets and `
        + 'your preferences all stay — including the opening balances, so your accounts '
        + 'go back to exactly what they started with.',
      run: () => store.clearAll(),
      done: (n) => `Cleared ${plural(n, 'record')}. Your accounts and categories are untouched.`,
    },
    everything: {
      word: 'RESET',
      button: 'Reset everything',
      consequence: (data) => `Deletes ${plural(data.transactions.length, 'record')}, `
        + `${plural(data.accounts.length, 'account')} with their opening balances, `
        + `${plural(data.categories.length, 'category', 'categories')}, `
        + `${plural(Object.keys(data.budgets ?? {}).length, 'month')} of budgets and every `
        + 'preference. Heft goes back to a fresh install.',
      run: () => store.resetAll(),
      done: (n) => `Reset. ${plural(n, 'record')} deleted, and Heft is back to its starting state.`,
    },
  };

  let dangerScope = 'transactions';

  function paintDanger() {
    const { data } = store.getState();
    const spec = DANGER[dangerScope];
    $('danger-consequence').textContent = spec.consequence(data);
    $('danger-prompt').textContent = `Type ${spec.word} to confirm`;
    $('danger-confirm').textContent = spec.button;
    syncDanger();
  }

  function syncDanger() {
    $('danger-confirm').disabled = $('danger-input').value.trim() !== DANGER[dangerScope].word;
  }

  $('danger-input').addEventListener('input', syncDanger);

  wireChoice($('danger-scope'), (value) => {
    if (!DANGER[value]) return;
    dangerScope = value;
    paintChoice($('danger-scope'), value);
    // The word changes, so anything already typed is now the wrong word and
    // is cleared rather than left sitting under a button it no longer arms.
    $('danger-input').value = '';
    paintDanger();
  });

  $('danger-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const spec = DANGER[dangerScope];
    // Checked again here rather than trusting the disabled button: a submit
    // can arrive by Enter from the field, and the guard belongs on the action.
    if ($('danger-input').value.trim() !== spec.word) return;
    const result = spec.run();
    if (result.ok) announce.say(spec.done(result.removed ?? 0));
    $('danger-dialog').close();
  });

  closeWith('danger-dialog', ['danger-close', 'danger-cancel']);
  $('danger-dialog').addEventListener('close', () => {
    $('danger-input').value = '';
    dangerScope = 'transactions';
    paintChoice($('danger-scope'), 'transactions');
    paintDanger();
  });

  /* ====================================================== the openers -- */

  const openers = [
    ['open-report', (trigger) => openReport(trigger)],
    ['open-backup', (trigger) => {
      resetRestore();
      openSheet($('backup-dialog'), trigger, $('backup-file'));
    }],
    ['open-danger', (trigger) => {
      dangerScope = 'transactions';
      $('danger-input').value = '';
      paintChoice($('danger-scope'), 'transactions');
      paintDanger();
      openSheet($('danger-dialog'), trigger);
    }],
  ];

  for (const [id, open] of openers) {
    $(id).addEventListener('click', () => {
      const trigger = $(id);
      // The drawer closes first so the sheet is not stacked on a scrim, and
      // the trigger is captured before it goes inert.
      closeDrawer();
      open(trigger);
    });
  }

  // "Make a backup instead" — the same sheet the drawer opens, so there is
  // one export path rather than a second one that could drift from it.
  $('backup-to-report').addEventListener('click', () => {
    const trigger = $('backup-dialog').returnFocusTo;
    $('backup-dialog').close();
    openReport(trigger);
  });

  /* ================================================= storage problems -- */

  $('storage-alert-dismiss').addEventListener('click', () => {
    store.dismissSaveError();
    $('storage-alert').hidden = true;
  });

  $('storage-alert-export').addEventListener('click', () => {
    // Straight to the JSON backup: the alert is telling someone their data is
    // at risk, and making them pick a format first is the wrong moment for a
    // choice.
    const { data } = store.getState();
    const { text, name, type } = REPORT_FORMATS.json.build(data);
    download(text, name, type);
    announce.say(`Exported ${name}.`);
  });

  let lastProblem = null;

  /**
   * Called on every store notification. A save that failed and a load that
   * warned are the same class of fact — the data on screen and the data on
   * disk disagree — so they share one banner and one vocabulary.
   */
  function renderProblem(ui) {
    const problem = SAVE_MESSAGES[ui.saveError] ?? LOAD_MESSAGES[ui.loadWarning] ?? null;
    $('storage-alert').hidden = !problem;
    if (!problem) {
      lastProblem = null;
      return;
    }
    $('storage-alert-title').textContent = problem.title;
    $('storage-alert-text').textContent = problem.text;
    // Read-only means there is nothing to dismiss to; the banner is the state
    // of the app rather than a notification about it.
    $('storage-alert-dismiss').hidden = ui.readOnly;

    // `role="alert"` announces on insertion. Re-announcing the same problem on
    // every keystroke that fails to save would make the app unusable with a
    // screen reader, so it speaks once per distinct problem.
    const key = ui.saveError ?? ui.loadWarning;
    if (key !== lastProblem) {
      lastProblem = key;
      announce.say(`${problem.title}. ${problem.text}`);
      // The banner sits at the top of the page, and the save that failed may
      // well have happened three hundred rows down. Announcing it to a screen
      // reader and leaving it off-screen for everyone else is half a warning.
      $('storage-alert').scrollIntoView({ block: 'nearest' });
    }
  }

  /** The one-line inventory at the foot of the drawer. */
  function renderDrawerNote(data) {
    const bytes = new Blob([JSON.stringify(data)]).size;
    const size = bytes < 1024
      ? `${bytes} bytes`
      : `${(bytes / 1024).toFixed(bytes < 102400 ? 1 : 0)} KB`;
    $('drawer-note').textContent = [
      plural(data.transactions.length, 'record'),
      plural(data.accounts.length, 'account'),
      plural(data.categories.length, 'category', 'categories'),
      `${size} in this browser`,
    ].join(' · ');
  }

  return {
    render({ data, ui }) {
      renderProblem(ui);
      renderDrawerNote(data);
      if (!$('report-dialog').open) return;
      paintReport();
    },
  };
}
