/* Short spoken updates for screen readers, through the one live region in index.html
   (<div id="live" role="status" aria-live="polite">). The router empties it on every route change. */

/** Say one short line: the result of something the person just changed. */
export function announce(text) {
  const live = document.getElementById('live');
  if (live) live.textContent = text;
}
