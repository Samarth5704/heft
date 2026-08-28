/**
 * announcer.js — one polite live region for the whole app.
 *
 * A single region shared by every view, so announcements queue instead of
 * competing. The text is cleared first and set on a timer: repeating the same
 * string into a live region is otherwise silently ignored.
 *
 * A timer, not requestAnimationFrame — frames are throttled in a background
 * or hidden tab, and an announcement that never fires is worse than none.
 */

export function createAnnouncer(node) {
  let timer = 0;

  return {
    say(message) {
      if (!node || !message) return;
      clearTimeout(timer);
      node.textContent = '';
      timer = setTimeout(() => {
        node.textContent = message;
      }, 40);
    },
    clear() {
      clearTimeout(timer);
      if (node) node.textContent = '';
    },
  };
}
