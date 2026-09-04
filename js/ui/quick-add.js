/**
 * quick-add.js — the command line for money.
 *
 * One input, parsed on every keystroke by lib/parse.js, with the parse shown
 * back to you before you commit it. Nothing here knows how to tokenize; it
 * only renders what the parser decided and reports what the user pressed.
 *
 * The preview updates visually on every keystroke, but the spoken summary is
 * debounced into its own live region — announcing a re-parse per character
 * would make the field unusable with a screen reader.
 */

import { parseQuickAdd } from '../lib/parse.js';
import { signedMoney } from '../lib/format.js';
import { formatRelativeDay } from '../lib/dates.js';
import { icon } from './icon.js';

const SPEAK_DELAY_MS = 600;
const NOTICE_MS = 12000;

const MATCH_NOTE = {
  name: '',
  synonym: 'matched by name in the note',
  default: 'default category',
  none: '',
};

const KIND_LABEL = { expense: 'Expense', income: 'Income', transfer: 'Transfer' };

export function createQuickAdd({
  form, input, preview, hint, live, getContext, onSubmit, onOpenDetails,
}) {
  let speakTimer = 0;
  let noticeTimer = 0;
  let lastParse = null;

  const facet = (label, value, extra) => {
    const wrap = document.createElement('span');
    wrap.className = 'qa-facet';

    const key = document.createElement('span');
    key.className = 'qa-key';
    key.textContent = label;

    const val = document.createElement('span');
    val.className = 'qa-val';
    if (typeof value === 'string') val.textContent = value;
    else val.append(value);

    wrap.append(key, val);
    if (extra) {
      const note = document.createElement('span');
      note.className = 'qa-aside';
      note.textContent = extra;
      wrap.append(note);
    }
    return wrap;
  };

  function renderPreview(result, ctx) {
    preview.replaceChildren();
    preview.dataset.state = result.error ?? 'ok';
    preview.dataset.kind = result.kind;

    if (result.error === 'empty') return;

    if (result.error) {
      const message = document.createElement('p');
      message.className = 'qa-message';
      message.textContent = result.message;
      preview.append(message);
      return;
    }

    /* The kind leads the preview because it is what the rest of the line
       means: the same words parse differently under it. */
    const kindTag = document.createElement('span');
    kindTag.className = 'qa-kind';
    kindTag.dataset.kind = result.kind;
    kindTag.append(icon(result.kind === 'transfer' ? 'transfer' : 'plus'), KIND_LABEL[result.kind]);
    preview.append(facet('Type', kindTag));

    const signed = signedMoney(result.amountPaise, result.kind, ctx.display);
    const amount = document.createElement('span');
    amount.className = 'qa-amount';
    amount.dataset.tone = signed.tone;
    amount.textContent = signed.text;
    preview.append(facet('Amount', amount));

    preview.append(facet('Date', formatRelativeDay(result.date, ctx.today)));

    if (result.kind === 'transfer') {
      const accounts = ctx.accounts ?? [];
      const name = (id) => accounts.find((a) => a.id === id)?.name ?? 'Unknown';
      // A transfer has no category. Where it went is the destination account,
      // and that is what fills the slot a category would have.
      preview.append(facet('Moves', `${name(result.accountId)} \u2192 ${name(result.toAccountId)}`));
    } else {
      const category = ctx.categories.find((c) => c.id === result.categoryId);
      const catWrap = document.createElement('span');
      catWrap.className = 'qa-cat';
      const dot = document.createElement('span');
      dot.className = 'cat-dot';
      dot.setAttribute('aria-hidden', 'true');
      dot.style.setProperty('--cat', `var(--${category?.colorToken ?? 'cat-neutral'})`);
      catWrap.append(dot, category?.name ?? 'Other');
      preview.append(facet('Category', catWrap, MATCH_NOTE[result.matchedBy]));

      const account = (ctx.accounts ?? []).find((a) => a.id === result.accountId);
      if (account) preview.append(facet('Account', account.name));
    }

    if (result.note) preview.append(facet('Note', result.note));

    for (const warning of result.warnings) {
      const note = document.createElement('p');
      note.className = 'qa-message qa-message-warn';
      note.textContent = warning;
      preview.append(note);
    }
  }

  function speak(result, ctx) {
    clearTimeout(speakTimer);
    speakTimer = setTimeout(() => {
      if (!live) return;
      if (result.error === 'empty') { live.textContent = ''; return; }
      if (result.error) { live.textContent = result.message; return; }

      const signed = signedMoney(result.amountPaise, result.kind, ctx.display);
      const accounts = ctx.accounts ?? [];
      const name = (id) => accounts.find((a) => a.id === id)?.name ?? 'Unknown';
      const subject = result.kind === 'transfer'
        ? `${name(result.accountId)} to ${name(result.toAccountId)}`
        : ctx.categories.find((c) => c.id === result.categoryId)?.name ?? 'Other';

      // The kind is spoken, not merely coloured, and the amount carries its
      // word rather than its sign — "minus" is not what a person means.
      live.textContent = [
        KIND_LABEL[result.kind],
        signed.text.replace(/^[+\u2212]/, ''),
        subject,
        formatRelativeDay(result.date, ctx.today),
        result.note,
      ].filter(Boolean).join(', ');
    }, SPEAK_DELAY_MS);
  }

  function reparse() {
    const ctx = getContext();
    const result = parseQuickAdd(input.value, ctx);
    lastParse = result;
    renderPreview(result, ctx);
    speak(result, ctx);
    input.setAttribute('aria-invalid', result.error && result.error !== 'empty' ? 'true' : 'false');
    return result;
  }

  function clearNotice() {
    clearTimeout(noticeTimer);
    hint.replaceChildren();
    hint.hidden = true;
  }

  /** A one-line message under the input, with an optional action. */
  function showNotice(text, action) {
    clearTimeout(noticeTimer);
    hint.replaceChildren(text);
    if (action) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'link-button';
      button.textContent = action.label;
      button.addEventListener('click', () => {
        clearNotice();
        action.run();
      });
      hint.append(' ', button);
    }
    hint.hidden = false;
    noticeTimer = setTimeout(clearNotice, NOTICE_MS);
  }

  input.addEventListener('input', () => {
    clearNotice();
    reparse();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const result = reparse();
    if (result.error) {
      input.focus();
      return;
    }
    onSubmit(result);
    input.value = '';
    reparse();
    input.focus();
  });

  if (onOpenDetails) {
    form.addEventListener('keydown', (event) => {
      // Tab out of a half-typed line into the full form without losing it.
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        onOpenDetails(lastParse);
      }
    });
  }

  reparse();

  return {
    focus() {
      input.focus();
      input.select();
      input.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    },
    get parse() { return lastParse; },
    showNotice,
    clearNotice,
    refresh: reparse,
  };
}
