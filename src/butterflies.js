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

import * as THREE from 'three';
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

/* ────────────────────────────────────────────────────────────────
   Le vivant : géométrie, shader, machine à états
   ──────────────────────────────────────────────────────────────── */

const WANDER = 0, APPROACH = 1, PERCHED = 2, FLEE = 3;
const TAU = Math.PI * 2;

/**
 * Deux quads horizontaux, une aile de chaque côté. Pas de corps modélisé : à
 * trois centimètres il ne lirait pas, et il coûterait la moitié des triangles.
 *
 * Les ailes sont dans le plan XZ (normale +Y), PAS dans le plan XY. C'est ce qui
 * permet au battement — une rotation autour de l'axe du corps — de faire tourner
 * la NORMALE et donc de faire accrocher la lumière différemment à chaque coup
 * d'aile. Des ailes verticales tourneraient dans leur propre plan et resteraient
 * éclairées à l'identique : le scintillement, qui est tout le tell, disparaîtrait.
 *
 * Le SIGNE de position.x distingue les deux ailes dans le shader. Structurel.
 */
function makeWingGeometry() {
  const g = new THREE.BufferGeometry();
  // CORDE PLUS COURTE QUE L'ENVERGURE (0.84 contre 1.0). Un premier jet à corde
  // 1.0 donnait des losanges deux fois plus profonds que larges : à l'écran ça
  // lisait comme une pastille, pas comme un papillon. Une aile de papillon est
  // large et peu profonde, c'est ce qui fait la silhouette.
  g.setAttribute('position', new THREE.Float32BufferAttribute([
    // aile droite
    0, 0, -0.42,   0.5, 0, -0.42,   0.5, 0, 0.42,   0, 0, 0.42,
    // aile gauche
    -0.5, 0, -0.42,   0, 0, -0.42,   0, 0, 0.42,   -0.5, 0, 0.42,
  ], 3));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7]);
  return g;
}

/** Palettes par saison. L'automne échange la blanche contre le tateha roux. */
function paletteFor(season) {
  const autumn = season === 'autumn';
  return {
    // Vanessa indica (akatateha) à l'automne, Pieris rapae au printemps.
    small:     new THREE.Color(autumn ? 0xc8562a : 0xf6f2e4),
    smallEdge: new THREE.Color(autumn ? 0x35210f : 0x6b6455),
    // Papilio xuthus toute l'année : jaune nervuré de noir.
    big:       new THREE.Color(0xf2d64b),
    bigEdge:   new THREE.Color(0x201c14),
  };
}

/**
 * Construit la population. Machine à états sur le CPU (N <= 136, c'est
 * dérisoire), battement d'ailes sur le GPU.
 */
