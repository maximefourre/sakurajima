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

import * as THREE from 'three';
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

    // Surface locale, prise sur TOUTE L'ENVELOPPE DE DÉRIVE et non au seul
    // point semé — ADV-2026-08-01-FIREFLY. Le shader promène l'individu jusqu'à
    // driftRadius[1] horizontalement ; sur une berge en pente, une garde
    // calculée au centre ne dit rien du sol qu'il survolera.
    //
    // Le MAX sur huit azimuts plus le centre : on veut le point le plus HAUT,
    // c'est lui qui contraint. Et le max avec le plan d'eau règle au passage
    // le second défaut signalé — `isInPond` inclut la marge humide des berges,
    // donc il pouvait renvoyer waterY pour un individu posé sur du sec.
    const R_ENV = FIREFLIES.driftRadius[1];
    let surf = heightAt(x, z);
    for (let a = 0; a < 8; a++) {
      const th = (a / 8) * Math.PI * 2;
      surf = Math.max(surf, heightAt(x + Math.cos(th) * R_ENV, z + Math.sin(th) * R_ENV));
    }
    if (isInPond && isInPond(x, z)) surf = Math.max(surf, ponds[pond].waterY);
    const perched = rng() < FIREFLIES.perchedFraction;
    // Les posées se tiennent bas, dans l'herbe ; les volantes occupent la bande.
    const y = perched
      ? surf + FIREFLIES.minHeight
      : surf + R.range(rng, FIREFLIES.minHeight, FIREFLIES.maxHeight);

    out.push({ x, y, z, pond, perched });
  }

  return out;
}

/**
 * Quelle part de la population brille, entre 0 et 1.
 *
 * Un PIC, pas un plateau : les vraies hotaru culminent dans les deux heures qui
 * suivent le coucher, puis retombent. `phase.solar` est cyclique — d'ou la
 * distance circulaire, sans quoi minuit (solar 0) serait vu comme tres loin du
 * pic (solar 0.82) alors qu'il n'en est qu'a 0.18.
 *
 * Exportee parce que l'invariant 12 du banc l'importe et la teste directement :
 * une copie de la formule dans le test deriverait en silence.
 */
export function fireflyActivity(phase) {
  if (!phase) return 0;
  // Allumees la nuit et sur les deux crepuscules, comme les lanternes.
  const lit = Math.max(0, Math.min(1, (phase.night ?? 0) + (phase.twilight ?? 0) * 0.6));
  if (lit <= 0) return 0;
  let d = Math.abs((phase.solar ?? 0) - FIREFLIES.peakSolar);
  if (d > 0.5) d = 1 - d;
  const peak = Math.exp(-(d * d) / (FIREFLIES.peakWidth * FIREFLIES.peakWidth));
  return lit * (FIREFLIES.peakFloor + (1 - FIREFLIES.peakFloor) * peak);
}

/**
 * Construit la population. Tout est fixe ici : le mesh n'est jamais reconstruit,
 * conformement a la doctrine « changement de qualite = reload » d'AGENTS.md.
 */
