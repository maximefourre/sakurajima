/**
 * boot.js — loads the scene and makes failures visible.
 *
 * Deliberately an external module rather than an inline <script>: an inline
 * module that fails to parse takes the whole page down with a line number that
 * points at the HTML, which is a miserable thing to debug.
 */
const show = (e) => {
  const el = document.getElementById('fatal');
  if (el) {
    el.style.display = 'grid';
    el.textContent = '[erreur] ' + (e && e.stack ? e.stack : String(e));
  }
  console.error(e);
};

window.addEventListener('error', (e) => show(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => show(e.reason));

import('./main.js').catch(show);
