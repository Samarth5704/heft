/**
 * focus.js — where focus goes when a dialog closes.
 *
 * One rule, in one place, because the interesting case is not the obvious one.
 *
 * A sheet normally returns focus to the control that opened it. But four of
 * this app's sheets are opened from the drawer, and the drawer closes as they
 * open — so by the time the sheet is dismissed, its trigger is inside an
 * `inert` subtree. Calling `.focus()` on it does nothing at all, silently, and
 * focus is left wherever it happened to be. That is not a crash and it is not
 * visible in a screenshot; it is the kind of thing that only shows up when
 * someone closes a sheet with Escape and finds Tab starting again from the top
 * of the page.
 *
 * So the fallback is chosen rather than inherited: if the trigger cannot take
 * focus, focus goes to the control that opens the drawer, which is the nearest
 * thing still on screen that the trigger belonged to.
 */

/** Can this element actually receive focus right now? */
export function canFocus(el) {
  if (!el || !document.contains(el)) return false;
  if (el.closest('[inert]')) return false;
  if (el.hasAttribute('disabled')) return false;
  // `hidden` and `display: none` both make an element unfocusable, and an
  // element inside a closed <dialog> is not rendered either.
  return el.offsetParent !== null || el === document.body;
}

/**
 * Put focus back, deferred by a tick.
 *
 * The tick matters: `<dialog>` runs its own focus restoration when it closes,
 * and going first means the browser can undo us.
 *
 * @param {Element|null} trigger  what opened the thing that is closing
 * @param {Element|null} fallback where to go if the trigger cannot take focus
 */
export function restoreFocus(trigger, fallback = null) {
  setTimeout(() => {
    if (canFocus(trigger)) trigger.focus();
    else if (canFocus(fallback)) fallback.focus();
  }, 0);
}
