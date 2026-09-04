/**
 * choice.js — the radiogroup behaviour, in one place.
 *
 * Both sheets and the Analysis view switch are real radio groups, not rows of
 * buttons that look like one: a single tab stop, arrow keys that move the
 * selection and the focus together, `aria-checked` on the buttons and a
 * roving `tabindex`. Getting that right once and importing it is the only way
 * the third group is as correct as the first.
 */

const buttonsIn = (group) => [...group.querySelectorAll('.opt-choice')];

/** Paint which option is current. Safe to call before the group is wired. */
export function paintChoice(group, value) {
  if (!group) return;
  for (const b of buttonsIn(group)) {
    const on = b.dataset.value === value;
    b.setAttribute('aria-checked', String(on));
    // Roving tabindex: one stop for the group, and it is the checked one, so
    // tabbing in lands on the current answer rather than the first option.
    b.tabIndex = on ? 0 : -1;
  }
}

/**
 * Wire clicks and arrow keys. `onPick` receives the chosen value; the caller
 * repaints, because only the caller knows whether the pick was accepted.
 */
export function wireChoice(group, onPick) {
  if (!group) return;
  const buttons = buttonsIn(group);
  for (const b of buttons) b.addEventListener('click', () => onPick(b.dataset.value));

  group.addEventListener('keydown', (event) => {
    const i = buttons.indexOf(document.activeElement);
    if (i === -1) return;
    const last = buttons.length - 1;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = (i + 1) % buttons.length;
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = (i - 1 + buttons.length) % buttons.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    else return;
    event.preventDefault();
    buttons[next].focus();
    onPick(buttons[next].dataset.value);
  });
}
