/**
 * quest.js — noyau pur de la gamification : carnet de tampons (goshuin-chō),
 * omamori cachés, défis animaux à paliers. Ni DOM, ni Three : testable seul
 * (test/quest.html). Persisté sous STORAGE_KEY ; toute panne de stockage
 * (navigation privée, quota, JSON corrompu) retombe sur la mémoire seule.
 *
 * Contrat (le câblage est dans main.js) :
 *   createQuest({ storage, sites, treasureIds }) →
 *     { state, stamps(), totals(), on(evt, fn), report(evt, data), update(x, z), reset() }
 *   événements : 'stamp' | 'treasure' | 'challenge-tier' | 'complete' | 'reset'
 */

export const STORAGE_KEY = 'sakurajima.quest.v1';

const STAMP_RADIUS = 3;
const SEA_TORII_RADIUS = 9;   // le torii est en mer : on le valide depuis la plage

/** Un tampon par site POI (ids = clés de `poi.sites`). */
export const STAMPS = [
  {
    id: 'pine', site: 'pine', kanji: '松', name: 'Pin du rivage — kuromatsu', radius: STAMP_RADIUS,
    haiku: ['Le pin du rivage', 'tordu par les vents salés', 'veille l’horizon'],
  },
  {
    id: 'rock', site: 'rock', kanji: '岩', name: 'Rocher moussu — iwa', radius: STAMP_RADIUS,
    haiku: ['Roche sous la mousse', 'le temps s’est assis, patient', 'rien ne le presse'],
  },
  {
    id: 'jizo', site: 'jizo', kanji: '地蔵', name: 'Jizō du sentier — gardien des voyageurs', radius: STAMP_RADIUS,
    haiku: ['Jizō, bonnet rouge', 'veille les pas des passants', 'chaque pas est béni'],
  },
  {
    id: 'tsukubai', site: 'tsukubai', kanji: '蹲踞', name: 'Tsukubai — la vasque de purification', radius: STAMP_RADIUS,
    haiku: ['Courbé vers la vasque', 'l’eau claire purifie l’âme', 'le bambou chante'],
  },
  {
    id: 'iwakura', site: 'iwakura', kanji: '磐座', name: 'Iwakura — siège de pierre des kami', radius: STAMP_RADIUS,
    haiku: ['Roc des anciens dieux', 'où murmure la source claire', 'silence sacré'],
  },
  {
    id: 'stones', site: 'stones', kanji: '飛石', name: 'Tobi-ishi — les pas de pierre', radius: STAMP_RADIUS,
    haiku: ['Pierre après pierre', 'l’étang retient son souffle', 'pas lents, cœur léger'],
  },
  {
    id: 'seaTorii', site: 'seaTorii', kanji: '鳥居', name: 'Torii dans la mer — la porte des vagues', radius: SEA_TORII_RADIUS,
    haiku: ['Porte dans la mer', 'la marée passe dessous', 'l’aube y entre en or'],
  },
  {
    id: 'chashitsu', site: 'chashitsu', kanji: '茶室', name: 'Chashitsu — le pavillon de thé', radius: STAMP_RADIUS,
    haiku: ['Un bol de thé chaud', 'dans le calme du pavillon', 'l’heure s’étire'],
  },
  {
    id: 'snag', site: 'snag', kanji: '枯木', name: 'Kareki — l’arbre mort', radius: STAMP_RADIUS,
    haiku: ['Arbre sans feuilles', 'les oiseaux s’y posent encore', 'le ciel l’habite'],
  },
];

const TIERS = [1, 5, 15];

/** Défis animaux : compteurs à paliers. `bark` est caché jusqu’à son premier palier. */
export const CHALLENGES = [
  { id: 'heron-flush', name: 'Envol des aosagi', kanji: '鷺', tiers: TIERS },
  { id: 'gull-flush', name: 'Goélands dispersés', kanji: '鴎', tiers: TIERS },
  { id: 'crab-flee', name: 'Crabes en fuite', kanji: '蟹', tiers: TIERS },
  { id: 'bird-flush', name: 'Moineaux effarouchés', kanji: '雀', tiers: TIERS },
  { id: 'butterfly-chase', name: 'Chasse aux chō', kanji: '蝶', tiers: TIERS },
  { id: 'bark', name: 'Ouaf !', kanji: '吠', tiers: TIERS, hidden: true },
];

