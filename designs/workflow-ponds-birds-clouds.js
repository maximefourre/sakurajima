export const meta = {
  name: 'sakura-island-life',
  description: 'Design the living layer of the island: koi ponds, bird flocks, and volumetric drifting clouds — then adversarially verify every three.js r185 API call',
  phases: [
    { title: 'Design', detail: 'ponds+koi, birds, clouds' },
    { title: 'Verify', detail: 'adversarial r185 API + GLSL compile check' },
  ],
}

const GROUND_TRUTH = `
=== VERIFIED GROUND TRUTH (do not contradict, do not "correct" these) ===
Target: three.js **0.185.1** (r185), ESM importmap from unpkg. NO build step, NO bundler.
  "three": "https://unpkg.com/three@0.185.1/build/three.module.js"
  "three/addons/": "https://unpkg.com/three@0.185.1/examples/jsm/"
Renderer is THREE.WebGLRenderer (NOT WebGPURenderer).

HTTP-200 verified addon paths at 0.185.1:
  three/addons/controls/OrbitControls.js
  three/addons/objects/Sky.js
  three/addons/objects/Water.js
  three/addons/postprocessing/EffectComposer.js
  three/addons/postprocessing/UnrealBloomPass.js
  three/addons/postprocessing/OutputPass.js
  three/addons/math/ImprovedNoise.js

r185 API rules that MUST be respected:
- renderer.outputColorSpace = THREE.SRGBColorSpace  (outputEncoding/sRGBEncoding are REMOVED)
- renderer.toneMapping = THREE.ACESFilmicToneMapping
- BufferGeometry only. THREE.Geometry does NOT exist. PlaneBufferGeometry does NOT exist.
- mergeBufferGeometries was RENAMED to mergeGeometries (three/addons/utils/BufferGeometryUtils.js)
- InstancedMesh: setMatrixAt(i, m); instanceMatrix.needsUpdate = true; setColorAt(i, c); instanceColor.needsUpdate = true
- Per-instance attributes: geometry.setAttribute('aFoo', new THREE.InstancedBufferAttribute(f32, itemSize))
- ShaderMaterial is GLSL1-style with three's own preprocessor (GLSL3 only for RawShaderMaterial)
- To get fog in a custom ShaderMaterial you must include fog_pars_vertex / fog_vertex /
  fog_pars_fragment / fog_fragment yourself AND set material.fog = true
- material.onBeforeCompile(shader) patches MeshStandardMaterial; only .replace() on chunk text you
  are CERTAIN appears verbatim in r185
- THREE.MathUtils.lerp / clamp / damp / smoothstep / randFloat exist
- ColorManagement is on by default (r152+), authored hex is treated as sRGB

=== SHARED MODULES THAT ALREADY EXIST — import, do not reimplement ===
From './noise.js':
  mulberry32(seed) -> rng()
  streamFor(seed, tag) -> rng()            // independent stream per subsystem
  R.range(rng,lo,hi) R.int(rng,lo,hi) R.pick(rng,arr) R.sign(rng) R.skew(rng,lo,hi,k) R.gauss(rng,mean,dev)
  noise2(x,y)                              // gradient noise, ~[-1,1]
  fbm2(x,y,oct=5,lac=2.03,gain=0.5)
  ridged2(x,y,oct=4,...)
  warp2(x,y,strength,scale) -> [x,y]
  smoothstep(e0,e1,x) clamp(v,lo,hi) mix(a,b,t)
  NOISE_GLSL                               // GLSL string: sk_hash33, sk_hash21, sk_noise3, sk_fbm3

From './config.js':
  SEED, WORLD {size:240, segments:320, seaLevel:0, maxHeight:34, beachTop:1.5, grassTop:22, grassMaxSlope:0.62},
  WIND {baseDir, dirDrift, strength, gustScale, gustSpeed, gustDepth, turbulence},
  DAY_LENGTH, START_TIME, QUALITY{low,high,ultra}, CAMERA

Provided by other subsystems at construction time (assume they exist, do not implement):
  heightAt(x, z) -> world Y of the terrain
  slopeAt(x, z)  -> 0..1
  wind.uniforms  -> { uTime, uWindDir, uWindStrength, ... } shared BY REFERENCE into materials
  wind.windAt(x, z, t) -> THREE.Vector3
  wind.WIND_GLSL -> GLSL string defining: vec3 windForce(vec3 worldPos, float t)
  sky.phase      -> { dayTime 0..1, isNight bool, sunElevation, goldenHour 0..1 }
  sky.sunDirection -> THREE.Vector3

=== SCENE BRIEF ===
A stylized-realistic (Ghibli-adjacent) 3D island covered in cherry blossom trees, on a full
day/night cycle with sunrise and sunset, wind carrying petals and bending grass, hilly terrain
with an organic non-circular coastline, and scattered boulders.
User's latest additions, in French:
  "1 ou 2 petits corps d'eau (marre, etang) avec carpe koi / map organique"
  "des oiseaux"
  "nuages"
Target hardware: Apple M4 Max, 32-core GPU. Budget generously; this must look gorgeous.
Aim for the scene to feel ALIVE and art-directed, never like a tech demo.
`

const DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    subsystem: { type: 'string' },
    approach: { type: 'string', description: 'Technical approach + art direction + why over alternatives. 200-500 words.' },
    code: { type: 'string', description: 'Complete runnable ES module. No pseudocode, no elisions.' },
    integration: { type: 'string', description: 'Exact export signatures and how main.js wires it in, incl. per-frame calls.' },
    tunables: { type: 'string' },
    pitfalls: { type: 'array', items: { type: 'string' } },
  },
  required: ['subsystem', 'approach', 'code', 'integration', 'tunables', 'pitfalls'],
  additionalProperties: false,
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          severity: { type: 'string' },
          location: { type: 'string' },
          problem: { type: 'string' },
          fix: { type: 'string' },
        },
        required: ['severity', 'location', 'problem', 'fix'],
        additionalProperties: false,
      },
    },
    corrected_code: { type: 'string' },
    confidence: { type: 'string' },
  },
  required: ['issues', 'corrected_code', 'confidence'],
  additionalProperties: false,
}

const SUBSYSTEMS = [
  {
    key: 'ponds',
    prompt: `You are designing the PONDS + KOI subsystem. The user asked for
"1 ou 2 petits corps d'eau (mare, etang) avec carpe koi" — one or two small ponds with koi carp.

Deliver a module \`ponds.js\`.

(A) POND BASINS — the terrain must actually dip.
Export \`carveP onds(x, z, baseHeight)\` — NO, export \`carvePonds(x, z, baseHeight)\` (one word) —
a pure function the terrain module composes into heightAt(): given the raw fbm height it returns a
modified height with 1-2 smooth basins carved in. Each pond is defined by a centre, a radius, a
depth, and a NOISY irregular rim (use fbm2 on the angle so it is a natural pond, never a circle).
Blend the rim with smoothstep so the banks slope gently in. Place them on the flatter shelf areas,
not on the ridge. Also export the pond descriptors so other systems can query them:
  \`PONDS = [{ cx, cz, radius, depth, waterY }]\` and \`isInPond(x, z)\`, \`pondAt(x,z)\`.
This function must be CHEAP — it is called for every terrain vertex and every prop placement.

(B) POND WATER SURFACE — a still-water disc, visually distinct from the ocean:
- Custom ShaderMaterial. Nearly-still surface: slow interfering ripple rings + a faint normal
  perturbation, NOT ocean waves.
- Screen-space-ish fake reflection of the sky colour via fresnel (pass in a sky colour uniform that
  the day/night cycle drives), plus a murky green-brown depth tint so it reads as fresh water.
- Depth fade at the rim using the carved basin depth, so the water meets the bank softly instead of
  a hard intersection line. Include a wet-sand/mud darkening ring just outside.
- Occasional rain-like ripple rings spawning at random points (procedural, in the shader, driven by
  hashed cell positions and time) — this is what makes still water read as alive.
- Petals that land on the surface: a thin instanced layer of floating petals drifting slowly with
  a surface current and rotating, respecting the pond boundary.

(C) KOI CARP — the hero detail:
- Build a procedural koi mesh: a tapered elongated body (lathe-like or a deformed cylinder with
  an elliptical cross-section that tapers at both ends), a triangular tail fin, two pectoral fins,
  a dorsal fin. Low-ish poly but SMOOTH shaded. No external model files.
- Animate the whole fish in the VERTEX SHADER: a travelling sine wave along the body's local Z
  (head barely moves, tail sweeps widely), amplitude increasing toward the tail, plus a slight
  roll. The fins should lag and flutter. This costs nothing and is what sells "fish".
- Colour patterns via per-instance data, painted procedurally in the FRAGMENT shader using the
  fish's local UV and a hashed per-instance seed — real koi varieties:
    kohaku (white with red blotches), taisho sanke (white, red, black),
    showa (black with red+white), ogon (solid metallic gold/platinum),
    asagi (blue-grey net pattern, red belly).
  Use noise-thresholded blotches, not stripes. Add a subtle iridescent sheen and a wet specular.
- Behaviour on the CPU (cheap, only a few dozen fish): each koi wanders inside its pond via a
  steering model — slow forward speed, gentle heading noise, soft repulsion from the pond rim and
  from other koi, occasional bursts of speed, occasional rises toward the surface where the body
  half-breaks the water and the shader lightens it. Koi should school loosely, not swim in a circle.
- Depth: koi swim at varying depths; deeper ones are dimmer and bluer (fake water absorption in the
  fragment shader based on depth below waterY). This is the single most important trick for making
  underwater fish look underwater.
- Count: 12-30 koi total across the ponds. Instanced or a small number of meshes — your call, justify it.

(D) POND DRESSING: reeds/irises at the rim (instanced, wind-reactive), a few lily pads floating with
tiny ripples, and a couple of stepping stones. Keep it tasteful, do not clutter.

Export: \`createPonds({ seed, heightAt, wind, quality })\` -> { group, update(t, dt, skyColor), PONDS, carvePonds, isInPond }`,
  },
  {
    key: 'birds',
    prompt: `You are designing the BIRDS subsystem. The user asked simply for "des oiseaux".
Make it a genuinely beautiful piece of motion, because moving silhouettes against a sunset sky is
one of the highest-impact-per-triangle things in the whole scene.

Deliver a module \`birds.js\` with THREE distinct kinds of bird, because one flock looks like a
tech demo and three kinds looks like a place:

(1) A FLOCK of small birds (swallows/sparrows) — 40-120 of them, one InstancedMesh.
  - Boids flocking on the CPU: separation, alignment, cohesion, plus (a) an attraction to a slowly
    wandering roost point, (b) avoidance of the terrain using heightAt(), (c) a soft ceiling, and
    (d) advection by the shared wind so a gust visibly pushes the whole flock. Use spatial hashing
    or simple O(n*k) with a neighbour cap — n is small, keep it simple but do not allocate per frame.
  - Bird geometry: a tiny body + two wings, built as one BufferGeometry. Wings flap in the VERTEX
    SHADER — rotate each wing vertex about the body axis by sin(t * flapRate + phase), with the
    flap amplitude driven per-instance and the flap rate INCREASING when the bird is climbing and
    dropping to a glide when descending. That correlation is what makes birds look like birds.
  - Orient each instance along its velocity with a banking roll proportional to its turn rate.
    Birds that bank into turns read as alive; birds that slide sideways read as sprites.
  - They should read mostly as dark silhouettes at distance, catching a rim of sun colour.

(2) A pair of larger soaring birds (hawk/kite) that circle lazily on a thermal high above the ridge,
  barely flapping, wings held in a shallow dihedral. Different scale, different rhythm.

(3) One or two HERONS / cranes standing motionless in the shallows of the pond, occasionally
  shifting a leg or stabbing at the water, then returning to stillness. These are near-static and
  should be a small posed mesh, not instanced. They anchor the scene's sense of scale.

DAY/NIGHT BEHAVIOUR — use \`sky.phase\`:
  - Dawn: flock wakes, spirals up out of the trees.
  - Day: wide lazy circuits over the island, occasionally landing.
  - Dusk: the flock gathers and descends into the canopy; population fades toward zero.
  - Night: replaced by a handful of bats or a single owl with a slow erratic flight path, and
    the flock is gone. Fade counts smoothly, never pop.

Also emit bird CALLS as a hook (an onEvent callback) so audio could be attached later — do not
implement audio, just expose the hook.

Export: \`createBirds({ seed, heightAt, wind, ponds, quality })\` -> { group, update(t, dt, phase) }`,
  },
  {
    key: 'clouds',
    prompt: `You are designing the CLOUDS subsystem. The user asked for "nuages".

Note: the r185 Sky addon ALREADY has procedural clouds in its shader
(cloudScale, cloudSpeed, cloudCoverage, cloudDensity, cloudElevation uniforms), and the day/night
subsystem drives those. Those are distant, flat, baked into the sky dome. Your job is the
FOREGROUND/MIDGROUND cloud layer that has parallax, volume, and real lighting — the thing that
makes the sky feel three-dimensional as the camera orbits.

Deliver a module \`clouds.js\`:

Pick ONE primary technique and justify it against the alternatives:
  (a) Volumetric billboard clusters — many soft camera-facing quads grouped into cloud "blobs",
      each blob a cluster of 20-60 puffs with a procedural soft-noise alpha in the fragment shader,
      lit by approximating the sun direction (puffs on the sun side brighter, silver-lined rim,
      deep bluish-grey undersides). Sorted back-to-front, depthWrite off. Cheap and gorgeous.
  (b) A raymarched volumetric layer on a full-screen or dome quad — 16-32 steps through an fbm
      density field with a cheap 4-6 step light march toward the sun. Expensive but the real thing.
  (c) A hybrid: raymarched high cirrus + billboard cumulus.
Given an Apple M4 Max target you may be ambitious, but the scene ALSO has 300k grass blades and
12k petals, so justify your budget honestly.

Whatever you pick, these are non-negotiable:
- Clouds must DRIFT with the shared wind direction, faster than the ground props, and slowly
  evolve/morph rather than translating rigidly like a texture on a conveyor belt.
- They must be LIT by the day/night cycle: white/silver at noon, warm gold and deep magenta-grey
  at golden hour, orange rim-lit from below at sunset, near-black with a faint moonlit silver edge
  at night. Take the sun direction, sun colour and sun intensity as uniforms.
- Godrays/light shafts are welcome if cheap (radial blur from the sun screen position, or a
  cheap dust-mote/atmosphere-scatter term) — say clearly whether you include them.
- Clouds must correctly sit BEHIND the island and in front of the sky dome, and must not break
  when the camera looks straight up or straight at the horizon.
- Coverage must be animatable so the day can go from clear morning to overcast afternoon.
- A high, thin CIRRUS layer in addition to the main cumulus layer — two layers at different
  altitudes and speeds is what creates believable sky depth.
- Optional: cloud SHADOWS drifting across the island. Say exactly how (a projected texture on the
  ground, or a term folded into the sun light's intensity) and whether you recommend it.

Export: \`createClouds({ seed, wind, quality })\` -> { group, update(t, dt, sunDir, sunColor, sunIntensity, coverage) }`,
  },
]

