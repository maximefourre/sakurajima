/*
 * Bouton « Effacer la progression » du panneau de réglages (DOM pur, aucun
 * Three, aucun quest : l'effacement est le crochet `onConfirm`, câblé dans
 * main.js).
 *
 * Confirmation en deux temps SANS confirm()/alert()/prompt() (ils bloquent
 * l'automatisation) : le 1er clic arme (message + « Oui » / « Annuler »), et
 * l'état redevient initial après DELAY_MS sans action, sur « Annuler », ou au
 * premier pointeur posé hors de la rangée. Seul « Oui » appelle onConfirm.
 * Le markup (#reset-row …) et le CSS vivent dans index.html.
 */

const DELAY_MS = 5000;
const ASK_TEXT = 'Vraiment ? Tampons, omamori, défis et foulard';

export function createResetControl({ onConfirm, delay = DELAY_MS, root = document } = {}) {
  const q = (sel) => root.querySelector(sel);
  const row = q('#reset-row');
  const btn = q('#reset-btn');
  const msg = q('#reset-msg');
  const ask = q('#reset-confirm');
  const yes = q('#reset-yes');
  const no = q('#reset-no');
  if (!row || !btn || !msg || !ask || !yes || !no) throw new Error('reset-ui : markup #reset-row absent');

  let timer = 0;

  function disarm() {
    clearTimeout(timer);
    timer = 0;
    root.removeEventListener('pointerdown', onOutside, true);
    // Le focus qui était dans la confirmation (désormais masquée) revient au bouton.
    const refocus = ask.contains(root.activeElement);
    ask.hidden = true;
    msg.textContent = '';
    btn.hidden = false;
    if (refocus) btn.focus();
  }

  function arm() {
    if (timer) return;
    btn.hidden = true;
    msg.textContent = ASK_TEXT;
    ask.hidden = false;
    no.focus();                                   // défaut sûr au clavier
    timer = setTimeout(disarm, delay);
    root.addEventListener('pointerdown', onOutside, true);
  }

  function onOutside(e) {
    if (!row.contains(e.target)) disarm();
  }

  btn.addEventListener('click', arm);
  no.addEventListener('click', disarm);
  yes.addEventListener('click', () => {
    disarm();
    if (typeof onConfirm === 'function') onConfirm();
  });

  return {
    isArmed: () => !!timer,
    cancel: disarm,
    dispose() {
      disarm();
      btn.removeEventListener('click', arm);
      no.removeEventListener('click', disarm);
    },
  };
}
