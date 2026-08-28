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
import { formatAmount } from '../lib/money.js';
import { formatRelativeDay } from '../lib/dates.js';

const SPEAK_DELAY_MS = 600;
const NOTICE_MS = 12000;

const MATCH_NOTE = {
  name: '',
  synonym: 'matched by name in the note',
  default: 'default category',
};

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

    if (result.error === 'empty') return;

    if (result.error) {
      const message = document.createElement('p');
      message.className = 'qa-message';
      message.textContent = result.message;
      preview.append(message);
      return;
    }

    const amount = document.createElement('span');
    amount.className = 'qa-amount';
    const sym = document.createElement('span');
    sym.className = 'sym';
    sym.setAttribute('aria-hidden', 'true');
    sym.textContent = '₹';
    amount.append(sym, formatAmount(result.amountPaise));
    preview.append(facet('Amount', amount));

    preview.append(facet('Date', formatRelativeDay(result.date, ctx.today)));

    const category = ctx.categories.find((c) => c.id === result.categoryId);
    const catWrap = document.createElement('span');
    catWrap.className = 'qa-cat';
    const dot = document.createElement('span');
    dot.className = 'cat-dot';
    dot.setAttribute('aria-hidden', 'true');
    dot.style.setProperty('--cat', `var(--${category?.colorToken ?? 'cat-neutral'})`);
    catWrap.append(dot, category?.name ?? 'Other');
    preview.append(facet('Category', catWrap, MATCH_NOTE[result.matchedBy]));

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
      const category = ctx.categories.find((c) => c.id === result.categoryId);
      live.textContent = [
        `₹${formatAmount(result.amountPaise)}`,
        formatRelativeDay(result.date, ctx.today),
        category?.name ?? 'Other',
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
    onSubmit({
      amountPaise: result.amountPaise,
      date: result.date,
      categoryId: result.categoryId,
      note: result.note,
    });
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
