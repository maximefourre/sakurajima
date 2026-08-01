/**
 * butterflies.js — le versant DIURNE de la faune, dont fireflies.js est le nocturne.
 *
 * Ce fichier ne contient pour l'instant que les deux fonctions PURES : le semis
 * et la courbe d'activité. Le mesh, le shader et la machine à états arrivent
 * ensuite. Les deux invariants du banc ne dépendent que de ces deux fonctions —
 * c'est pour ça qu'elles sont séparées et exportées.
 *
 * Deux espèces, parce qu'une seule lit comme un clone dupliqué : la petite
 * (Pieris rapae au printemps, Vanessa indica à l'automne) et le machaon
 * asiatique (Papilio xuthus), plus grand, plus rapide et volant plus haut.
 */

import { BUTTERFLIES } from './config.js';
import { streamFor, R } from './noise.js';

/**
 * Sème les papillons sur les fleurs réellement posées.
 *
 * Chaque individu est ANCRÉ sur une fleur précise, dont il garde l'index : c'est
 * cette fleur qui sert de centre à son domaine de vol. Le domaine est individuel
 * et non global — le champ de fleurs fait 633 x 637 unités, un rappel vers son
 * barycentre ramènerait toute la population au centre et viderait la périphérie.
 * C'est aussi le comportement réel : les Pieris explorent leur « natal patch ».
 *
 * Le papillon est posé EXACTEMENT à la verticale de sa fleur (le banc le vérifie
 * à 1e-3) et à une hauteur tirée dans la bande de croisière de SON espèce.
 */
export function computeButterflySpawns({ flowerSpots, heightAt, count, seed = 1 } = {}) {
  const out = [];
  const nf = flowerSpots ? flowerSpots.length / 3 : 0;
  if (!nf || !heightAt || !(count > 0)) return out;

  const rng = streamFor(seed, 'butterflies.spawn');
  const n = Math.min(count, nf);

  // Indices distincts : deux papillons éclos sur la même fleur se
  // superposeraient exactement au premier rendu, ce qui se voit.
  const pris = new Set();
  let essais = 0;
  const maxEssais = n * 40;

  while (out.length < n && essais < maxEssais) {
    essais++;
    const fi = Math.min(nf - 1, Math.floor(rng() * nf));
    if (pris.has(fi)) continue;
    pris.add(fi);

    const x = flowerSpots[fi * 3];
    const z = flowerSpots[fi * 3 + 2];
    const big = rng() < BUTTERFLIES.bigFraction;
    const band = big ? BUTTERFLIES.big.cruiseY : BUTTERFLIES.small.cruiseY;
    const y = heightAt(x, z) + R.range(rng, band[0], band[1]);

    out.push({ x, y, z, big, flowerIndex: fi });
  }

  return out;
}

/**
 * Quelle part de la population vole, entre 0 et 1.
 *
 * Miroir exact de `fireflyActivity` : les deux se relaient sur le même objet
 * `phase`, sans avoir à se connaître. Les papillons volent en plein jour et
 * s'attardent une fraction du crépuscule, puis se posent et s'effacent.
 *
 * Exportée parce que le banc l'importe et la teste directement : une copie de la
 * formule dans le test dériverait en silence le jour où on la retouche.
 */
export function butterflyActivity(phase) {
  if (!phase) return 0;
  const v = (phase.day ?? 0) + (phase.twilight ?? 0) * BUTTERFLIES.duskFade;
  return Math.max(0, Math.min(1, v));
}
