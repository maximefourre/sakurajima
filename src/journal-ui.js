/*
 * Carnet goshuin + toasts (DOM pur, aucun Three).
 *
 * Le markup (#toasts, #journal, #journal-btn) et tout le CSS vivent dans
 * index.html ; ce module les remplit et les pilote. Il ne lit le quest que par
 * stamps(), totals() et on() — jamais son état interne.
 *
 * Les touches globales (J / Échap / H) sont câblées dans main.js : ici on
 * expose toggle() / close() / setHidden() et le crochet onOpenChange(open). Seule exception : Échap pressé
 * DANS le carnet le ferme et s'arrête là, sinon le reset de vue de main.js le
 * verrait en même temps.
 */

const TOAST_MS = 3500;
const QUIET_MS = 2400;
const FADE_MS = 450;
const QUEUE_MAX = 6;

const QUEST_EVENTS = ['stamp', 'treasure', 'challenge-tier', 'complete'];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function seal(kanji, { round = false, gold = false } = {}) {
  const s = el('span', 'seal' + (round ? ' round' : '') + (gold ? ' gold' : ''), kanji);
  s.dataset.n = String(Math.min([...kanji].length, 4));
  s.setAttribute('aria-hidden', 'true');
  return s;
}

function sniffText(strength) {
  const k = Number.isFinite(strength) ? strength : 0;
  if (k < 0.25) return 'Une odeur lointaine…';
  if (k < 0.6) return 'Ça sent quelque chose…';
  return 'Tout près !';
}

// Contenu d'un toast, ou null si le kind/payload est inconnu.
function describe(kind, p) {
  p = p || {};
  switch (kind) {
    case 'stamp':
      return { key: 'stamp:' + p.id, kanji: p.kanji || '印', title: p.name || 'Nouveau sceau', sub: 'Sceau reçu' };
    case 'treasure':
      return {
        key: 'treasure:' + p.id, kanji: '守', title: 'Omamori trouvé',
        sub: Number.isFinite(p.total) ? `${p.got} sur ${p.total}` : '',
      };
    case 'challenge-tier': {
      return {
        key: 'tier:' + p.id + ':' + p.tier,
        kanji: p.kanji || '印', round: true,
        title: p.name || 'Défi',
        sub: p.tier > 1 ? `Palier des ${p.tier}` : 'Premier palier',
      };
    }
    case 'complete':
      return p.kind === 'treasures'
        ? { key: 'complete:treasures', kanji: '守', gold: true, title: 'Tous les omamori', sub: 'Le shiba noue un foulard rouge', ms: TOAST_MS + 800 }
        : { key: 'complete:stamps', kanji: '満', gold: true, round: true, title: 'Carnet complet', sub: 'Tous les sceaux réunis — sceau doré', ms: TOAST_MS + 800 };
    case 'sniff':
      return { key: 'sniff', quiet: true, title: p.text || sniffText(p.strength), ms: QUIET_MS };
    default:
      return null;
  }
}

