/**
 * fireflies.js — les hotaru des trois étangs.
 *
 * Deux choix portent tout le rendu, et aucun des deux n'est évident :
 *
 *  1. LA SYNCHRONIE EST PAR BASSIN. Les genji-botaru synchronisent réellement
 *     leurs flashes. Tout synchroniser ferait pulser l'île entière d'un bloc —
 *     artificiel ; tout randomiser ferait du bruit. Chaque étang porte sa phase,
 *     chaque individu s'en écarte d'une gigue. Chaque bassin respire ensemble,
 *     les trois sont déphasés entre eux.
 *  2. UN QUART DE LA POPULATION EST POSÉE, immobile, et clignote sur place.
 *     C'est la même réciprocité que petals.js a payée pour le vent : une
 *     population entièrement en vol lit comme un système de particules.
 *
 * Pas de réponse au vent, DÉLIBÉRÉMENT : les hotaru volent par temps calme, et
 * une luciole emportée par une rafale lit faux.
 */

import { FIREFLIES } from './config.js';
import { streamFor, R } from './noise.js';

/**
 * Sème les lucioles sur le champ de densité des bassins.
 *
 * Champ : d(x,z) = max sur les bassins de exp(-densityFalloff * (r / habitat)^2).
 * Échantillonnage par REJET plutôt qu'analytique : le rejet suit automatiquement
 * les trois bassins de tailles très différentes (78 / 46 / 33 u d'habitat) sans
 * avoir à répartir un quota entre eux.
 *
 * Rend MOINS que `count` si le rejet n'aboutit pas dans le budget d'essais.
 * Jamais plus.
 */
export function computeFireflySpots({ ponds, heightAt, isInPond, count, seed = 1 } = {}) {
  const out = [];
  if (!ponds || ponds.length === 0 || !heightAt || !(count > 0)) return out;

  const rng = streamFor(seed, 'fireflies.placement');

  // Rayon d'habitat par bassin, et boîte englobante commune pour tirer dedans.
  const reach = ponds.map((p) => p.radius * FIREFLIES.habitatK);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < ponds.length; i++) {
    minX = Math.min(minX, ponds[i].x - reach[i]); maxX = Math.max(maxX, ponds[i].x + reach[i]);
    minZ = Math.min(minZ, ponds[i].z - reach[i]); maxZ = Math.max(maxZ, ponds[i].z + reach[i]);
  }

  // Budget d'essais borné : sans lui, un champ de densité mal réglé boucle sans
  // fin au lieu de rendre une population maigre qu'on peut voir et corriger.
  const maxTries = count * 40;

  for (let tries = 0; tries < maxTries && out.length < count; tries++) {
    const x = R.range(rng, minX, maxX);
    const z = R.range(rng, minZ, maxZ);

    // Densité, et bassin LE PLUS PROCHE — c'est lui qui portera la phase de
    // flash partagée, donc il doit être le plus proche et pas seulement le plus
    // dense, sinon deux bassins voisins mélangeraient leurs rythmes.
    let dens = 0, pond = -1, bestD2 = Infinity;
    for (let i = 0; i < ponds.length; i++) {
      const dx = x - ponds[i].x, dz = z - ponds[i].z;
      const d2 = dx * dx + dz * dz;
      const u = Math.sqrt(d2) / reach[i];
      // Décroissance calée sur le plancher : à u = 1 elle vaut exactement
      // densityFloor, donc la coupure ci-dessous ne tranche rien de visible.
      // Un exp(-u*u) nu y laisserait encore 37 % de densité, et chaque nuée
      // serait tranchée net en cercle.
      const d = Math.exp(-FIREFLIES.densityFalloff * u * u);
      if (d > dens) dens = d;
      if (d2 < bestD2) { bestD2 = d2; pond = i; }
    }
    if (dens < FIREFLIES.densityFloor) continue;
    if (rng() > dens) continue;

    // L'individu doit rester dans l'habitat du bassin qu'on lui ATTRIBUE, pas
    // seulement dans celui du plus dense : c'est ce que l'invariant 11 vérifie.
    if (Math.sqrt(bestD2) > reach[pond]) continue;

    // Surface locale : plan d'eau au-dessus du bassin, terrain ailleurs.
    const surf = isInPond && isInPond(x, z) ? ponds[pond].waterY : heightAt(x, z);
    const perched = rng() < FIREFLIES.perchedFraction;
    // Les posées se tiennent bas, dans l'herbe ; les volantes occupent la bande.
    const y = perched
      ? surf + FIREFLIES.minHeight
      : surf + R.range(rng, FIREFLIES.minHeight, FIREFLIES.maxHeight);

    out.push({ x, y, z, pond, perched });
  }

  return out;
}