const REWARD_STAMPS = 'gold-seal';
const REWARD_TREASURES = 'bandana';
const REWARDS = [REWARD_STAMPS, REWARD_TREASURES];
const EVENTS = ['stamp', 'treasure', 'challenge-tier', 'complete', 'reset'];

const STAMP_BY_ID = new Map(STAMPS.map(s => [s.id, s]));
const CHALLENGE_BY_ID = new Map(CHALLENGES.map(c => [c.id, c]));

/** localStorage peut throw dès l’accès (SecurityError) : jamais à nu. */
function defaultStorage() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

/**
 * Point d’un site POI. Les sites sont `{ x, z, … }` (pine, rock, jizo,
 * tsukubai, iwakura, chashitsu, snag, seaTorii) sauf `stones`, un tableau de
 * dalles `{ x, z, y, r }` : on retient la dalle du milieu pour que le rayon
 * couvre la chaîne entière (≈ 8 u de long) et non son seul bout.
 */
function sitePoint(site) {
  if (Array.isArray(site)) site = site.length ? site[site.length >> 1] : null;
  if (!site || !Number.isFinite(site.x) || !Number.isFinite(site.z)) return null;
  return site;
}

export function createQuest({ storage, sites = {}, treasureIds = [] } = {}) {
  if (storage === undefined) storage = defaultStorage();
  const sitesIn = sites || {};

  const state = {
    stamps: new Set(),
    treasures: new Set(),
    counts: {},
    rewards: new Set(),
  };
  for (let i = 0; i < CHALLENGES.length; i++) state.counts[CHALLENGES[i].id] = 0;

  const treasureList = Array.from(new Set(treasureIds || []));
  const treasureKnown = new Set(treasureList);

  /* Tampons présents sur ce tier (site non nul). `got` est tenu à jour. */
  const entries = [];
  for (let i = 0; i < STAMPS.length; i++) {
    const p = sitePoint(sitesIn[STAMPS[i].site]);
    if (!p) continue;
    entries.push({ ...STAMPS[i], x: p.x, z: p.z, r2: STAMPS[i].radius * STAMPS[i].radius, got: false });
  }

  const listeners = new Map(EVENTS.map(e => [e, []]));
  const emit = (evt, payload) => {
    const fns = listeners.get(evt);
    for (let i = 0; i < fns.length; i++) {
      try { fns[i](payload); } catch (e) { /* un écouteur cassé n’arrête personne */ }
    }
  };

  /* ── persistance ── */
  const save = () => {
    if (!storage) return;
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify({
        v: 1,
        stamps: Array.from(state.stamps),
        treasures: Array.from(state.treasures),
        counts: state.counts,
        rewards: Array.from(state.rewards),
      }));
    } catch { /* quota / navigation privée : mémoire seule */ }
  };

  const load = () => {
    if (!storage) return;
    let d;
    try {
      const raw = storage.getItem(STORAGE_KEY);
      if (!raw) return;
      d = JSON.parse(raw);
    } catch { return; }
    if (!d || typeof d !== 'object' || d.v !== 1) return;
    if (Array.isArray(d.stamps)) {
      for (const id of d.stamps) if (STAMP_BY_ID.has(id)) state.stamps.add(id);
    }
    if (Array.isArray(d.treasures)) {
      for (const id of d.treasures) if (typeof id === 'string') state.treasures.add(id);
    }
    if (d.counts && typeof d.counts === 'object' && !Array.isArray(d.counts)) {
      for (let i = 0; i < CHALLENGES.length; i++) {
        const n = d.counts[CHALLENGES[i].id];
        if (Number.isFinite(n) && n > 0) state.counts[CHALLENGES[i].id] = Math.floor(n);
      }
    }
    if (Array.isArray(d.rewards)) {
      for (const r of d.rewards) if (REWARDS.includes(r)) state.rewards.add(r);
    }
  };

  const syncGot = () => {
    for (let i = 0; i < entries.length; i++) entries[i].got = state.stamps.has(entries[i].id);
  };

  /* Un site absent à ce tier garde son tampon sauvegardé (compté hors total). */
  const stampsGot = () => {
    let n = 0;
    for (let i = 0; i < entries.length; i++) if (entries[i].got) n++;
    return n;
  };
  const treasuresGot = () => {
    let n = 0;
    for (let i = 0; i < treasureList.length; i++) if (state.treasures.has(treasureList[i])) n++;
    return n;
  };

  /* Émet `complete` une seule fois par catégorie (la récompense fait foi). */
  const checkComplete = (kind) => {
    const reward = kind === 'stamps' ? REWARD_STAMPS : REWARD_TREASURES;
    if (state.rewards.has(reward)) return;
    const got = kind === 'stamps' ? stampsGot() : treasuresGot();
    const total = kind === 'stamps' ? entries.length : treasureList.length;
    if (total === 0 || got < total) return;
    state.rewards.add(reward);
    save();
    emit('complete', { kind, reward });
  };

  load();
  syncGot();
  /* Une sauvegarde déjà complète mais sans récompense (écrite avant le câblage,
   * ou récompense perdue) la reçoit au chargement. Aucun écouteur encore : pas de toast. */
  checkComplete('stamps');
  checkComplete('treasures');

  const challengeRow = (c) => {
    const count = state.counts[c.id];
    let tier = 0, next = null;
    for (let i = 0; i < c.tiers.length; i++) {
      if (count >= c.tiers[i]) tier = c.tiers[i];
      else if (next === null) next = c.tiers[i];
    }
    return { id: c.id, name: c.name, kanji: c.kanji, count, tier, next, tiers: c.tiers, hidden: !!c.hidden };
  };

  return {
    state,

    /** Tampons des sites présents, avec .x .z .got (tableau stable, tenu à jour). */
    stamps() { return entries; },

    /** Défis : `name`/`kanji` viennent de CHALLENGES (source unique). `tier` = dernier palier atteint (0 si aucun), `next` = palier suivant ou null, `tiers` = tous les paliers (partagé, ne pas modifier). */
    totals() {
      return {
        stamps: { got: stampsGot(), total: entries.length },
        treasures: { got: treasuresGot(), total: treasureList.length },
        challenges: CHALLENGES.map(challengeRow),
      };
    },

    on(evt, fn) {
      const fns = listeners.get(evt);
      if (!fns || typeof fn !== 'function') return () => {};
      fns.push(fn);
      return () => {
        const i = fns.indexOf(fn);
        if (i >= 0) fns.splice(i, 1);
      };
    },

    /** `report('treasure', { id })` ramasse un omamori ; sinon `evt` = id d’un défi (+1). */
    report(evt, data) {
      if (evt === 'treasure') {
        const id = data && data.id;
        if (!treasureKnown.has(id) || state.treasures.has(id)) return;
        state.treasures.add(id);
        save();
        emit('treasure', { id, got: treasuresGot(), total: treasureList.length });
        checkComplete('treasures');
        return;
      }
      const c = CHALLENGE_BY_ID.get(evt);
      if (!c) return;
      const count = ++state.counts[c.id];
      save();
      if (c.tiers.includes(count)) {
        emit('challenge-tier', { id: c.id, name: c.name, kanji: c.kanji, tier: count, count });
      }
    },

    /** Proximité des tampons. Appelé chaque frame : aucune allocation. */
    update(x, z) {
      for (let i = 0; i < entries.length; i++) {
        const e = entries[i];
        if (e.got) continue;
        const dx = x - e.x, dz = z - e.z;
        if (dx * dx + dz * dz > e.r2) continue;
        e.got = true;
        state.stamps.add(e.id);
        save();
        emit('stamp', { id: e.id, kanji: e.kanji, name: e.name, haiku: e.haiku });
        checkComplete('stamps');
      }
    },

    reset() {
      state.stamps.clear();
      state.treasures.clear();
      state.rewards.clear();
      for (let i = 0; i < CHALLENGES.length; i++) state.counts[CHALLENGES[i].id] = 0;
      syncGot();
      if (storage) {
        try { storage.removeItem(STORAGE_KEY); } catch { /* idem */ }
      }
      emit('reset');
    },
  };
}
