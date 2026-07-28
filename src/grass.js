/**
 * grass.js — instanced, wind-driven stylised grass for the Sakurajima island scene.
 *
 * three.js r185 (0.185.1) · WebGLRenderer · ESM importmap · no build step.
 *
 * Design notes:
 *  - MeshStandardMaterial patched with onBeforeCompile -> we keep shadows, fog,
 *    IBL and the day/night light rig for free.
 *  - instanceMatrix carries translation + rotation ONLY (no scale) so mat3(instanceMatrix)
 *    is orthonormal and world->local vector transforms are three dot products.
 *  - Scale lives in per-instance attributes and is applied in the vertex shader.
 *  - The blade bends as an arc (each cross-section rotated about the root by theta*t^2),
 *    never as a shear. Base stays planted, tip whips.
 *  - Everything is driven by a seeded mulberry32 PRNG. No Math.random(), no Date.now().
 *
 * Wind contract (see WIND_GLSL_FALLBACK for the reference implementation):
 *    vec3 windForce( vec3 worldPos );   // world-space force, .xz horizontal, |.xz| ~ 0..1.6
 *  plus whatever uniforms the wind module declares inside its own GLSL. Those uniform
 *  OBJECTS must be exposed as `wind.uniforms` so we can share them by reference.
 */

import * as THREE from 'three';

/* =====================================================================================
   Seeded PRNG + hand-rolled value noise (no addon dependency, fully deterministic)
   ===================================================================================== */