phase('Design')

const results = await pipeline(
  SUBSYSTEMS,

  (s) => agent(
    `${GROUND_TRUTH}

You are a senior Three.js technical artist. Design ONE subsystem, in depth.

${s.prompt}

RULES:
- REAL, COMPLETE, RUNNABLE code. No pseudocode. No "// rest of implementation". No elisions.
- Import the shared helpers from './noise.js' and './config.js' rather than reimplementing them.
- Only use three.js APIs you are CERTAIN exist in r185. If unsure about an addon, hand-roll it.
- Seeded PRNG only — never Math.random(). Never Date.now(); take time as a parameter.
- Do NOT write any files to disk. Return code in the schema's \`code\` field.
- Never allocate Vector3/Matrix4/Color inside a per-frame update; hoist them to module scope.
- Prioritise how it LOOKS. Technically clean but ugly is a failure.`,
    { label: `design:${s.key}`, phase: 'Design', schema: DESIGN_SCHEMA, effort: 'xhigh' }
  ),

  (design, s) => agent(
    `${GROUND_TRUTH}

You are an adversarial three.js r185 reviewer. Below is a proposed \`${s.key}\` module.
Find every reason it would FAIL TO RUN or look wrong, then return a fully corrected version.

Check in this order:
1. HALLUCINATED APIs — any class/method/property/uniform/import path that does not exist in r185
   or has a different signature. Watch for: Geometry, PlaneBufferGeometry, outputEncoding,
   sRGBEncoding, physicallyCorrectLights, mergeBufferGeometries (now mergeGeometries), Face3,
   .setEncoding, THREE.Math (now THREE.MathUtils).
2. GLSL that will not compile: undeclared varying/uniform/attribute, int vs float mismatch
   (e.g. \`for(int i=0;i<n;i++)\` where n is a float or a non-const), a varying declared in the
   vertex shader but missing in the fragment shader, reading an attribute in the fragment shader,
   wrong #include chunk names, texture2D vs texture, non-constant loop bounds (illegal in GLSL1).
3. onBeforeCompile .replace() search strings that do not appear VERBATIM in the r185 chunk being
   patched. Flag every one you are not certain of and re-anchor it on something you are sure of.
4. Runtime errors: undefined vars, missed needsUpdate, instance count vs attribute length mismatch,
   NaN from normalize(0) / acos out of domain / division by zero, disposal leaks.
5. Per-frame allocation in update loops. Hoist every temp Vector3/Quaternion/Matrix4/Color.
6. Art-direction weakness: anything that will read flat, banded, plasticky, uniformly random,
   or like programmer art. Call it out and fix it.

Be genuinely skeptical. If you are not SURE an API exists, treat it as broken and hand-roll it.

Return the FULL corrected module in \`corrected_code\` — never a diff, never elided.

--- SUBSYSTEM: ${s.key} ---
--- APPROACH ---
${design ? design.approach : '(design agent returned nothing)'}
--- INTEGRATION CONTRACT ---
${design ? design.integration : ''}
--- CODE ---
${design ? design.code : ''}
`,
    { label: `verify:${s.key}`, phase: 'Verify', schema: VERDICT_SCHEMA, effort: 'xhigh' }
  ).then((v) => ({ key: s.key, design, verdict: v })),
)

const ok = results.filter(Boolean)
log(`${ok.length}/${SUBSYSTEMS.length} living-layer subsystems designed and verified`)
for (const r of ok) {
  const issues = (r.verdict && r.verdict.issues) || []
  log(`  ${r.key}: ${issues.length} issues (${issues.filter(i => i.severity === 'fatal').length} fatal)`)
}
return ok