export function createButterflies({
  seed = 1, quality, season = 'spring', heightAt, flowerSpots,
} = {}) {
  const count = quality?.butterflies ?? 0;
  const spawns = computeButterflySpawns({ flowerSpots, heightAt, count, seed });
  const n = spawns.length;
  const pal = paletteFor(season);

  const geo = makeWingGeometry();
  const aFlap    = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const aSpecies = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  const aPerch   = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
  geo.setAttribute('aFlap', aFlap);
  geo.setAttribute('aSpecies', aSpecies);
  geo.setAttribute('aPerch', aPerch);

  const uniforms = THREE.UniformsUtils.merge([
    THREE.UniformsLib.fog,
    {
      uSunDir:    { value: new THREE.Vector3(0, 1, 0) },
      uSunColor:  { value: new THREE.Color(1, 1, 1) },
      uAmbient:   { value: new THREE.Color(0.35, 0.38, 0.45) },
      uOpacity:   { value: 1 },
      uColSmall:  { value: pal.small },
      uEdgeSmall: { value: pal.smallEdge },
      uColBig:    { value: pal.big },
      uEdgeBig:   { value: pal.bigEdge },
    },
  ]);

  const material = new THREE.ShaderMaterial({
    uniforms,
    fog: true,
    transparent: true,
    depthWrite: true,
    // Piege 1 d'AGENTS.md : une aile se voit des DEUX cotes, et une strip
    // enroulee vers le bas sur un FrontSide ne rend RIEN, silencieusement.
    side: THREE.DoubleSide,

    vertexShader: /* glsl */ `
      attribute float aFlap;
      attribute float aSpecies;
      attribute float aPerch;

      varying vec2  vWing;
      varying float vSpecies;
      varying vec3  vNormalW;

      #include <fog_pars_vertex>

      void main() {
        vSpecies = aSpecies;
        // Coordonnees locales d'aile : x spanwise (0 au corps, 1 au bout),
        // z chordwise (-1 arriere, +1 avant).
        vWing = vec2(abs(position.x) * 2.0, position.z / 0.42);

        // Pose : les ailes s'ouvrent et se ferment tres lentement, elles ne
        // s'immobilisent pas. Un papillon pose garde un frisson.
        float amp = mix(1.05, 0.30, aPerch);
        float a = sin(aFlap) * amp;
        float s = sign(position.x);
        float ca = cos(s * a), sa = sin(s * a);

        // Rotation autour de l'axe du CORPS : le bout d'aile monte en Y.
        vec3 p = vec3(position.x * ca - position.y * sa,
                      position.x * sa + position.y * ca,
                      position.z);
        // La normale subit la MEME rotation — c'est elle qui fait scintiller
        // l'aile a chaque coup, et c'est tout l'interet d'ailes horizontales.
        vec3 nrm = vec3(-sa, ca, 0.0);

        vNormalW = normalize(mat3(instanceMatrix) * nrm);

        // Le nom mvPosition est OBLIGATOIRE : fog_vertex le lit litteralement.
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;

        #include <fog_vertex>
      }
    `,

    fragmentShader: /* glsl */ `
      uniform vec3  uSunDir;
      uniform vec3  uSunColor;
      uniform vec3  uAmbient;
      uniform float uOpacity;
      uniform vec3  uColSmall;
      uniform vec3  uEdgeSmall;
      uniform vec3  uColBig;
      uniform vec3  uEdgeBig;

      varying vec2  vWing;
      varying float vSpecies;
      varying vec3  vNormalW;

      #include <fog_pars_fragment>

      // Silhouette analytique, comme sakuraAlpha dans petals.js : ce projet
      // genere ses formes, il ne charge pas de textures. Deux lobes — aile
      // anterieure et posterieure — plus une queue pour le machaon.
      float blob(vec2 p, vec2 c, vec2 r) {
        vec2 d = (p - c) / r;
        return 1.0 - dot(d, d);
      }

      void main() {
        vec2 w = vWing;
        // Aile anterieure : large, poussee vers l'avant et vers le bout.
        float fore = blob(w, vec2(0.46, 0.30), vec2(0.60, 0.56));
        // Aile posterieure : plus petite, plus proche du corps.
        float hind = blob(w, vec2(0.30, -0.34), vec2(0.42, 0.40));
        float shape = max(fore, hind);
        // L'ECHANCRURE entre les deux ailes, au bord de fuite. Sans elle les deux
        // lobes fusionnent et l'insecte lit comme une pastille : c'est ce creux
        // qui dit "papillon" avant meme qu'on distingue la couleur.
        shape = min(shape, 1.0 - blob(w, vec2(0.72, -0.30), vec2(0.30, 0.26)) * 1.6);
        if (vSpecies > 0.5) {
          // La queue du machaon : c'est elle qui le nomme.
          shape = max(shape, blob(w, vec2(0.26, -0.92), vec2(0.09, 0.34)));
        }
        if (shape < 0.0) discard;

        vec3 base = vSpecies > 0.5 ? uColBig : uColSmall;
        vec3 edge = vSpecies > 0.5 ? uEdgeBig : uEdgeSmall;
        // Bord d'aile assombri : sans lui les deux especes lisent comme deux
        // taches plates de couleurs differentes.
        base = mix(edge, base, smoothstep(0.0, 0.30, shape));
        // LE CORPS : une bande sombre le long de l'axe. C'est elle qui SEPARE les
        // deux ailes ; sans elle la paire fusionne en un seul lobe symetrique et
        // on ne lit plus un insecte mais un petale.
        base = mix(edge * 0.7, base, smoothstep(0.05, 0.17, w.x));

        vec3 nn = normalize(vNormalW);
        // Eclairage enroule, comme petals.js : une aile est translucide, elle
        // s'allume aussi quand le soleil est DERRIERE elle.
        float wrap  = dot(nn, uSunDir) * 0.5 + 0.5;
        float trans = pow(max(dot(-nn, uSunDir), 0.0), 2.0);
        vec3 col = base * (uAmbient + uSunColor * (wrap * 0.72 + trans * 0.45));

        gl_FragColor = vec4(col, uOpacity);

        #include <fog_fragment>
      }
    `,
  });

  const mesh = new THREE.InstancedMesh(geo, material, Math.max(n, 1));
  mesh.name = 'butterflies';
  mesh.count = n;
  mesh.castShadow = false;   // 3 cm d'aile ne projettent rien de lisible
  mesh.receiveShadow = false;
  mesh.visible = false;
  // Les matrices bougent a chaque frame : recalculer une sphere englobante par
  // frame couterait plus que le culling ne rapporte.
  mesh.frustumCulled = false;

  /* ── état CPU ─────────────────────────────────────────────────── */

  const rng = streamFor(seed, 'butterflies.sim');
  const bugs = spawns.map((s) => {
    const spec = s.big ? BUTTERFLIES.big : BUTTERFLIES.small;
    return {
      x: s.x, y: s.y, z: s.z,
      anchorX: s.x, anchorZ: s.z,
      big: s.big,
      heading: rng() * TAU,
      speed: R.range(rng, spec.speed[0], spec.speed[1]),
      cruise: s.y - heightAt(s.x, s.z),
      flapPhase: rng() * TAU,
      flapRate: R.range(rng, spec.flapRate[0], spec.flapRate[1]),
      glide: 0,
      state: WANDER,
      timer: R.range(rng, 0.5, 3.0),
      target: s.flowerIndex,
    };
  });

  for (let i = 0; i < n; i++) aSpecies.array[i] = bugs[i].big ? 1 : 0;
  aSpecies.needsUpdate = true;

  const _m = new THREE.Matrix4();
  const _q = new THREE.Quaternion();
  const _e = new THREE.Euler();
  const _p = new THREE.Vector3();
  const _s = new THREE.Vector3();
  const repeller = new THREE.Vector3(0, -1e6, 0);
  let hasRepeller = false;

  function setRepeller(p) {
    if (!p) return;
    repeller.copy(p);
    hasRepeller = true;
  }

  const nFlowers = flowerSpots ? flowerSpots.length / 3 : 0;

  /** Une fleur au hasard dans le rayon de recherche, ou -1. */
  function pickFlower(b) {
    if (!nFlowers) return -1;
    for (let k = 0; k < 8; k++) {
      const fi = Math.min(nFlowers - 1, Math.floor(rng() * nFlowers));
      const dx = flowerSpots[fi * 3] - b.x, dz = flowerSpots[fi * 3 + 2] - b.z;
      if (dx * dx + dz * dz < BUTTERFLIES.approachRadius * BUTTERFLIES.approachRadius) return fi;
    }
    return -1;
  }

  function update(t, dt, phase) {
    const activity = butterflyActivity(phase);
    mesh.visible = activity > 0.01 && n > 0;
    if (!mesh.visible) return;

    // Ils s'effacent POSÉS au crépuscule : l'opacité suit l'activité, et sous un
    // seuil ils cessent d'errer. Version bon marché du roost de birds.js.
    uniforms.uOpacity.value = Math.min(1, activity * 1.4);
    const sleepy = activity < 0.45;

    if (phase) {
      const dir = phase.keyDir || phase.sunDirection;
      const col = phase.keyColor || phase.sunColor;
      if (dir) uniforms.uSunDir.value.copy(dir);
      if (col) {
        // keyIntensity est DÉJÀ normalisé par main.js (shaderPhase) — ne pas
        // réappliquer de facteur, sous peine de brûler les ailes en blanc.
        const k = phase.keyIntensity ?? 1;
        uniforms.uSunColor.value.setRGB(col.r * k, col.g * k, col.b * k);
      }
      if (phase.skyColor) uniforms.uAmbient.value.copy(phase.skyColor).multiplyScalar(phase.ambient ?? 0.4);
    }

    const step = Math.min(dt, 0.05);   // un onglet qui reprend ne doit pas téléporter

    for (let i = 0; i < n; i++) {
      const b = bugs[i];
      const spec = b.big ? BUTTERFLIES.big : BUTTERFLIES.small;
      b.timer -= step;

      // — fuite : elle prime sur tout —
      if (hasRepeller && b.state !== FLEE) {
        const dx = b.x - repeller.x, dz = b.z - repeller.z;
        if (dx * dx + dz * dz < BUTTERFLIES.fleeRadius * BUTTERFLIES.fleeRadius) {
          b.state = FLEE;
          b.timer = R.range(rng, BUTTERFLIES.fleeSeconds[0], BUTTERFLIES.fleeSeconds[1]);
          b.heading = Math.atan2(dz, dx);
        }
      }

      let wantY = b.cruise;
      let speed = b.speed;

      if (b.state === FLEE) {
        speed = BUTTERFLIES.fleeSpeed;
        wantY = b.cruise + 2.2;                 // il DÉCOLLE, il ne s'éloigne pas à plat
        if (b.timer <= 0) { b.state = WANDER; b.timer = R.range(rng, 1.5, 4.0); }
      } else if (b.state === PERCHED) {
        speed = 0;
        wantY = 0.06;
        if (b.timer <= 0 && !sleepy) { b.state = WANDER; b.timer = R.range(rng, 2.0, 6.0); }
      } else if (b.state === APPROACH) {
        const fi = b.target;
        const fx = flowerSpots[fi * 3], fz = flowerSpots[fi * 3 + 2];
        const dx = fx - b.x, dz = fz - b.z;
        const d = Math.hypot(dx, dz);
        b.heading = Math.atan2(dz, dx);
        wantY = Math.min(b.cruise, 0.10 + d * 0.25);
        speed = b.speed * 0.75;
        if (d < BUTTERFLIES.arriveDist) {
          b.state = PERCHED;
          b.x = fx; b.z = fz;
          b.timer = R.range(rng, BUTTERFLIES.perchSeconds[0], BUTTERFLIES.perchSeconds[1]);
        }
      } else {
        // — WANDER —
        // Marche aléatoire du cap PLUS des embardées sèches. C'est la signature :
        // les Pieris volent lentement et à FORTE COURBURE — ça zigzague, ce n'est
        // pas l'arc lisse d'un boid. Le mécanisme est celui de WIND.veerChance.
        b.heading += R.range(rng, -1, 1) * BUTTERFLIES.turnRate * step;
        if (rng() < spec.veerChance * step * 60) {
          b.heading += (rng() < 0.5 ? -1 : 1) * spec.veerAmount;
        }
        // Rappel SOUPLE vers l'ancre propre — jamais un mur, un papillon qui
        // rebondit sur une frontière invisible se dénonce.
        const ax = b.anchorX - b.x, az = b.anchorZ - b.z;
        const da = Math.hypot(ax, az);
        if (da > BUTTERFLIES.homeRadius) {
          const home = Math.atan2(az, ax);
          let diff = home - b.heading;
          while (diff > Math.PI) diff -= TAU;
          while (diff < -Math.PI) diff += TAU;
          const k = Math.min(1, (da - BUTTERFLIES.homeRadius) / BUTTERFLIES.homeRadius);
          b.heading += diff * Math.min(1, BUTTERFLIES.homePull * k * step);
        }
        if (b.timer <= 0) {
          b.timer = R.range(rng, 1.5, 5.0);
          if (sleepy || rng() < BUTTERFLIES.perchChance) {
            const fi = pickFlower(b);
            if (fi >= 0) { b.target = fi; b.state = APPROACH; }
          }
        }
      }

      // — intégration —
      if (speed > 0) {
        b.x += Math.cos(b.heading) * speed * step;
        b.z += Math.sin(b.heading) * speed * step;
      }
      const ground = heightAt(b.x, b.z);
      const targetY = ground + wantY;
      b.y += (targetY - b.y) * Math.min(1, 4.0 * step);

      // — battement : phase INTÉGRÉE, jamais sin(uTime * freq) —
      // Point 2 de l'en-tête de birds.js, déjà payé : dès que la fréquence varie
      // (planer, fuir, se poser), un sinus à fréquence variable SAUTE.
      let rate = b.flapRate;
      if (b.state === PERCHED) rate *= 0.12;
      else if (b.big) {
        // Le machaon plane : il cesse de battre par intermittence.
        b.glide -= step;
        if (b.glide <= 0) { b.glide = R.range(rng, 0.4, 1.6); b.gliding = rng() < spec.glideChance; }
        if (b.gliding) rate *= 0.15;
      }
      b.flapPhase += rate * TAU * step;
      aFlap.array[i] = b.flapPhase;
      aPerch.array[i] = b.state === PERCHED ? 1 : 0;

      // Tangage vertical calé sur le battement : un papillon MONTE au coup d'aile
      // bas. C'est le tell principal, il tient ici le rôle du BANK de birds.js.
      const bob = b.state === PERCHED ? 0 : Math.sin(b.flapPhase) * spec.bob;

      _e.set(0, -b.heading, Math.sin(b.flapPhase) * 0.10);
      _q.setFromEuler(_e);
      _s.setScalar(spec.span);
      _m.compose(_p.set(b.x, b.y + bob, b.z), _q, _s);
      mesh.setMatrixAt(i, _m);
    }

    mesh.instanceMatrix.needsUpdate = true;
    aFlap.needsUpdate = true;
    aPerch.needsUpdate = true;
  }

  function dispose() {
    geo.dispose();
    material.dispose();
  }

  return { mesh, update, setRepeller, dispose };
}