export function mulberry32( seed ) {

	let a = seed >>> 0;

	return function () {

		a = ( a + 0x6D2B79F5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

function hash2i( ix, iz, seed ) {

	let h = ( Math.imul( ix, 374761393 ) + Math.imul( iz, 668265263 ) + Math.imul( seed, 1274126177 ) ) | 0;
	h = ( h ^ ( h >>> 13 ) ) | 0;
	h = Math.imul( h, 1274126177 ) | 0;
	h = ( h ^ ( h >>> 16 ) ) >>> 0;
	return h / 4294967296;

}

function fade01( t ) {

	return t * t * ( 3 - 2 * t );

}

function valueNoise2D( x, z, seed ) {

	const x0 = Math.floor( x );
	const z0 = Math.floor( z );
	const fx = fade01( x - x0 );
	const fz = fade01( z - z0 );

	const a = hash2i( x0, z0, seed );
	const b = hash2i( x0 + 1, z0, seed );
	const c = hash2i( x0, z0 + 1, seed );
	const d = hash2i( x0 + 1, z0 + 1, seed );

	const top = a + ( b - a ) * fx;
	const bot = c + ( d - c ) * fx;
	return top + ( bot - top ) * fz;

}

function fbm2D( x, z, seed, octaves ) {

	let freq = 1, amp = 1, sum = 0, norm = 0;

	for ( let i = 0; i < octaves; i ++ ) {

		sum += amp * valueNoise2D( x * freq, z * freq, ( seed + i * 7919 ) | 0 );
		norm += amp;
		amp *= 0.5;
		freq *= 2.03;

	}

	return sum / norm;

}

function smooth01( x, e0, e1 ) {

	const t = Math.min( 1, Math.max( 0, ( x - e0 ) / ( e1 - e0 || 1e-6 ) ) );
	return t * t * ( 3 - 2 * t );

}

/* =====================================================================================
   Fallback wind — used only when no wind module is supplied. Same signature as the
   shared WIND_GLSL so grass and petals stay interchangeable.
   ===================================================================================== */

const WIND_GLSL_FALLBACK = /* glsl */`
uniform float uWindTime;
uniform vec2  uWindDir;
uniform float uWindStrength;
uniform float uWindGust;

float sgWindHash( vec2 p ) {
	return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
}

float sgWindNoise( vec2 p ) {
	vec2 i = floor( p );
	vec2 f = fract( p );
	f = f * f * ( 3.0 - 2.0 * f );
	float a = sgWindHash( i );
	float b = sgWindHash( i + vec2( 1.0, 0.0 ) );
	float c = sgWindHash( i + vec2( 0.0, 1.0 ) );
	float d = sgWindHash( i + vec2( 1.0, 1.0 ) );
	return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
}

vec3 windForce( vec3 worldPos ) {

	vec2 d = normalize( uWindDir + vec2( 1e-5, 0.0 ) );
	vec2 p = worldPos.xz;
	float travel = dot( p, d );

	float g1 = sgWindNoise( vec2( travel * 0.018, ( p.x + p.z ) * 0.010 ) - vec2( uWindTime * 0.09, 0.0 ) );
	float g2 = sgWindNoise( vec2( travel * 0.055, ( p.x - p.z ) * 0.030 ) - vec2( uWindTime * 0.24, 0.0 ) );
	float gust = pow( clamp( mix( g1, g2, 0.45 ), 0.0, 1.0 ), 1.6 );

	float mag = ( 0.35 + 0.65 * gust * ( 1.0 + uWindGust ) ) * uWindStrength;

	float swirl = ( sgWindNoise( p * 0.06 + vec2( uWindTime * 0.05 ) ) - 0.5 ) * 0.55;
	vec2 dir = normalize( d + vec2( -d.y, d.x ) * swirl );

	return vec3( dir.x, -0.08 * gust, dir.y ) * mag;

}
`;

/* =====================================================================================
   Defaults / tunables
   ===================================================================================== */

const DEFAULTS = {

	seed: 20260727,
	count: 96000,
	bounds: null,          // { minX, maxX, minZ, maxZ } | { radius } | { size }
	camera: null,          // optional; can also be passed per-frame to update()
	wind: null,            // { WIND_GLSL, uniforms }
	heightAt: null,        // required: (x, z) -> y
	slopeAt: null,         // optional: (x, z) -> 1 - normal.y   (see slopeMode)
	slopeMode: 'normal',   // 'normal' (1 - n.y) | 'radians'
	exclude: null,         // optional: (x, z) -> bool, true = no grass here

	// --- blade shape -------------------------------------------------------------
	bladeHeight: 0.62,     // world units at heightScale = 1
	bladeWidth: 0.068,     // world units at widthJitter = 1
	segmentsHi: 5,
	segmentsLo: 2,
	loWidthMul: 1.75,      // far blades are fatter so a sparser far field still covers
	normalBow: 0.55,       // fake cross-section cupping baked into the normals

	// --- placement ---------------------------------------------------------------
	// Coverage is deliberately generous: wide clump mask, few bare patches,
	// grass climbing slightly steeper ground. Perceived density comes from
	// COVERAGE far more than from blade count.
	beachY: 1.6,
	beachBlend: 1.5,
	shoreWobble: 0.9,      // wiggle on the beach line so it is not a contour ring
	uplandY: 24.0,         // follows HEIGHT_SCALE — the raised ridge flanks stay grassed
	uplandBlend: 6.0,
	slopeSoft: 0.13,       // 1 - n.y   (~30 deg) -> density starts dropping
	slopeMax: 0.34,        // ~48 deg -> no grass
	patchScale: 0.030,     // low-freq clump mask
	patchLow: 0.14,
	patchHigh: 0.52,
	bareScale: 0.115,      // higher-freq bare-earth mask
	bareThreshold: 0.86,
	bareFloor: 0.12,
	tintScale: 0.021,      // low-freq colour patches
	terrainTilt: 0.38,     // 0 = always vertical, 1 = fully aligned to the ground normal
	rootSink: 0.035,
	maxAttemptsPerBlade: 14,

	// --- colour (authored sRGB hex; ColorManagement converts to linear) -----------
	colorShade: 0x3e6b45,  // blue-green, shaded hollows
	colorMid:   0x63a24b,  // fresh mid green, pushed lusher
	colorSun:   0xa9cf60,  // yellow-green, sunny ridges — brighter for the fairy-tale brief
	colorDry:   0xc8b06c,  // straw
	tintJitter: 0.19,
	dryBase: 0.015,
	dryEdge: 0.11,

	// --- wind response -----------------------------------------------------------
	bendScale: 0.85,
	jitterAmp: 0.10,
	jitterFreq: 4.2,
	rippleFreq: 0.22,
	rippleSpeed: 3.4,
	rippleAmp: 0.75,
	windStrength: 1.0,     // fallback wind only
	windGust: 0.35,        // fallback wind only
	windDir: [ 0.82, 0.57 ],

	// --- shading -----------------------------------------------------------------
	ao: 0.42,
	groundTint: [ 0.72, 0.78, 0.60 ],
	tipTint: [ 1.12, 1.12, 0.98 ],
	translucency: 1.35,
	gustBrighten: 0.10,
	roughness: 0.72,
	sunColor: 0xffe6c2,
	sunIntensity: 1.0,
	sunDirection: [ 0.4, 0.35, 0.85 ],

	// --- LOD / culling -----------------------------------------------------------
	// Distances stretched for the ×5 island: the old 135-unit fade end vanished
	// the meadow from the postcard camera. chunkDivisions raised so frustum
	// culling stays fine-grained over the much larger bounds.
	chunkDivisions: 10,
	lodDistance: 48,
	lodHysteresis: 4,
	lodKeep: 0.45,
	fadeStart: 160,
	fadeEnd: 230

};

const UP = new THREE.Vector3( 0, 1, 0 );
const ONE = new THREE.Vector3( 1, 1, 1 );

/* =====================================================================================
   Blade geometry
   ===================================================================================== */

function makeBladeGeometry( segments, widthMul, bow ) {

	const nVerts = segments * 2 + 1;
	const pos = new Float32Array( nVerts * 3 );
	const nrm = new Float32Array( nVerts * 3 );
	const uvs = new Float32Array( nVerts * 2 );
	const aH = new Float32Array( nVerts );
	const aSide = new Float32Array( nVerts );
	const index = [];

	const halfW = 0.5 * widthMul;
	const n = new THREE.Vector3();
	let vi = 0;

	for ( let r = 0; r < segments; r ++ ) {

		const v = r / segments;

		// taper: widest just above the base, narrowing to the tip
		let taper = Math.pow( 1 - v, 0.62 );
		taper *= 0.60 + 0.40 * Math.min( 1, v / 0.16 );
		const w = halfW * taper;

		for ( let s = 0; s < 2; s ++ ) {

			const side = s === 0 ? - 1 : 1;

			pos[ vi * 3 + 0 ] = side * w;
			pos[ vi * 3 + 1 ] = v;
			pos[ vi * 3 + 2 ] = 0;

			// bowed normals fake a cupped cross-section at zero geometry cost
			n.set( side * bow, v * 0.22, 1 ).normalize();
			nrm[ vi * 3 + 0 ] = n.x;
			nrm[ vi * 3 + 1 ] = n.y;
			nrm[ vi * 3 + 2 ] = n.z;

			uvs[ vi * 2 + 0 ] = s;
			uvs[ vi * 2 + 1 ] = v;

			aH[ vi ] = v;
			aSide[ vi ] = side;
			vi ++;

		}

	}

	// tip
	const tip = vi;
	pos[ vi * 3 + 0 ] = 0;
	pos[ vi * 3 + 1 ] = 1;
	pos[ vi * 3 + 2 ] = 0;
	n.set( 0, 0.30, 1 ).normalize();
	nrm[ vi * 3 + 0 ] = n.x;
	nrm[ vi * 3 + 1 ] = n.y;
	nrm[ vi * 3 + 2 ] = n.z;
	uvs[ vi * 2 + 0 ] = 0.5;
	uvs[ vi * 2 + 1 ] = 1;
	aH[ vi ] = 1;
	aSide[ vi ] = 0;

	// CCW when viewed from +Z
	for ( let r = 0; r < segments - 1; r ++ ) {

		const l0 = r * 2, r0 = r * 2 + 1, l1 = ( r + 1 ) * 2, r1 = ( r + 1 ) * 2 + 1;
		index.push( l0, r0, r1, l0, r1, l1 );

	}

	const lLast = ( segments - 1 ) * 2, rLast = ( segments - 1 ) * 2 + 1;
	index.push( lLast, rLast, tip );

	const geo = new THREE.BufferGeometry();
	geo.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
	geo.setAttribute( 'normal', new THREE.BufferAttribute( nrm, 3 ) );
	geo.setAttribute( 'uv', new THREE.BufferAttribute( uvs, 2 ) );
	geo.setAttribute( 'aH', new THREE.BufferAttribute( aH, 1 ) );
	geo.setAttribute( 'aSide', new THREE.BufferAttribute( aSide, 1 ) );
	geo.setIndex( index );

	return geo;

}

/* =====================================================================================
   Shader source
   ===================================================================================== */

function vertexCommon( windGLSL ) {

	return /* glsl */`
attribute float aH;
attribute float aSide;
attribute vec4  aParams;   // x: phase, y: stiffness, z: rest bend (rad), w: height scale
attribute float aWidth;    // relative width jitter
attribute vec3  aTint;     // linear working-space colour

// Tell the shared wind block that uTime already exists here, so its own
// guarded declaration is skipped. Two declarations is a compile error.
#define SK_UTIME_DECLARED 1
uniform float uTime;
uniform float uBladeHeight;
uniform float uBladeWidth;
uniform float uBendScale;
uniform float uJitterAmp;
uniform float uJitterFreq;
uniform vec2  uRippleDir;
uniform float uRippleFreq;
uniform float uRippleSpeed;
uniform float uRippleAmp;
uniform float uFadeStart;
uniform float uFadeEnd;

varying float vGrassH;
varying vec3  vGrassTint;
varying float vGrassGust;

vec3  gGrassAxis  = vec3( 1.0, 0.0, 0.0 );
float gGrassAngle = 0.0;
float gGrassFade  = 1.0;

${windGLSL}

// Rodrigues rotation of v about unit axis a by ang
vec3 sgTwist( vec3 v, vec3 a, float ang ) {
	float c = cos( ang );
	float s = sin( ang );
	return v * c + cross( a, v ) * s + a * dot( a, v ) * ( 1.0 - c );
}

void grassSetup() {

	// blade root in world space (instanceMatrix[3] is the translation column)
	vec3 rootW = ( modelMatrix * vec4( instanceMatrix[ 3 ].xyz, 1.0 ) ).xyz;

	// distance fade: blades shrink into the ground instead of popping
	gGrassFade = 1.0 - smoothstep( uFadeStart, uFadeEnd, distance( rootW, cameraPosition ) );

	// --- shared wind ------------------------------------------------------------
	vec2 w = windForce( rootW ).xz;

	// --- travelling gust bands (visible ripples crossing the field) --------------
	vec2 rd = normalize( uRippleDir + vec2( 1e-5, 0.0 ) );
	vec2 rp = vec2( -rd.y, rd.x );
	float a1 = dot( rootW.xz, rd ) * uRippleFreq - uTime * uRippleSpeed;
	float a2 = dot( rootW.xz, rp ) * uRippleFreq * 0.63 - uTime * uRippleSpeed * 0.77 + 1.7;
	float ripple = ( sin( a1 ) * 0.65 + sin( a2 ) * 0.35 ) * 0.5 + 0.5;
	float gust = ripple * ripple;          // sharpen -> banded, not sinusoidal mush
	vGrassGust = gust;
	w *= 1.0 + uRippleAmp * ( gust - 0.35 );

	// --- per-blade high-frequency jitter, perpendicular to the wind --------------
	float jit = sin( uTime * uJitterFreq + aParams.x ) * 0.7
	          + sin( uTime * uJitterFreq * 1.93 + aParams.x * 2.13 ) * 0.3;
	w += rp * ( jit * uJitterAmp );

	float mag = length( w );
	vec2 dir = mag > 1e-5 ? w / mag : vec2( 1.0, 0.0 );

	// atan() saturates: strong gusts flatten the blade but never fold it through the floor
	float bend = atan( mag * uBendScale / max( aParams.y, 0.2 ) );

	// world -> instance-local. mat3(instanceMatrix) is orthonormal (no scale baked in),
	// so the inverse is the transpose, written out as three dots (no transpose() needed).
	vec3 dw = vec3( dir.x, 0.0, dir.y );
	mat3 im = mat3( instanceMatrix );
	vec3 dl = vec3( dot( im[ 0 ], dw ), dot( im[ 1 ], dw ), dot( im[ 2 ], dw ) );
	dl.y = 0.0;
	dl = normalize( dl + vec3( 1e-5, 0.0, 0.0 ) );

	// cross( up, dl ) -> rotating about this axis moves the tip toward dl
	vec3 axWind = vec3( dl.z, 0.0, -dl.x );

	// sum wind + rest droop as rotation VECTORS -> one Rodrigues call, not two
	vec3 rv = axWind * bend + vec3( 1.0, 0.0, 0.0 ) * aParams.z;
	gGrassAngle = length( rv );
	gGrassAxis = gGrassAngle > 1e-5 ? rv / gGrassAngle : vec3( 1.0, 0.0, 0.0 );

}

vec3 grassNormal( vec3 n ) {
	return normalize( sgTwist( n, gGrassAxis, gGrassAngle * aH * aH ) );
}

vec3 grassPosition() {
	float wJ = aWidth * uBladeWidth;
	vec3 p = vec3( position.x * wJ, position.y * aParams.w * uBladeHeight, position.z * wJ );
	// rotate each cross-section about the root by theta * t^2:
	// distance from the root is preserved (no stretch), base stays planted, tip whips.
	p = sgTwist( p, gGrassAxis, gGrassAngle * aH * aH );
	return p * gGrassFade;
}
`;

}

const FRAGMENT_COMMON = /* glsl */`
varying float vGrassH;
varying vec3  vGrassTint;
varying float vGrassGust;

uniform vec3  uSunDirWorld;   // scene -> sun, normalised
uniform vec3  uSunColor;
uniform float uSunIntensity;
uniform float uTranslucency;
uniform float uAO;
uniform vec3  uGroundTint;
uniform vec3  uTipTint;
uniform float uGustBrighten;
`;

const FRAGMENT_TINT = /* glsl */`
	float sgBase = smoothstep( 0.0, 0.5, vGrassH );
	vec3  sgCol  = vGrassTint * mix( uGroundTint * uAO, vec3( 1.0 ), sgBase );
	sgCol = mix( sgCol, sgCol * uTipTint, smoothstep( 0.35, 1.0, vGrassH ) );
	sgCol *= 1.0 + uGustBrighten * ( vGrassGust - 0.5 );
	diffuseColor.rgb *= sgCol;
`;

const FRAGMENT_ROUGH = /* glsl */`
	roughnessFactor = mix( roughnessFactor, roughnessFactor * 0.55, smoothstep( 0.35, 1.0, vGrassH ) );
`;

const FRAGMENT_TRANSLUCENCY = /* glsl */`
	{
		vec3 sunV  = normalize( ( viewMatrix * vec4( uSunDirWorld, 0.0 ) ).xyz );
		vec3 viewV = normalize( vViewPosition );
		float back = pow( max( dot( viewV, -sunV ), 0.0 ), 3.0 );
		float edge = 1.0 - abs( dot( normalize( normal ), sunV ) );
		float horizon = mix( 0.25, 1.0, smoothstep( 0.45, 0.0, uSunDirWorld.y ) )
		              * smoothstep( -0.14, 0.03, uSunDirWorld.y );
		float trans = back * mix( 0.35, 1.0, edge ) * smoothstep( 0.0, 0.8, vGrassH ) * horizon;
		outgoingLight += uSunColor * ( uSunIntensity * uTranslucency * trans ) * diffuseColor.rgb;
	}
`;

function patch( src, token, replacement, label ) {

	if ( src.indexOf( token ) === - 1 ) {

		console.warn( '[grass] shader anchor missing: ' + token + ' (' + label + ') — three.js version drift?' );
		return src;

	}

	return src.replace( token, replacement );

}

/* =====================================================================================
   Bounds helper
   ===================================================================================== */

function normBounds( b ) {

	if ( ! b ) return { minX: - 90, maxX: 90, minZ: - 90, maxZ: 90 };
	if ( typeof b.radius === 'number' ) return { minX: - b.radius, maxX: b.radius, minZ: - b.radius, maxZ: b.radius };
	if ( typeof b.size === 'number' ) { const h = b.size * 0.5; return { minX: - h, maxX: h, minZ: - h, maxZ: h }; }

	return {
		minX: b.minX !== undefined ? b.minX : - 90,
		maxX: b.maxX !== undefined ? b.maxX : 90,
		minZ: b.minZ !== undefined ? b.minZ : - 90,
		maxZ: b.maxZ !== undefined ? b.maxZ : 90
	};

}

/* =====================================================================================
   createGrass
   ===================================================================================== */

export function createGrass( options = {} ) {

	const CFG = Object.assign( {}, DEFAULTS, options );

	const heightAt = CFG.heightAt;
	if ( typeof heightAt !== 'function' ) throw new Error( '[grass] createGrass requires heightAt(x, z) -> y' );

	const B = normBounds( CFG.bounds );
	const spanX = B.maxX - B.minX;
	const spanZ = B.maxZ - B.minZ;

	/* ---------------------------------------------------------------- uniforms */

	const ownWind = ! ( CFG.wind && CFG.wind.WIND_GLSL );
	const windGLSL = ownWind ? WIND_GLSL_FALLBACK : CFG.wind.WIND_GLSL;

	const windUniforms = ( ! ownWind && CFG.wind.uniforms ) ? CFG.wind.uniforms : {
		uWindTime: { value: 0 },
		uWindDir: { value: new THREE.Vector2( CFG.windDir[ 0 ], CFG.windDir[ 1 ] ).normalize() },
		uWindStrength: { value: CFG.windStrength },
		uWindGust: { value: CFG.windGust }
	};

	const uniforms = {
		uTime: { value: 0 },
		uBladeHeight: { value: CFG.bladeHeight },
		uBladeWidth: { value: CFG.bladeWidth },
		uBendScale: { value: CFG.bendScale },
		uJitterAmp: { value: CFG.jitterAmp },
		uJitterFreq: { value: CFG.jitterFreq },
		uRippleDir: { value: new THREE.Vector2( CFG.windDir[ 0 ], CFG.windDir[ 1 ] ).normalize() },
		uRippleFreq: { value: CFG.rippleFreq },
		uRippleSpeed: { value: CFG.rippleSpeed },
		uRippleAmp: { value: CFG.rippleAmp },
		uFadeStart: { value: CFG.fadeStart },
		uFadeEnd: { value: CFG.fadeEnd },

		uSunDirWorld: { value: new THREE.Vector3().fromArray( CFG.sunDirection ).normalize() },
		uSunColor: { value: new THREE.Color( CFG.sunColor ) },
		uSunIntensity: { value: CFG.sunIntensity },
		uTranslucency: { value: CFG.translucency },
		uAO: { value: CFG.ao },
		uGroundTint: { value: new THREE.Vector3().fromArray( CFG.groundTint ) },
		uTipTint: { value: new THREE.Vector3().fromArray( CFG.tipTint ) },
		uGustBrighten: { value: CFG.gustBrighten }
	};

	/* ---------------------------------------------------------------- material */

	const material = new THREE.MeshStandardMaterial( {
		color: 0xffffff,          // all colour comes from aTint
		roughness: CFG.roughness,
		metalness: 0.0,
		side: THREE.DoubleSide,
		dithering: true
	} );

	material.onBeforeCompile = function ( shader ) {

		// share the uniform OBJECTS by reference so update() reaches every recompile
		Object.assign( shader.uniforms, uniforms, windUniforms );

		let v = shader.vertexShader;
		v = patch( v, '#include <common>', '#include <common>\n' + vertexCommon( windGLSL ), 'vertex common' );
		v = patch( v, '#include <beginnormal_vertex>', [
			'	grassSetup();',
			'	vec3 objectNormal = grassNormal( normal );',
			'	#ifdef USE_TANGENT',
			'		vec3 objectTangent = vec3( tangent.xyz );',
			'	#endif'
		].join( '\n' ), 'beginnormal' );
		v = patch( v, '#include <begin_vertex>', [
			'	vGrassH = aH;',
			'	vGrassTint = aTint;',
			'	vec3 transformed = grassPosition();'
		].join( '\n' ), 'begin_vertex' );
		shader.vertexShader = v;

		let f = shader.fragmentShader;
		f = patch( f, '#include <common>', '#include <common>\n' + FRAGMENT_COMMON, 'fragment common' );
		f = patch( f, '#include <color_fragment>', '#include <color_fragment>\n' + FRAGMENT_TINT, 'tint' );
		f = patch( f, '#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n' + FRAGMENT_ROUGH, 'roughness' );

		if ( f.indexOf( '#include <opaque_fragment>' ) !== - 1 ) {

			f = f.replace( '#include <opaque_fragment>', FRAGMENT_TRANSLUCENCY + '\n#include <opaque_fragment>' );

		} else {

			// defensive fallback if the chunk is ever renamed again
			f = patch( f, '#include <tonemapping_fragment>',
				FRAGMENT_TRANSLUCENCY.replace( 'outgoingLight +=', 'gl_FragColor.rgb +=' ) +
				'\n#include <tonemapping_fragment>', 'translucency-fallback' );

		}

		shader.fragmentShader = f;

	};

	// CRITICAL: without a custom cache key three may hand this material a program
	// compiled from *unpatched* MeshStandardMaterial source.
	material.customProgramCacheKey = function () { return 'sakura-grass-v1'; };

	/* ---------------------------------------------------------------- generation */

	const rand = mulberry32( ( CFG.seed >>> 0 ) || 1 );
	const nSeed = Math.imul( CFG.seed | 0, 2654435761 ) >>> 0;

	const N = CFG.count | 0;
	const aX = new Float32Array( N ), aY = new Float32Array( N ), aZ = new Float32Array( N );
	const aYaw = new Float32Array( N );
	const aNX = new Float32Array( N ), aNY = new Float32Array( N ), aNZ = new Float32Array( N );
	const aHS = new Float32Array( N ), aWD = new Float32Array( N );
	const aPH = new Float32Array( N ), aST = new Float32Array( N ), aRS = new Float32Array( N );
	const aTR = new Float32Array( N ), aTG = new Float32Array( N ), aTB = new Float32Array( N );
	const aChunk = new Int32Array( N );

	const div = Math.max( 1, CFG.chunkDivisions | 0 );
	const cellX = spanX / div;
	const cellZ = spanZ / div;

	const cShade = new THREE.Color( CFG.colorShade );
	const cMid = new THREE.Color( CFG.colorMid );
	const cSun = new THREE.Color( CFG.colorSun );
	const cDry = new THREE.Color( CFG.colorDry );
	const tmpC = new THREE.Color();

	const EPSD = 0.8;
	const maxAttempts = N * CFG.maxAttemptsPerBlade;
	let placed = 0;
	let attempts = 0;

	while ( placed < N && attempts < maxAttempts ) {

		attempts ++;

		const x = B.minX + rand() * spanX;
		const z = B.minZ + rand() * spanZ;

		// (1) cheapest test first: low-frequency clump mask -> patches, not Poisson
		const patchN = fbm2D( x * CFG.patchScale, z * CFG.patchScale, nSeed, 3 );
		let p = smooth01( patchN, CFG.patchLow, CFG.patchHigh );
		if ( p <= 0.001 ) continue;

		// bare earth: sharp higher-frequency mask punches holes through the clumps
		const bare = valueNoise2D( x * CFG.bareScale, z * CFG.bareScale, ( nSeed ^ 0x9e37 ) >>> 0 );
		if ( bare > CFG.bareThreshold ) p *= CFG.bareFloor;
		if ( rand() > p ) continue;

		// (2) standing water. Ponds and the river are carved into the heightfield
		// itself, so their beds pass the height and slope tests perfectly happily
		// and fill up with submerged grass. Nothing else here can catch that: the
		// bed of a pond is, geometrically, a gentle hollow in the meadow.
		if ( CFG.exclude && CFG.exclude( x, z ) ) continue;

		// (3) height band: above the beach, below the rocky upland
		const h = heightAt( x, z );
		const shore = CFG.beachY + ( valueNoise2D( x * 0.05, z * 0.05, ( nSeed ^ 0x51ed ) >>> 0 ) - 0.5 ) * 2 * CFG.shoreWobble;
		const fBeach = smooth01( h, shore, shore + CFG.beachBlend );
		if ( fBeach <= 0.001 ) continue;
		const fUp = 1 - smooth01( h, CFG.uplandY - CFG.uplandBlend, CFG.uplandY );
		if ( fUp <= 0.001 ) continue;

		// (4) slope (2 extra heightAt calls, shared with the terrain normal)
		const hdx = ( heightAt( x + EPSD, z ) - h ) / EPSD;
		const hdz = ( heightAt( x, z + EPSD ) - h ) / EPSD;
		const invLen = 1 / Math.sqrt( hdx * hdx + hdz * hdz + 1 );
		const nx = - hdx * invLen, ny = invLen, nz = - hdz * invLen;

		let s;
		if ( CFG.slopeAt ) {

			const sv = CFG.slopeAt( x, z );
			s = CFG.slopeMode === 'radians' ? 1 - Math.cos( sv ) : sv;

		} else {

			s = 1 - ny;

		}

		const fSlope = 1 - smooth01( s, CFG.slopeSoft, CFG.slopeMax );
		if ( fSlope <= 0.001 ) continue;
		if ( rand() > fBeach * fUp * fSlope ) continue;

		// ---- accepted --------------------------------------------------------
		const i = placed ++;

		aX[ i ] = x;
		aY[ i ] = h - CFG.rootSink;
		aZ[ i ] = z;
		aNX[ i ] = nx; aNY[ i ] = ny; aNZ[ i ] = nz;
		aYaw[ i ] = rand() * Math.PI * 2;

		// taller grass inside thick clumps
		aHS[ i ] = THREE.MathUtils.clamp( 0.62 + 0.55 * p + 0.42 * ( rand() - 0.5 ), 0.6, 1.6 );
		aWD[ i ] = 0.78 + 0.50 * rand();
		aPH[ i ] = rand() * Math.PI * 2;
		aST[ i ] = 0.65 + 0.80 * rand();
		aRS[ i ] = 0.10 + 0.36 * rand();

		// colour: low-frequency patches first, tiny per-blade jitter second
		const cn = fbm2D( x * CFG.tintScale, z * CFG.tintScale, ( nSeed + 911 ) | 0, 3 );
		tmpC.copy( cShade ).lerp( cMid, smooth01( cn, 0.15, 0.55 ) );
		tmpC.lerp( cSun, smooth01( cn, 0.50, 0.92 ) );

		// dry blades cluster at the sparse edges of clumps
		if ( rand() < CFG.dryBase + ( 1 - p ) * CFG.dryEdge ) tmpC.lerp( cDry, 0.45 + 0.45 * rand() );

		const jitter = 1 + ( rand() - 0.5 ) * CFG.tintJitter;
		aTR[ i ] = tmpC.r * jitter;
		aTG[ i ] = tmpC.g * jitter;
		aTB[ i ] = tmpC.b * jitter;

		const ci = Math.min( div - 1, Math.max( 0, Math.floor( ( x - B.minX ) / cellX ) ) );
		const cj = Math.min( div - 1, Math.max( 0, Math.floor( ( z - B.minZ ) / cellZ ) ) );
		aChunk[ i ] = cj * div + ci;

	}

	if ( placed < N ) {

		console.warn( '[grass] placed ' + placed + '/' + N + ' blades in ' + attempts +
			' attempts — loosen slopeMax / patchLow, or lower count.' );

	}

	/* ------------------------------------------------- counting sort into chunks */

	const nChunks = div * div;
	const counts = new Int32Array( nChunks );
	for ( let i = 0; i < placed; i ++ ) counts[ aChunk[ i ] ] ++;

	const starts = new Int32Array( nChunks );
	let acc = 0;
	for ( let c = 0; c < nChunks; c ++ ) { starts[ c ] = acc; acc += counts[ c ]; }

	const cursor = starts.slice();
	const order = new Int32Array( placed );
	// generation order is random, so any PREFIX of a chunk's list is an unbiased subset
	for ( let i = 0; i < placed; i ++ ) order[ cursor[ aChunk[ i ] ] ++ ] = i;

	/* ---------------------------------------------------------------- build meshes */

	const GEO_HI = makeBladeGeometry( CFG.segmentsHi, 1.0, CFG.normalBow );
	const GEO_LO = makeBladeGeometry( CFG.segmentsLo, CFG.loWidthMul, CFG.normalBow );

	const _m = new THREE.Matrix4();
	const _q = new THREE.Quaternion();
	const _qt = new THREE.Quaternion();
	const _qy = new THREE.Quaternion();
	const _v = new THREE.Vector3();
	const _n = new THREE.Vector3();

	const maxBladeWorld = CFG.bladeHeight * 1.6;

	function buildMesh( baseGeo, from, n ) {

		const geo = baseGeo.clone();
		const params = new Float32Array( n * 4 );
		const widths = new Float32Array( n );
		const tints = new Float32Array( n * 3 );

		const mesh = new THREE.InstancedMesh( geo, material, n );
		mesh.castShadow = false;    // 100k blades in the shadow map is not worth it
		mesh.receiveShadow = true;  // canopy shadows on grass ARE worth it
		mesh.frustumCulled = true;
		mesh.matrixAutoUpdate = false;

		let minX = Infinity, minY = Infinity, minZ = Infinity;
		let maxX = - Infinity, maxY = - Infinity, maxZ = - Infinity;

		for ( let k = 0; k < n; k ++ ) {

			const i = order[ from + k ];

			_n.set( aNX[ i ], aNY[ i ], aNZ[ i ] );
			_qt.setFromUnitVectors( UP, _n );
			_q.identity().slerp( _qt, CFG.terrainTilt );   // partial alignment to the ground
			_qy.setFromAxisAngle( UP, aYaw[ i ] );
			_q.multiply( _qy );

			_v.set( aX[ i ], aY[ i ], aZ[ i ] );
			_m.compose( _v, _q, ONE );                     // scale MUST stay 1,1,1
			mesh.setMatrixAt( k, _m );

			params[ k * 4 + 0 ] = aPH[ i ];
			params[ k * 4 + 1 ] = aST[ i ];
			params[ k * 4 + 2 ] = aRS[ i ];
			params[ k * 4 + 3 ] = aHS[ i ];
			widths[ k ] = aWD[ i ];
			tints[ k * 3 + 0 ] = aTR[ i ];
			tints[ k * 3 + 1 ] = aTG[ i ];
			tints[ k * 3 + 2 ] = aTB[ i ];

			if ( _v.x < minX ) minX = _v.x; if ( _v.x > maxX ) maxX = _v.x;
			if ( _v.y < minY ) minY = _v.y; if ( _v.y > maxY ) maxY = _v.y;
			if ( _v.z < minZ ) minZ = _v.z; if ( _v.z > maxZ ) maxZ = _v.z;

		}

		mesh.instanceMatrix.needsUpdate = true;
		geo.setAttribute( 'aParams', new THREE.InstancedBufferAttribute( params, 4 ) );
		geo.setAttribute( 'aWidth', new THREE.InstancedBufferAttribute( widths, 1 ) );
		geo.setAttribute( 'aTint', new THREE.InstancedBufferAttribute( tints, 3 ) );

		// three would compute a FLAT disc from instanceMatrix alone (height lives in the
		// shader), so blades would pop at the frustum edge. Set it manually.
		const cx = ( minX + maxX ) * 0.5, cy = ( minY + maxY ) * 0.5, cz = ( minZ + maxZ ) * 0.5;
		const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
		const radius = 0.5 * Math.sqrt( dx * dx + dy * dy + dz * dz ) + maxBladeWorld * 1.35;
		mesh.boundingSphere = new THREE.Sphere( new THREE.Vector3( cx, cy, cz ), radius );

		mesh.updateMatrix();
		return { mesh, cx, cy, cz, radius };

	}

	const group = new THREE.Group();
	group.name = 'grass';
	const chunks = [];

	for ( let c = 0; c < nChunks; c ++ ) {

		const n = counts[ c ];
		if ( n === 0 ) continue;

		const from = starts[ c ];
		const hi = buildMesh( GEO_HI, from, n );
		const nLo = Math.max( 1, Math.round( n * CFG.lodKeep ) );
		const lo = buildMesh( GEO_LO, from, nLo );

		hi.mesh.name = 'grass_hi_' + c;
		lo.mesh.name = 'grass_lo_' + c;
		lo.mesh.visible = false;

		group.add( hi.mesh );
		group.add( lo.mesh );

		chunks.push( {
			hi: hi.mesh, lo: lo.mesh,
			cx: hi.cx, cy: hi.cy, cz: hi.cz,
			radius: hi.radius,
			near: true
		} );

	}

	/* ---------------------------------------------------------------- runtime */

	const _camPos = new THREE.Vector3();
	let activeCamera = CFG.camera;
	let visibleBlades = placed;

	function update( t, cam ) {

		uniforms.uTime.value = t;
		if ( ownWind ) windUniforms.uWindTime.value = t;

		// keep the ripple bands aligned with whatever direction the wind module is using
		const wsrc = CFG.wind;
		if ( wsrc ) {

			const wd = ( wsrc.uniforms && wsrc.uniforms.uWindDir && wsrc.uniforms.uWindDir.value ) || wsrc.direction;
			if ( wd && typeof wd.x === 'number' ) {

				const wz = ( wd.z !== undefined ) ? wd.z : wd.y;
				uniforms.uRippleDir.value.set( wd.x, wz );
				if ( uniforms.uRippleDir.value.lengthSq() > 1e-8 ) uniforms.uRippleDir.value.normalize();

			}

		}

		if ( cam ) activeCamera = cam;
		if ( ! activeCamera ) return;

		activeCamera.getWorldPosition( _camPos );

		const near = CFG.lodDistance;
		const hyst = CFG.lodHysteresis;
		const cullDist = CFG.fadeEnd;
		let vb = 0;

		for ( let i = 0; i < chunks.length; i ++ ) {

			const ch = chunks[ i ];
			const dx = ch.cx - _camPos.x, dy = ch.cy - _camPos.y, dz = ch.cz - _camPos.z;
			const dCentre = Math.sqrt( dx * dx + dy * dy + dz * dz );

			// conservative: nothing in this chunk is closer than dCentre - radius
			if ( dCentre - ch.radius > cullDist ) {

				ch.hi.visible = false;
				ch.lo.visible = false;
				continue;

			}

			const threshold = ch.near ? near + hyst : near - hyst;
			ch.near = dCentre < threshold;

			ch.hi.visible = ch.near;
			ch.lo.visible = ! ch.near;
			vb += ch.near ? ch.hi.count : ch.lo.count;

		}

		visibleBlades = vb;

	}

	function setSun( dirWorld, color, intensity ) {

		if ( dirWorld ) uniforms.uSunDirWorld.value.copy( dirWorld ).normalize();
		if ( color ) uniforms.uSunColor.value.copy( color );
		if ( intensity !== undefined ) uniforms.uSunIntensity.value = intensity;

	}

	function setWindDirection( x, z ) {

		uniforms.uRippleDir.value.set( x, z ).normalize();
		if ( ownWind ) windUniforms.uWindDir.value.set( x, z ).normalize();

	}

	function setCamera( cam ) { activeCamera = cam; }

	function dispose() {

		for ( let i = 0; i < chunks.length; i ++ ) {

			chunks[ i ].hi.geometry.dispose();
			chunks[ i ].lo.geometry.dispose();
			chunks[ i ].hi.dispose();
			chunks[ i ].lo.dispose();

		}

		GEO_HI.dispose();
		GEO_LO.dispose();
		material.dispose();
		group.clear();

	}

	return {
		mesh: group,          // THREE.Group of InstancedMesh chunks — scene.add(grass.mesh)
		update,               // update(elapsedSeconds, camera?)
		setSun,
		setWindDirection,
		setCamera,
		dispose,
		material,
		uniforms,
		windUniforms,
		chunks,
		count: placed,
		get visibleCount() { return visibleBlades; }
	};

}

export default createGrass;