export function createJournalUI({ quest, root = document } = {}) {
  const q = (sel) => root.querySelector(sel);
  const toastsEl = q('#toasts');
  const journalEl = q('#journal');
  if (!toastsEl || !journalEl) throw new Error('journal-ui : markup #toasts / #journal absent');
  const sheet = journalEl.querySelector('.j-sheet');
  const closeBtn = journalEl.querySelector('.j-close');
  const stampsEl = journalEl.querySelector('#j-stamps');
  const haikuEl = journalEl.querySelector('#j-haiku');
  const charmsEl = journalEl.querySelector('#j-charms');
  const charmsSec = journalEl.querySelector('#j-sec-charms');
  const noteEl = journalEl.querySelector('#j-note');
  const chalEl = journalEl.querySelector('#j-challenges');
  const goldEl = journalEl.querySelector('.j-gold');
  const nStamps = journalEl.querySelector('#j-n-stamps');
  const nCharms = journalEl.querySelector('#j-n-charms');
  const openBtn = q('#journal-btn');

  let hidden = false;
  let goldSeen = false;       // 'complete' stamps reçu pendant la session
  let selected = null;        // id du sceau dont le poème est affiché
  let restoreFocus = null;
  const seen = new Set();     // sceaux déjà présentés au joueur (animation « pressé »)

  /* ── toasts ─────────────────────────────────────────────── */
  const queue = [];
  let current = null;         // { node, key, t1, t2 }
  let timerId = 0;

  function showNext() {
    if (current || hidden || !queue.length) return;
    const d = queue.shift();
    const node = el('div', 'toast' + (d.quiet ? ' quiet' : ''));
    if (d.kanji) node.appendChild(seal(d.kanji, { round: d.round, gold: d.gold }));
    const body = el('div', 't-body');
    body.appendChild(el('span', 't-title', d.title));
    if (d.sub) body.appendChild(el('span', 't-sub', d.sub));
    node.appendChild(body);
    toastsEl.appendChild(node);
    void node.offsetWidth;            // fige l'état de départ avant la transition
    node.classList.add('on');
    current = { node, key: d.key };
    timerId = setTimeout(() => {
      node.classList.remove('on');
      timerId = setTimeout(() => {
        node.remove();
        current = null;
        timerId = 0;
        showNext();
      }, FADE_MS);
    }, d.ms || TOAST_MS);
  }

  function clearToasts() {
    queue.length = 0;
    if (timerId) clearTimeout(timerId);
    timerId = 0;
    if (current) current.node.remove();
    current = null;
  }

  function toast(kind, payload) {
    if (hidden) return;
    const d = describe(kind, payload);
    if (!d) return;
    // Un même toast déjà affiché ou en attente n'est pas répété (R répété).
    if (current && current.key === d.key && d.quiet) return;
    if (queue.some((x) => x.key === d.key)) return;
    if (queue.length >= QUEUE_MAX) {
      const i = queue.findIndex((x) => x.quiet);
      if (d.quiet) return;
      queue.splice(i < 0 ? 0 : i, 1);
    }
    queue.push(d);
    showNext();
  }

  /* ── carnet ─────────────────────────────────────────────── */
  function selectStamp(s) {
    selected = s ? s.id : null;
    haikuEl.replaceChildren();
    if (!s) return;
    if (s.got) {
      for (const line of s.haiku || []) haikuEl.appendChild(el('span', 'l', line));
      haikuEl.appendChild(el('span', 'by', `${s.kanji} — ${s.name}`));
    } else {
      haikuEl.appendChild(el('span', 'hint', `Pas encore tamponné. Approchez-vous de « ${s.name} ».`));
    }
  }

  function renderStamps(stamps, totals) {
    const focusedId = stampsEl.contains(document.activeElement) ? document.activeElement.dataset.id : null;
    stampsEl.replaceChildren();
    let sel = null;
    for (const s of stamps) {
      const li = el('li', 'j-cell' + (s.got ? ' got' : ''));
      const b = el('button');
      b.type = 'button';
      b.dataset.id = s.id;
      b.setAttribute('aria-pressed', String(s.id === selected));
      b.setAttribute('aria-label', `${s.name} — ${s.got ? 'sceau obtenu' : 'pas encore tamponné'}`);
      const slot = el('span', 'j-slot');
      if (s.got) {
        const sl = seal(s.kanji);
        if (!seen.has(s.id)) sl.classList.add('fresh');
        slot.appendChild(sl);
        seen.add(s.id);
      } else {
        const g = el('span', 'ghost', s.kanji);
        g.dataset.n = String(Math.min([...s.kanji].length, 4));
        g.setAttribute('aria-hidden', 'true');
        slot.appendChild(g);
      }
      b.appendChild(slot);
      b.appendChild(el('span', 'nm', s.name));
      li.appendChild(b);
      stampsEl.appendChild(li);
      if (s.id === selected) sel = s;
      if (s.id === focusedId) b.focus();
    }
    nStamps.textContent = `${totals.stamps.got} / ${totals.stamps.total}`;
    if (sel) selectStamp(sel);
    else {
      selected = null;
      haikuEl.replaceChildren(el('span', 'hint', totals.stamps.got
        ? 'Touchez un sceau pour relire son poème.'
        : 'Chaque lieu rare de l’île offre son sceau : promenez-vous.'));
    }
  }

  function renderCharms(t) {
    const { got, total } = t.treasures;
    charmsSec.hidden = !(total > 0);
    charmsEl.replaceChildren();
    for (let i = 0; i < total; i++) {
      const li = el('li', i < got ? 'got' : '', '守');
      li.setAttribute('aria-hidden', 'true');
      charmsEl.appendChild(li);
    }
    nCharms.textContent = `${got} / ${total}`;
    noteEl.textContent = total > 0 && got >= total
      ? 'Tous réunis : le shiba porte un foulard rouge.'
      : 'Cachés au pied des arbres et des pierres — le shiba sait les flairer.';
  }

  function renderChallenges(t) {
    chalEl.replaceChildren();
    let secret = false;
    for (const c of t.challenges || []) {
      const count = c.count || 0;
      if (c.hidden && count < 1) { secret = true; continue; }
      // Paliers : uniquement ceux de totals() (tier = dernier atteint, next = suivant).
      const tiers = c.tiers || [];
      const next = c.next;
      const reached = tiers.filter((n) => n <= c.tier).length;
      const li = el('li');
      const sl = seal(c.kanji || '印', { round: true });
      if (!count) sl.classList.add('ghost');
      li.appendChild(sl);
      const txt = el('span');
      txt.appendChild(el('span', 'nm', c.name || c.id));
      txt.appendChild(el('span', 'sub', !count ? 'à tenter, sans hâte'
        : next != null ? `${count} — encore ${next - count} avant le palier des ${next}`
        : `${count} — tous les paliers sont atteints`));
      li.appendChild(txt);
      const pips = el('span', 'j-pips');
      pips.setAttribute('role', 'img');
      pips.setAttribute('aria-label', `${reached} palier${reached > 1 ? 's' : ''} sur ${tiers.length}`);
      for (let i = 0; i < tiers.length; i++) pips.appendChild(el('i', i < reached ? 'on' : ''));
      li.appendChild(pips);
      chalEl.appendChild(li);
    }
    if (secret) {
      const li = el('li', 'secret');
      const sl = seal('？', { round: true });
      sl.classList.add('ghost');
      li.appendChild(sl);
      const txt = el('span');
      txt.appendChild(el('span', 'nm', 'Un défi reste à découvrir'));
      li.appendChild(txt);
      li.appendChild(el('span'));
      chalEl.appendChild(li);
    }
  }

  function refresh() {
    const stamps = quest.stamps();
    const t = quest.totals();
    renderStamps(stamps, t);
    renderCharms(t);
    renderChallenges(t);
    goldEl.hidden = !(goldSeen || (t.stamps.total > 0 && t.stamps.got >= t.stamps.total));
  }

  function isOpen() { return !journalEl.hidden; }

  function openInternal(restore) {
    if (isOpen()) return;
    restoreFocus = restore ? document.activeElement : null;
    refresh();
    journalEl.hidden = false;
    if (openBtn) openBtn.setAttribute('aria-expanded', 'true');
    sheet.focus({ preventScroll: true });
    if (typeof api.onOpenChange === 'function') api.onOpenChange(true);
  }

  function close() {
    if (!isOpen()) return;
    journalEl.hidden = true;
    if (openBtn) openBtn.setAttribute('aria-expanded', 'false');
    const back = restoreFocus;
    restoreFocus = null;
    if (back && back !== document.body && back.isConnected && typeof back.focus === 'function') back.focus({ preventScroll: true });
    else if (document.activeElement && journalEl.contains(document.activeElement)) document.activeElement.blur();
    if (typeof api.onOpenChange === 'function') api.onOpenChange(false);
  }

  const open = () => openInternal(true);
  const toggle = () => (isOpen() ? close() : open());

  function setHidden(h) {
    hidden = !!h;
    toastsEl.hidden = hidden;
    if (hidden) { clearToasts(); close(); }
  }

  /* ── événements DOM ─────────────────────────────────────── */
  const onSheetKey = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      const f = sheet.querySelectorAll('button:not([disabled])');
      if (!f.length) return;
      const first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (e.shiftKey && (a === first || a === sheet)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && a === last) { e.preventDefault(); first.focus(); }
    }
  };
  // Clic dehors : pointerdown ET click doivent viser le voile, pour qu'un
  // glisser de sélection qui finit hors du papier ne ferme pas le carnet.
  let downOnScrim = false;
  const onScrimDown = (e) => { downOnScrim = e.target === journalEl; };
  const onScrimClick = (e) => { if (downOnScrim && e.target === journalEl) close(); downOnScrim = false; };
  const onStampClick = (e) => {
    const b = e.target.closest('button[data-id]');
    if (!b) return;
    const s = quest.stamps().find((x) => x.id === b.dataset.id);
    for (const o of stampsEl.querySelectorAll('button')) o.setAttribute('aria-pressed', String(o === b));
    selectStamp(s);
  };
  // Dans la tête du panneau : ne doit pas replier le panneau en même temps.
  const onOpenBtn = (e) => {
    e.stopPropagation();
    if (isOpen()) close();
    else openInternal(e.detail === 0);   // souris : pas de focus rendu au bouton (Espace = saut)
  };

  toastsEl.hidden = false;
  sheet.addEventListener('keydown', onSheetKey);
  journalEl.addEventListener('pointerdown', onScrimDown);
  journalEl.addEventListener('click', onScrimClick);
  closeBtn.addEventListener('click', close);
  stampsEl.addEventListener('click', onStampClick);
  if (openBtn) openBtn.addEventListener('click', onOpenBtn);

  /* ── abonnement au quest ────────────────────────────────── */
  for (const s of quest.stamps()) if (s.got) seen.add(s.id);
  const offs = [];
  for (const evt of QUEST_EVENTS) {
    const off = quest.on(evt, (p) => {
      if (evt === 'complete' && p && p.kind === 'stamps') goldSeen = true;
      toast(evt, p);
      if (isOpen()) refresh();
    });
    if (typeof off === 'function') offs.push(off);
  }

  // Reset de la progression : oublier ce que la session avait vu (sceau doré,
  // sceau choisi, animation « pressé ») ; le carnet ouvert se redessine.
  if (typeof quest.on === 'function') {
    const off = quest.on('reset', () => {
      goldSeen = false;
      selected = null;
      seen.clear();
      refresh();
    });
    if (typeof off === 'function') offs.push(off);
  }

  function dispose() {
    for (const off of offs) off();
    offs.length = 0;
    clearToasts();
    close();
    sheet.removeEventListener('keydown', onSheetKey);
    journalEl.removeEventListener('pointerdown', onScrimDown);
    journalEl.removeEventListener('click', onScrimClick);
    closeBtn.removeEventListener('click', close);
    stampsEl.removeEventListener('click', onStampClick);
    if (openBtn) openBtn.removeEventListener('click', onOpenBtn);
  }

  // onOpenChange(open) : branché par main.js (suspend le chien carnet ouvert),
  // appelé à chaque ouverture/fermeture, quelle que soit la voie (touche, bouton, voile, H).
  const api = { toast, open, close, toggle, isOpen, refresh, setHidden, dispose, onOpenChange: null };
  return api;
}