export function createFireflies({ seed = 1, quality, heightAt, ponds, isInPond } = {}) {
  const count = quality?.fireflies ?? 0;
  const spots = computeFireflySpots({ ponds, heightAt, isInPond, count, seed });
  const n = spots.length;

  const geo = new THREE.InstancedBufferGeometry();
  {
    // Quad unite ecrit a la main plutot qu'emprunte a une PlaneGeometry : passer
    // les attributs d'une geometrie temporaire PUIS la disposer ferait supprimer
    // des buffers GPU partages le jour ou l'ordre de construction changerait.
    // position.xy court dans [-0.5, 0.5] — le vertex shader en depend.
    geo.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.5, -0.5, 0,   0.5, -0.5, 0,   0.5, 0.5, 0,   -0.5, 0.5, 0,
    ], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
  }

  const aPos   = new Float32Array(n * 3);  // position monde de l'individu
  const aSeed  = new Float32Array(n * 4);  // phase, driftRate, driftRadius, size
  const aFlash = new Float32Array(n * 3);  // decalage de phase, posee 0/1, periode propre
  const aGlow  = new Float32Array(n * 2);  // eclat individuel, multiplicateur de decroissance

  // Phase de flash PAR BASSIN — le coeur du rendu. Decorrelees par un decalage
  // irrationnel plutot qu'un tirage : trois bassins tires au hasard peuvent
  // sortir presque en phase, ce qui ruine l'effet une fois sur dix.
  const pondPhase = ponds.map((_, i) => i * 0.618034 * FIREFLIES.flashPeriod);

  const rng = streamFor(seed, 'fireflies.attrs');
  for (let i = 0; i < n; i++) {
    const s = spots[i];
    aPos[i * 3] = s.x; aPos[i * 3 + 1] = s.y; aPos[i * 3 + 2] = s.z;

    aSeed[i * 4]     = R.range(rng, 0, Math.PI * 2);
    aSeed[i * 4 + 1] = R.range(rng, FIREFLIES.driftRate[0], FIREFLIES.driftRate[1]);
    aSeed[i * 4 + 2] = R.range(rng, FIREFLIES.driftRadius[0], FIREFLIES.driftRadius[1]);
    aSeed[i * 4 + 3] = R.range(rng, FIREFLIES.size[0], FIREFLIES.size[1]);

    // Une minorite de SOLITAIRES bat a sa propre periode, hors du choeur de son
    // bassin. Sans eux la population entiere partage une seule frequence et lit
    // comme une horloge ; avec eux, le choeur reste lisible et l'ensemble respire.
    const lone = rng() < FIREFLIES.loneFraction;
    aFlash[i * 3]     = lone
      ? R.range(rng, 0, FIREFLIES.flashPeriod * 2)
      : pondPhase[s.pond] + R.range(rng, -FIREFLIES.flashJitter, FIREFLIES.flashJitter);
    aFlash[i * 3 + 1] = s.perched ? 1 : 0;
    aFlash[i * 3 + 2] = lone
      ? R.range(rng, FIREFLIES.lonePeriod[0], FIREFLIES.lonePeriod[1])
      : FIREFLIES.flashPeriod;

    // Eclat et duree de flash propres. C'est ce qui empeche les flashes d'avoir
    // tous l'air tamponnes depuis le meme gabarit, meme quand ils sont synchrones.
    aGlow[i * 2]     = R.range(rng, FIREFLIES.brightness[0], FIREFLIES.brightness[1]);
    aGlow[i * 2 + 1] = R.range(rng, FIREFLIES.decayJitter[0], FIREFLIES.decayJitter[1]);
  }

  geo.setAttribute('aPos',   new THREE.InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aSeed',  new THREE.InstancedBufferAttribute(aSeed, 4));
  geo.setAttribute('aFlash', new THREE.InstancedBufferAttribute(aFlash, 3));
  geo.setAttribute('aGlow',  new THREE.InstancedBufferAttribute(aGlow, 2));
  geo.instanceCount = n;

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uTime:      { value: 0 },
      uActivity:  { value: 0 },
      // Plus de uPeriod global : la periode est passee PAR INSTANCE (aFlash.z).
      // C'etait la cause du "toutes a la meme frequence".
      uColor:     { value: new THREE.Color(FIREFLIES.color) },
      uOverdrive: { value: FIREFLIES.overdrive },
      uLift:      { value: FIREFLIES.driftLift },
      uRise:      { value: FIREFLIES.flashRise },
      uDecay:     { value: FIREFLIES.flashDecay },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,

    vertexShader: /* glsl */ `
      attribute vec3  aPos;
      attribute vec4  aSeed;
      attribute vec3  aFlash;   // decalage de phase, posee (0/1), PERIODE PROPRE
      attribute vec2  aGlow;    // eclat individuel, multiplicateur de decroissance

      uniform float uTime;
      uniform float uActivity;
      uniform float uLift;
      uniform float uRise;
      uniform float uDecay;

      varying float vGlow;
      varying vec2  vQuad;

      #include <fog_pars_vertex>

      void main() {
        float phase  = aSeed.x;
        float rate   = aSeed.y;
        float radius = aSeed.z;
        float size   = aSeed.w;

        // Les posees ne derivent pas : elles clignotent sur place dans l'herbe.
        float airborne = 1.0 - aFlash.y;

        vec3 p = aPos;
        p.x += airborne * radius * sin(uTime * rate + phase);
        p.z += airborne * radius * 0.82 * sin(uTime * rate * 0.71 + phase * 1.7);
        // Quasi horizontal : une hotaru traine, elle ne monte pas.
        //
        // ADV-2026-08-01-FIREFLY : la derive verticale etait CENTREE, donc elle
        // descendait autant qu'elle montait — jusqu'a 2.6 x 0.18 = 0.468 u,
        // contre une garde minimale au semis de 0.40. Une luciole passait sous
        // la surface, et l'invariant restait vert parce qu'il ne teste que la
        // position SEMEE. Rendue UNILATERALE : la position semee devient un
        // plancher, l'individu ne fait plus que monter au-dessus.
        p.y += airborne * radius * uLift * (0.5 + 0.5 * sin(uTime * rate * 0.53 + phase * 2.3));

        // Le flash. Montee rapide puis decroissance exponentielle, PAS un sinus :
        // un sinus donne une respiration douce, une luciole fait un eclair.
        // La PERIODE est desormais par instance : le choeur du bassin garde la
        // periode commune (c'est le comportement reel des genji-botaru, et des
        // periodes toutes differentes le dissoudraient en quelques dizaines de
        // secondes), mais une minorite de solitaires bat a son propre rythme.
        float u = fract((uTime + aFlash.x) / aFlash.z);
        float rise  = smoothstep(0.0, uRise, u);
        // Decroissance propre : sans elle tous les flashes ont la meme duree et
        // paraissent tamponnes depuis un seul gabarit, meme bien dephases.
        float decay = exp(-max(u - uRise, 0.0) * uDecay * aGlow.y);
        // Eclat propre. C'est ce que l'oeil lit en premier comme "des individus"
        // plutot que "une population".
        vGlow = rise * decay * uActivity * aGlow.x;

        // -1..1 pour la gaussienne du fragment (position.xy court dans -0.5..0.5)
        vQuad = position.xy * 2.0;

        // Le nom mvPosition est OBLIGATOIRE : fog_vertex le lit litteralement.
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        // Billboard : le decalage se fait en espace vue, donc le quad fait
        // toujours face a la camera sans qu'on ait a composer une rotation.
        mvPosition.xy += position.xy * size;
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uColor;
      uniform float uOverdrive;

      varying float vGlow;
      varying vec2  vQuad;

      #include <fog_pars_fragment>

      void main() {
        float r2 = dot(vQuad, vQuad);
        if (r2 > 1.0) discard;

        // exp(-k r^2) et non un smoothstep : le tier low n'a PAS de bloom
        // (QUALITY.low.bloom === false, donc pas de composer), et un bord franc
        // y lirait comme une pastille au lieu d'une lumiere. Le halo du bloom
        // vient par-dessus quand il existe, il ne le remplace pas.
        float core = exp(-r2 * 7.0);

        vec3 col = uColor * core * vGlow * uOverdrive;

        // Brouillard ADDITIF : on ATTENUE, on ne melange pas vers fogColor.
        // Le chunk fog_fragment standard fait mix(rgb, fogColor, f), ce qui
        // AJOUTERAIT du brouillard sur un materiau additif : une luciole
        // lointaine deviendrait plus brillante que de pres.
        #ifdef USE_FOG
          #ifdef FOG_EXP2
            float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          #else
            float fogF = smoothstep(fogNear, fogFar, vFogDepth);
          #endif
          col *= 1.0 - clamp(fogF, 0.0, 1.0);
        #endif

        gl_FragColor = vec4(col, 1.0);
      }
    `,
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.name = 'fireflies';
  mesh.renderOrder = 6;
  mesh.visible = false;
  mesh.castShadow = false;
  mesh.receiveShadow = false;

  // SPHERE ENGLOBANTE OBLIGATOIRE, ET PAS UNE OPTIMISATION.
  // La geometrie ne contient qu'un quad unite a l'origine : le calcul
  // automatique de three ne voit QUE `position` et rendrait une sphere de rayon
  // 0.7 au centre du monde. Les positions reelles vivent dans `aPos`, que le
  // culling ignore — les lucioles disparaitraient des qu'on ne regarde pas
  // l'origine de la carte. On la pose donc a la main.
  {
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < n; i++) { cx += aPos[i * 3]; cy += aPos[i * 3 + 1]; cz += aPos[i * 3 + 2]; }
    const inv = 1 / Math.max(n, 1);
    cx *= inv; cy *= inv; cz *= inv;
    let r = 0;
    for (let i = 0; i < n; i++) {
      r = Math.max(r, Math.hypot(aPos[i * 3] - cx, aPos[i * 3 + 1] - cy, aPos[i * 3 + 2] - cz));
    }
    // Marge = derive maximale + demi-quad : la sphere doit couvrir la position
    // ANIMEE, pas la position semee, sinon les bords disparaissent par a-coups.
    // ADV-2026-08-01-FIREFLY : la marge valait driftRadius + size, en oubliant
    // que les trois axes derivent SIMULTANEMENT. Les amplitudes sont 1, 0.82 et
    // uLift fois le rayon, donc la borne est leur norme euclidienne — 3.395 u
    // et non 2.80. Il manquait 0.595 u, et le mesh entier pouvait etre culled
    // en bord de frustum alors que des individus etaient encore visibles.
    const AX = 1, AZ = 0.82, AY = FIREFLIES.driftLift;
    const enveloppe = FIREFLIES.driftRadius[1] * Math.sqrt(AX * AX + AZ * AZ + AY * AY);
    geo.boundingSphere = new THREE.Sphere(
      new THREE.Vector3(cx, cy, cz),
      // Demi-diagonale du quad, pas son demi-cote : il est billboarde.
      r + enveloppe + FIREFLIES.size[1] * Math.SQRT2
    );
  }

  /**
   * Deux uniformes par frame, rien d'autre. `phase` vient de sky.update().
   */
  function update(t, phase) {
    if (!phase) return;
    const activity = fireflyActivity(phase);
    mesh.visible = activity > 0.01;
    if (!mesh.visible) return;
    uniforms.uTime.value = t;
    uniforms.uActivity.value = activity;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
  }

  return { mesh, update, dispose };
}
