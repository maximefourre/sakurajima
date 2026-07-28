// =============================================================================
// sakura.js  —  procedural cherry-blossom trees for three.js r185 (0.185.1)
// -----------------------------------------------------------------------------
// No external textures, no addons, no build step. Fully deterministic (mulberry32).
//
//   import { createSakuraForest, makeTree, createWindUniforms, WIND_GLSL } from './sakura.js';
//
// Exports
//   createWindUniforms(opts)          -> shared wind uniform bundle (give this to grass too)
//   WIND_GLSL                         -> the shared wind GLSL (grass/petals should reuse it)
//   makeTree(archetype, rng, opts)    -> one unique tree prototype
//   createSakuraForest(opts)          -> { group, update, setEnvironment, setSeason, ... }
// =============================================================================

import * as THREE from 'three';

// -----------------------------------------------------------------------------
// 0. Deterministic RNG + tiny value noise
// -----------------------------------------------------------------------------

export function mulberry32( seed ) {

	let a = seed >>> 0;

	return function () {

		a |= 0; a = ( a + 0x6D2B79F5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

export function makeRng( seed ) {

	const next = mulberry32( seed );

	return {
		next,
		range: ( a, b ) => a + ( b - a ) * next(),
		range2: ( pair ) => pair[ 0 ] + ( pair[ 1 ] - pair[ 0 ] ) * next(),
		int2: ( pair ) => Math.min( pair[ 1 ], pair[ 0 ] + Math.floor( next() * ( pair[ 1 ] - pair[ 0 ] + 1 ) ) ),
		chance: ( p ) => next() < p,
		sign: () => ( next() < 0.5 ? - 1 : 1 ),
		// cheap approximately-gaussian in [-1,1]
		gauss: () => ( next() + next() + next() - 1.5 ) * 1.1547,
		pick: ( arr ) => arr[ Math.min( arr.length - 1, Math.floor( next() * arr.length ) ) ]
	};

}

function ihash( x, y, s ) {

	let h = Math.imul( x | 0, 374761393 ) + Math.imul( y | 0, 668265263 ) + Math.imul( s | 0, 1442695041 );
	h = Math.imul( h ^ ( h >>> 13 ), 1274126177 );
	return ( ( h ^ ( h >>> 16 ) ) >>> 0 ) / 4294967296;

}

function vnoise2( x, y, s ) {

	const xi = Math.floor( x ), yi = Math.floor( y );
	const xf = x - xi, yf = y - yi;
	const u = xf * xf * ( 3 - 2 * xf );
	const v = yf * yf * ( 3 - 2 * yf );
	const a = ihash( xi, yi, s ), b = ihash( xi + 1, yi, s );
	const c = ihash( xi, yi + 1, s ), d = ihash( xi + 1, yi + 1, s );
	return ( a * ( 1 - u ) + b * u ) * ( 1 - v ) + ( c * ( 1 - u ) + d * u ) * v;

}

function fbm2( x, y, s, oct = 3 ) {

	let f = 0, amp = 0.5, norm = 0;
	for ( let i = 0; i < oct; i ++ ) {

		f += amp * vnoise2( x, y, s + i * 7919 );
		norm += amp;
		amp *= 0.5; x *= 2.03; y *= 1.97;

	}
	return f / norm;

}

// -----------------------------------------------------------------------------
// 1. Shared wind field (bark, blossoms AND grass should all include this)
// -----------------------------------------------------------------------------

export const WIND_GLSL = /* glsl */`
uniform float uTime;
uniform vec3  uWindDir;
uniform float uWindStrength;
uniform float uWindFreq;
uniform float uGustScale;
uniform float uBarkSway;
uniform float uBlossomSway;

vec2 sakuraWindAxis() {
	return normalize( uWindDir.xz + vec2( 1e-4, 1e-4 ) );
}

// Signed travelling wave, roughly [-1,1]
float sakuraWindWave( vec3 wp ) {
	vec2  wd    = sakuraWindAxis();
	float phase = dot( wp.xz, wd ) * uGustScale;
	float t     = uTime * uWindFreq;
	return sin( t          - phase * 6.0        ) * 0.55
	     + sin( t * 1.83   - phase * 9.7 + 1.70 ) * 0.30
	     + sin( t * 3.31   - phase * 3.1 + 4.20 ) * 0.15;
}

// Slow low-frequency gust envelope that sweeps across the island, ~[0.05,1.7]
float sakuraWindGust( vec3 wp ) {
	vec2  wd = sakuraWindAxis();
	float t  = uTime * uWindFreq;
	float g  = sin( t * 0.21 - dot( wp.xz, wd ) * uGustScale * 0.55 )
	         + 0.55 * sin( t * 0.37 + dot( wp.zx, vec2( 0.031, -0.019 ) ) );
	return clamp( 0.40 + 0.62 * g, 0.05, 1.7 );
}
`;

export function createWindUniforms( opts = {} ) {

	const dir = opts.direction ? opts.direction.clone() : new THREE.Vector3( 1.0, 0.0, 0.38 );
	dir.y = 0.0;
	if ( dir.lengthSq() < 1e-8 ) dir.set( 1, 0, 0 );
	dir.normalize();

	return {
		uTime:        { value: 0 },
		uWindDir:     { value: dir },
		uWindStrength:{ value: opts.strength !== undefined ? opts.strength : 1.0 },
		uWindFreq:    { value: opts.frequency !== undefined ? opts.frequency : 0.85 },
		uGustScale:   { value: opts.gustScale !== undefined ? opts.gustScale : 0.045 },
		uBarkSway:    { value: opts.barkSway !== undefined ? opts.barkSway : 0.16 },
		uBlossomSway: { value: opts.blossomSway !== undefined ? opts.blossomSway : 0.30 }
	};

}

function ensureWindUniforms( u ) {

	if ( ! u ) return createWindUniforms();
	const d = createWindUniforms();
	for ( const k in d ) if ( u[ k ] === undefined ) u[ k ] = d[ k ];
	return u;

}

// -----------------------------------------------------------------------------
// 2. Archetypes.  Arrays are indexed by recursion depth (clamped to last entry).
// -----------------------------------------------------------------------------

/*
 * Blossom colour is authored in HSL, and the original ranges were a very pale
 * near-white: saturation from 0.10 and lightness up to 0.98. That is honest for
 * a somei-yoshino seen close up in flat light, and from any distance at all it
 * reads as a bare tree with snow on it. Saturation is up and lightness down
 * across all five archetypes — enough to be unmistakably pink without going
 * magenta, and with the weeping and veteran trees carried furthest because they
 * are the ones the eye picks out of a grove.
 *
 * Cluster counts, petal size and spread are up with them. Blossom is instanced
 * and costs almost nothing per flower, so filling the crown is cheap; leaving
 * gaps in it is what made the island read as an orchard in March.
 */
const ARCHETYPES = {

	// classic upright vase-shaped Yoshino, wide flat canopy
	somei: {
		heightRange:  [ 6.5, 9.5 ],
		trunkLen:     [ 2.2, 3.2 ],
		trunkRadius:  [ 0.19, 0.28 ],
		maxDepth: 4, budget: 90,
		taperPow: 1.30, endTaper: 0.66, rootFlare: 0.42, flareLobes: 5, flareAmt: 0.16,
		flexScale: 1.0, leaderProb: 0.5, asym: 0.0,
		lean:         [ 0.05, 0.02, 0.00, 0.00, 0.00 ],
		lenFall:      [ 0.66, 0.72, 0.74, 0.70, 0.66 ],
		childRadius:  [ 0.70, 0.70, 0.70, 0.68, 0.66 ],
		angle:        [ [ 24, 38 ], [ 30, 46 ], [ 34, 52 ], [ 38, 58 ], [ 40, 62 ] ],
		tipChildren:  [ [ 2, 3 ], [ 2, 3 ], [ 2, 3 ], [ 2, 3 ], [ 2, 2 ] ],
		sideChildren: [ [ 1, 2 ], [ 1, 1 ], [ 0, 1 ], [ 0, 1 ], [ 0, 0 ] ],
		gravity:      [ - 0.08, - 0.03, 0.06, 0.20, 0.34 ],
		photo:        [ 0.34, 0.18, 0.06, 0.00, - 0.04 ],
		wobble:       [ 0.26, 0.34, 0.44, 0.56, 0.66 ],
		segLen:       [ 0.50, 0.48, 0.44, 0.38, 0.32 ],
		radial:       [ 10, 7, 5, 4, 3 ],
		barkBase: 0x3b2f29, barkTip: 0x6f5a4c, barkDead: 0x6d675e,
		blossom: {
			density: 15.0, start: 0.14, cluster: [ 4, 7 ], size: [ 0.24, 0.40 ], spread: 0.155,
			h: [ 0.945, 0.995 ], s: [ 0.30, 0.58 ], l: [ 0.78, 0.92 ], bare: 0.01, leaf: 0.03
		}
	},

	// weeping cherry: boughs arc up, then long whips cascade down
	shidare: {
		heightRange:  [ 5.0, 7.5 ],
		trunkLen:     [ 2.4, 3.4 ],
		trunkRadius:  [ 0.16, 0.24 ],
		maxDepth: 3, budget: 110,
		taperPow: 1.15, endTaper: 0.70, rootFlare: 0.30, flareLobes: 4, flareAmt: 0.10,
		flexScale: 1.35, leaderProb: 0.25, asym: 0.0,
		lean:         [ 0.03, 0.01, 0.00, 0.00 ],
		lenFall:      [ 0.70, 1.25, 0.16, 0.16 ],
		childRadius:  [ 0.72, 0.62, 0.55, 0.55 ],
		angle:        [ [ 26, 46 ], [ 10, 30 ], [ 30, 62 ], [ 30, 62 ] ],
		tipChildren:  [ [ 3, 4 ], [ 1, 2 ], [ 1, 2 ], [ 1, 1 ] ],
		sideChildren: [ [ 1, 2 ], [ 1, 2 ], [ 3, 5 ], [ 0, 0 ] ],
		gravity:      [ - 0.10, - 0.45, 1.10, 1.30 ],
		photo:        [ 0.40, 0.55, - 0.10, - 0.20 ],
		wobble:       [ 0.22, 0.24, 0.30, 0.34 ],
		segLen:       [ 0.45, 0.38, 0.26, 0.22 ],
		radial:       [ 9, 6, 4, 3 ],
		barkBase: 0x39302c, barkTip: 0x6a5344, barkDead: 0x69635b,
		blossom: {
			density: 14.0, start: 0.04, cluster: [ 4, 6 ], size: [ 0.21, 0.34 ], spread: 0.115,
			h: [ 0.933, 0.975 ], s: [ 0.48, 0.78 ], l: [ 0.68, 0.84 ], bare: 0.02, leaf: 0.02
		}
	},

	// old coastal tree, leaning hard downwind, asymmetric crown, some bare wood
	windswept: {
		heightRange:  [ 4.5, 7.0 ],
		trunkLen:     [ 1.8, 2.8 ],
		trunkRadius:  [ 0.20, 0.30 ],
		maxDepth: 4, budget: 76,
		taperPow: 1.45, endTaper: 0.62, rootFlare: 0.55, flareLobes: 5, flareAmt: 0.22,
		flexScale: 1.2, leaderProb: 0.6, asym: 0.55,
		lean:         [ 0.30, 0.16, 0.08, 0.04, 0.02 ],
		lenFall:      [ 0.64, 0.70, 0.70, 0.66, 0.62 ],
		childRadius:  [ 0.70, 0.68, 0.68, 0.66, 0.64 ],
		angle:        [ [ 26, 46 ], [ 32, 56 ], [ 34, 60 ], [ 38, 64 ], [ 40, 66 ] ],
		tipChildren:  [ [ 2, 3 ], [ 2, 3 ], [ 2, 3 ], [ 2, 2 ], [ 1, 2 ] ],
		sideChildren: [ [ 1, 2 ], [ 0, 2 ], [ 0, 1 ], [ 0, 1 ], [ 0, 0 ] ],
		gravity:      [ - 0.02, 0.02, 0.12, 0.26, 0.40 ],
		photo:        [ 0.16, 0.10, 0.04, 0.00, - 0.05 ],
		wobble:       [ 0.45, 0.52, 0.60, 0.68, 0.72 ],
		segLen:       [ 0.42, 0.40, 0.36, 0.32, 0.28 ],
		radial:       [ 9, 6, 5, 4, 3 ],
		barkBase: 0x342b26, barkTip: 0x6b5a4e, barkDead: 0x7c766c,
		blossom: {
			density: 12.0, start: 0.18, cluster: [ 4, 6 ], size: [ 0.21, 0.35 ], spread: 0.135,
			h: [ 0.946, 1.000 ], s: [ 0.28, 0.54 ], l: [ 0.80, 0.93 ], bare: 0.05, leaf: 0.03
		}
	},

	// slender sapling, few branches, sparse blossom, some fresh green
	young: {
		heightRange:  [ 2.4, 4.0 ],
		trunkLen:     [ 1.8, 2.6 ],
		trunkRadius:  [ 0.055, 0.085 ],
		maxDepth: 3, budget: 30,
		taperPow: 1.10, endTaper: 0.72, rootFlare: 0.12, flareLobes: 3, flareAmt: 0.05,
		flexScale: 1.6, leaderProb: 0.75, asym: 0.0,
		lean:         [ 0.04, 0.02, 0.00, 0.00 ],
		lenFall:      [ 0.62, 0.66, 0.62, 0.60 ],
		childRadius:  [ 0.74, 0.72, 0.70, 0.68 ],
		angle:        [ [ 22, 34 ], [ 26, 44 ], [ 30, 52 ], [ 30, 52 ] ],
		tipChildren:  [ [ 1, 2 ], [ 2, 2 ], [ 1, 2 ], [ 1, 1 ] ],
		sideChildren: [ [ 1, 2 ], [ 0, 1 ], [ 0, 0 ], [ 0, 0 ] ],
		gravity:      [ - 0.10, - 0.04, 0.10, 0.18 ],
		photo:        [ 0.45, 0.28, 0.10, 0.02 ],
		wobble:       [ 0.30, 0.36, 0.44, 0.50 ],
		segLen:       [ 0.40, 0.36, 0.30, 0.26 ],
		radial:       [ 7, 5, 4, 3 ],
		barkBase: 0x4a3226, barkTip: 0x7b5340, barkDead: 0x6f685d,
		blossom: {
			density: 12.5, start: 0.12, cluster: [ 3, 5 ], size: [ 0.18, 0.29 ], spread: 0.115,
			h: [ 0.948, 0.995 ], s: [ 0.26, 0.50 ], l: [ 0.82, 0.94 ], bare: 0.03, leaf: 0.15
		}
	},

	// thick gnarled low-forking veteran, broad irregular crown, deadwood
	ancient: {
		heightRange:  [ 7.0, 11.0 ],
		trunkLen:     [ 1.2, 1.9 ],
		trunkRadius:  [ 0.36, 0.52 ],
		maxDepth: 5, budget: 130,
		taperPow: 1.60, endTaper: 0.70, rootFlare: 0.85, flareLobes: 6, flareAmt: 0.26,
		flexScale: 0.8, leaderProb: 0.35, asym: 0.12,
		lean:         [ 0.08, 0.05, 0.02, 0.01, 0.00, 0.00 ],
		lenFall:      [ 1.30, 0.72, 0.74, 0.72, 0.68, 0.64 ],
		childRadius:  [ 0.80, 0.74, 0.72, 0.70, 0.68, 0.66 ],
		angle:        [ [ 20, 44 ], [ 28, 54 ], [ 32, 58 ], [ 36, 62 ], [ 40, 66 ], [ 42, 66 ] ],
		tipChildren:  [ [ 2, 3 ], [ 2, 3 ], [ 2, 3 ], [ 2, 3 ], [ 2, 2 ], [ 1, 2 ] ],
		sideChildren: [ [ 0, 1 ], [ 1, 2 ], [ 1, 2 ], [ 0, 1 ], [ 0, 1 ], [ 0, 0 ] ],
		gravity:      [ - 0.05, - 0.02, 0.08, 0.20, 0.32, 0.42 ],
		photo:        [ 0.30, 0.26, 0.10, 0.02, - 0.02, - 0.05 ],
		wobble:       [ 0.55, 0.72, 0.66, 0.60, 0.62, 0.66 ],
		segLen:       [ 0.40, 0.44, 0.42, 0.36, 0.32, 0.28 ],
		radial:       [ 12, 8, 6, 5, 4, 3 ],
		barkBase: 0x2f2823, barkTip: 0x6a5c50, barkDead: 0x847d72,
		blossom: {
			density: 13.5, start: 0.16, cluster: [ 4, 7 ], size: [ 0.25, 0.43 ], spread: 0.165,
			h: [ 0.936, 0.995 ], s: [ 0.36, 0.68 ], l: [ 0.74, 0.88 ], bare: 0.08, leaf: 0.05
		}
	}

};

export const ARCHETYPE_NAMES = Object.keys( ARCHETYPES );

function at( arr, i ) { return arr[ Math.min( i, arr.length - 1 ) ]; }

// -----------------------------------------------------------------------------
// 3. Geometry writer — tapered tubes straight into shared arrays (no merge pass)
// -----------------------------------------------------------------------------

const _b   = new THREE.Vector3();
const _q   = new THREE.Quaternion();
const _t1  = new THREE.Vector3();
const _t2  = new THREE.Vector3();
const _t3  = new THREE.Vector3();
const _UP  = new THREE.Vector3( 0, 1, 0 );

class MeshWriter {

	constructor() {

		this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.flx = []; this.idx = [];

	}

	// Emits one ring of radial+1 verts (seam duplicated so u wraps cleanly).
	ring( center, tangent, nref, radius, drds, v, cr, cg, cb, flex, radial, lobes, lobeAmt ) {

		const base = this.pos.length / 3;
		_b.crossVectors( tangent, nref ).normalize();

		for ( let i = 0; i <= radial; i ++ ) {

			const th = ( i / radial ) * Math.PI * 2;
			const ct = Math.cos( th ), st = Math.sin( th );

			const dx = nref.x * ct + _b.x * st;
			const dy = nref.y * ct + _b.y * st;
			const dz = nref.z * ct + _b.z * st;

			const rr = radius * ( 1 + lobeAmt * Math.cos( lobes * th ) );

			this.pos.push( center.x + dx * rr, center.y + dy * rr, center.z + dz * rr );

			// slope-corrected normal: n = normalize(radial - tangent * dr/ds)
			let nx = dx - tangent.x * drds;
			let ny = dy - tangent.y * drds;
			let nz = dz - tangent.z * drds;
			const inv = 1 / Math.max( 1e-6, Math.hypot( nx, ny, nz ) );
			this.nrm.push( nx * inv, ny * inv, nz * inv );

			this.uv.push( i / radial, v );
			this.col.push( cr, cg, cb );
			this.flx.push( flex );

		}

		return base;

	}

	connect( a, b, radial ) {

		for ( let i = 0; i < radial; i ++ ) {

			this.idx.push( a + i, a + i + 1, b + i );
			this.idx.push( a + i + 1, b + i + 1, b + i );

		}

	}

	toGeometry() {

		const g = new THREE.BufferGeometry();
		g.setAttribute( 'position', new THREE.Float32BufferAttribute( this.pos, 3 ) );
		g.setAttribute( 'normal',   new THREE.Float32BufferAttribute( this.nrm, 3 ) );
		g.setAttribute( 'uv',       new THREE.Float32BufferAttribute( this.uv, 2 ) );
		g.setAttribute( 'color',    new THREE.Float32BufferAttribute( this.col, 3 ) );
		g.setAttribute( 'aFlex',    new THREE.Float32BufferAttribute( this.flx, 1 ) );
		g.setIndex( this.idx );
		g.computeBoundingBox();
		g.computeBoundingSphere();
		return g;

	}

}

function perpendicular( d, out ) {

	// pick the world axis least aligned with d
	if ( Math.abs( d.y ) < 0.9 ) out.set( 0, 1, 0 ); else out.set( 1, 0, 0 );
	out.addScaledVector( d, - out.dot( d ) ).normalize();
	return out;

}

// -----------------------------------------------------------------------------
// 4. Recursive branch growth
// -----------------------------------------------------------------------------

function growBranch( W, rng, cfg, ctx, start, dirIn, len, r0, depth, alongIn ) {

	if ( ctx.budget <= 0 ) return;
	ctx.budget --;

	const maxDepth  = cfg.maxDepth;
	const terminal  = depth >= maxDepth;
	const radial    = Math.max( 3, Math.round( at( cfg.radial, depth ) * ctx.radialScale ) );
	const segLen    = at( cfg.segLen, depth );
	const gravity   = at( cfg.gravity, depth );
	const photo     = at( cfg.photo, depth );
	const wobble    = at( cfg.wobble, depth );
	const leanAmt   = at( cfg.lean, depth );

	// deadwood decision has to happen here so the bark colour can differ
	const bare = terminal ? rng.chance( cfg.blossom.bare ) : false;

	const rEnd = terminal ? r0 * 0.09 : r0 * cfg.endTaper;
	let segs = Math.max( 2, Math.round( len / segLen ) );
	segs = Math.min( segs, 16 );

	// ---- pass 1: integrate the centre-line -----------------------------------
	const path = [];
	const p    = start.clone();
	const d    = dirIn.clone().normalize();
	const nrf  = perpendicular( d, new THREE.Vector3() );
	const step = len / segs;
	let along  = alongIn;

	for ( let s = 0; s <= segs; s ++ ) {

		const t = s / segs;
		let r = rEnd + ( r0 - rEnd ) * Math.pow( 1 - t, cfg.taperPow );

		// root buttress flare only on the very bottom of the trunk
		if ( depth === 0 ) r *= 1 + cfg.rootFlare * Math.exp( - t * 8.0 );

		path.push( { p: p.clone(), d: d.clone(), n: nrf.clone(), r, along } );

		if ( s === segs ) break;

		p.addScaledVector( d, step );
		along += step;

		_t1.copy( d );
		_t1.y -= gravity * step;
		_t1.y += photo * step * ( 1 - Math.abs( d.y ) );
		_t1.addScaledVector( ctx.leanDir, leanAmt * step );
		_t1.x += rng.gauss() * wobble * step;
		_t1.z += rng.gauss() * wobble * step;
		_t1.y += rng.gauss() * wobble * step * 0.45;
		_t1.normalize();

		// rotation-minimising frame transport (prevents twig twisting)
		_q.setFromUnitVectors( d, _t1 );
		nrf.applyQuaternion( _q );
		nrf.addScaledVector( _t1, - nrf.dot( _t1 ) ).normalize();
		d.copy( _t1 );

	}

	// ---- pass 2: emit rings ---------------------------------------------------
	const cJit = 1 + rng.gauss() * 0.05;
	const bases = [];
	const lobes  = depth === 0 ? cfg.flareLobes : 0;

	for ( let s = 0; s <= segs; s ++ ) {

		const node = path[ s ];
		const rPrev = path[ Math.max( 0, s - 1 ) ].r;
		const rNext = path[ Math.min( segs, s + 1 ) ].r;
		const ds = step * ( ( s === 0 || s === segs ) ? 1 : 2 );
		const drds = ( rNext - rPrev ) / Math.max( 1e-5, ds );

		const an   = THREE.MathUtils.clamp( node.along / ctx.reach, 0, 1 );
		const thin = THREE.MathUtils.clamp( 1 - node.r / ctx.rootRadius, 0, 1 );
		const flex = THREE.MathUtils.clamp(
			Math.pow( thin, 2.0 ) * Math.pow( an, 1.25 ) * cfg.flexScale, 0, 1.6 );

		const mix = an;
		let cr, cg, cb;
		if ( bare ) {

			cr = ctx.cDead.r; cg = ctx.cDead.g; cb = ctx.cDead.b;

		} else {

			cr = ( ctx.cBase.r + ( ctx.cTip.r - ctx.cBase.r ) * mix ) * cJit;
			cg = ( ctx.cBase.g + ( ctx.cTip.g - ctx.cBase.g ) * mix ) * cJit;
			cb = ( ctx.cBase.b + ( ctx.cTip.b - ctx.cBase.b ) * mix ) * cJit;

		}

		const lobeAmt = depth === 0 ? cfg.flareAmt * Math.exp( - ( s / segs ) * 7.0 ) : 0;

		bases.push( W.ring( node.p, node.d, node.n, node.r, drds, node.along * 0.42,
			cr, cg, cb, flex, radial, lobes, lobeAmt ) );

	}

	for ( let s = 0; s < bases.length - 1; s ++ ) W.connect( bases[ s ], bases[ s + 1 ], radial );

	// ---- terminal: record the twig for blossom seeding ------------------------
	if ( terminal || ctx.budget <= 0 ) {

		if ( ! bare ) ctx.twigs.push( { path, len, depth } );
		return;

	}

	// ---- children -------------------------------------------------------------
	const tip = path[ path.length - 1 ];
	const lenFall = at( cfg.lenFall, depth );
	const cRad    = at( cfg.childRadius, depth );
	const angRange = at( cfg.angle, depth );

	const nTip = rng.int2( at( cfg.tipChildren, depth ) );
	const az0  = rng.range( 0, Math.PI * 2 );

	for ( let k = 0; k < nTip; k ++ ) {

		const az = az0 + ( k / nTip ) * Math.PI * 2 + rng.gauss() * 0.35;
		let spread = THREE.MathUtils.degToRad( rng.range( angRange[ 0 ], angRange[ 1 ] ) );
		if ( k === 0 && rng.chance( cfg.leaderProb ) ) spread *= 0.32;

		_t2.copy( tip.n ).multiplyScalar( Math.cos( az ) )
			.addScaledVector( _b.crossVectors( tip.d, tip.n ).normalize(), Math.sin( az ) );
		_t3.copy( tip.d ).multiplyScalar( Math.cos( spread ) )
			.addScaledVector( _t2, Math.sin( spread ) ).normalize();

		let cl = len * lenFall * rng.range( 0.80, 1.18 );
		if ( cfg.asym > 0 ) {

			const f = 0.5 + 0.5 * _t3.dot( ctx.leanDir );
			cl *= THREE.MathUtils.lerp( 1 - cfg.asym, 1 + cfg.asym * 0.55, f );

		}

		const rc = Math.min( rEnd * 0.95, rEnd * cRad * ( k === 0 ? 1.14 : 0.93 ) * rng.range( 0.9, 1.1 ) );
		growBranch( W, rng, cfg, ctx, tip.p, _t3, cl, Math.max( rc, 0.006 ), depth + 1, tip.along );

	}

	// side branches along the shaft — this is what stops trees looking like antennae
	const nSide = rng.int2( at( cfg.sideChildren, depth ) );
	for ( let k = 0; k < nSide; k ++ ) {

		const tt = rng.range( 0.30, 0.90 );
		const node = path[ Math.max( 1, Math.min( segs - 1, Math.round( tt * segs ) ) ) ];
		const az = rng.range( 0, Math.PI * 2 );
		const spread = THREE.MathUtils.degToRad( rng.range( angRange[ 0 ] + 18, angRange[ 1 ] + 26 ) );

		_t2.copy( node.n ).multiplyScalar( Math.cos( az ) )
			.addScaledVector( _b.crossVectors( node.d, node.n ).normalize(), Math.sin( az ) );
		_t3.copy( node.d ).multiplyScalar( Math.cos( spread ) )
			.addScaledVector( _t2, Math.sin( spread ) ).normalize();

		let cl = len * lenFall * rng.range( 0.55, 0.85 );
		if ( cfg.asym > 0 ) {

			const f = 0.5 + 0.5 * _t3.dot( ctx.leanDir );
			cl *= THREE.MathUtils.lerp( 1 - cfg.asym, 1 + cfg.asym * 0.55, f );

		}

		const rc = Math.min( node.r * 0.55, node.r * cRad * 0.78 );
		growBranch( W, rng, cfg, ctx, node.p, _t3, cl, Math.max( rc, 0.006 ), depth + 1, node.along );

	}

}

// -----------------------------------------------------------------------------
// 5. makeTree — one unique prototype
// -----------------------------------------------------------------------------

const _cBase = new THREE.Color();
const _cTip  = new THREE.Color();
const _cDead = new THREE.Color();
const _cBl   = new THREE.Color();

export function makeTree( archetype = 'somei', rng = makeRng( 1 ), opts = {} ) {

	const cfg = ARCHETYPES[ archetype ];
	if ( ! cfg ) throw new Error( `sakura: unknown archetype "${archetype}"` );

	const quality      = opts.quality !== undefined ? opts.quality : 1.0;
	const prevailing   = opts.prevailingWind ? opts.prevailingWind.clone().setY( 0 ).normalize()
	                                         : new THREE.Vector3( 1, 0, 0.38 ).normalize();
	const density      = opts.blossomDensity !== undefined ? opts.blossomDensity : 1.0;

	const trunkLen    = rng.range2( cfg.trunkLen );
	const trunkRadius = rng.range2( cfg.trunkRadius );

	// analytic reach estimate drives the flex ramp
	let reach = trunkLen, L = trunkLen;
	for ( let d = 0; d < cfg.maxDepth; d ++ ) { L *= at( cfg.lenFall, d ); reach += L; }

	_cBase.setHex( cfg.barkBase );
	_cTip.setHex( cfg.barkTip );
	_cDead.setHex( cfg.barkDead );

	const ctx = {
		twigs: [],
		budget: Math.max( 12, Math.round( cfg.budget * THREE.MathUtils.clamp( quality, 0.4, 1.4 ) ) ),
		radialScale: THREE.MathUtils.clamp( quality, 0.55, 1.3 ),
		reach,
		rootRadius: trunkRadius * ( 1 + cfg.rootFlare ),
		leanDir: prevailing.clone(),
		cBase: { r: _cBase.r, g: _cBase.g, b: _cBase.b },
		cTip:  { r: _cTip.r,  g: _cTip.g,  b: _cTip.b  },
		cDead: { r: _cDead.r, g: _cDead.g, b: _cDead.b }
	};

	const W = new MeshWriter();

	// trunk starts slightly below origin so the placer can bury the flare
	const startDir = new THREE.Vector3( rng.gauss() * 0.06, 1, rng.gauss() * 0.06 ).normalize();
	growBranch( W, rng, cfg, ctx, new THREE.Vector3( 0, - 0.12, 0 ), startDir,
		trunkLen, trunkRadius, 0, 0 );

	const geometry = W.toGeometry();

	// ---- blossoms -------------------------------------------------------------
	const bo = [], bc = [], bp = [], bl = [];
	const B  = cfg.blossom;

	let sumX = 0, sumY = 0, sumZ = 0, yMin = Infinity, yMax = - Infinity;

	for ( let i = 0; i < ctx.twigs.length; i ++ ) {

		const twig = ctx.twigs[ i ];
		const path = twig.path;
		const clusters = Math.max( 1, Math.round( twig.len * B.density * density * rng.range( 0.7, 1.3 ) ) );

		for ( let c = 0; c < clusters; c ++ ) {

			const t = THREE.MathUtils.lerp( B.start, 1.0, rng.next() );
			const fi = t * ( path.length - 1 );
			const i0 = Math.min( path.length - 1, Math.floor( fi ) );
			const i1 = Math.min( path.length - 1, i0 + 1 );
			const f  = fi - i0;

			_t1.copy( path[ i0 ].p ).lerp( path[ i1 ].p, f );
			const flex = THREE.MathUtils.clamp(
				Math.pow( THREE.MathUtils.clamp( path[ i0 ].along / ctx.reach, 0, 1 ), 1.1 ) * cfg.flexScale,
				0.15, 1.5 );

			const petals = rng.int2( B.cluster );

			for ( let k = 0; k < petals; k ++ ) {

				const px = _t1.x + rng.gauss() * B.spread;
				const py = _t1.y + rng.gauss() * B.spread * 0.85;
				const pz = _t1.z + rng.gauss() * B.spread;

				bo.push( px, py, pz );
				sumX += px; sumY += py; sumZ += pz;
				if ( py < yMin ) yMin = py;
				if ( py > yMax ) yMax = py;

				_cBl.setHSL(
					THREE.MathUtils.euclideanModulo( rng.range2( B.h ), 1 ),
					rng.range2( B.s ),
					rng.range2( B.l ),
					THREE.SRGBColorSpace );
				bc.push( _cBl.r, _cBl.g, _cBl.b );

				// x=size  y=phase  z=flex  w=ao (filled in below)
				bp.push( rng.range2( B.size ), rng.next(), flex, 1.0 );
				bl.push( rng.chance( B.leaf ) ? 1 : 0 );

			}

		}

	}

	const n = bl.length;

	// ---- bake canopy AO + measure the crown -----------------------------------
	let canopyR = 0.001;
	const cx = n ? sumX / n : 0, cy = n ? sumY / n : 0, cz = n ? sumZ / n : 0;

	for ( let i = 0; i < n; i ++ ) {

		const dx = bo[ i * 3 ] - cx, dy = bo[ i * 3 + 1 ] - cy, dz = bo[ i * 3 + 2 ] - cz;
		const dd = Math.hypot( dx, dy, dz );
		if ( dd > canopyR ) canopyR = dd;

	}

	const ySpan = Math.max( 0.001, yMax - yMin );
	for ( let i = 0; i < n; i ++ ) {

		const dx = bo[ i * 3 ] - cx, dy = bo[ i * 3 + 1 ] - cy, dz = bo[ i * 3 + 2 ] - cz;
		const dd = Math.hypot( dx, dy, dz ) / canopyR;
		let ao = THREE.MathUtils.lerp( 0.40, 1.0, THREE.MathUtils.smoothstep( dd, 0.10, 0.85 ) );
		ao *= THREE.MathUtils.lerp( 0.80, 1.10, ( bo[ i * 3 + 1 ] - yMin ) / ySpan );
		bp[ i * 4 + 3 ] = THREE.MathUtils.clamp( ao, 0.25, 1.15 );

	}

	// ---- normalise silhouette height ------------------------------------------
	geometry.computeBoundingBox();
	const bb = geometry.boundingBox;
	const rawH = Math.max( 0.001, Math.max( bb.max.y, yMax ) - Math.min( bb.min.y, yMin ) );
	const target = rng.range2( cfg.heightRange );
	const k = target / rawH;

	if ( Math.abs( k - 1 ) > 0.002 ) {

		geometry.scale( k, k, k );
		const sizeK = Math.pow( k, 0.35 ); // flowers are a fixed real-world size
		for ( let i = 0; i < n; i ++ ) {

			bo[ i * 3 ] *= k; bo[ i * 3 + 1 ] *= k; bo[ i * 3 + 2 ] *= k;
			bp[ i * 4 ] *= sizeK;

		}

	}

	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();

	const canopyCenter = new THREE.Vector3( cx * k, cy * k, cz * k );
	const canopyRadius = canopyR * k;

	// ---- canopy shadow-caster lobes -------------------------------------------
	const lobeGeo = buildCanopyLobes( bo, n, canopyCenter, canopyRadius );

	return {
		archetype,
		geometry,
		lobeGeometry: lobeGeo,
		blossom: {
			offsets: new Float32Array( bo ),
			colors:  new Float32Array( bc ),
			params:  new Float32Array( bp ),
			leaf:    new Float32Array( bl ),
			count:   n
		},
		height: target,
		canopyCenter,
		canopyRadius,
		triangles: geometry.index.count / 3
	};

}

// 2x2x2 spatial buckets over the blossom cloud -> a few soft shadow blobs
function buildCanopyLobes( bo, n, center, radius ) {

	if ( n < 24 || radius <= 0.01 ) return null;

	const cells = new Map();
	for ( let i = 0; i < n; i ++ ) {

		const x = bo[ i * 3 ], y = bo[ i * 3 + 1 ], z = bo[ i * 3 + 2 ];
		const kx = x < center.x ? 0 : 1;
		const ky = y < center.y ? 0 : 1;
		const kz = z < center.z ? 0 : 1;
		const key = kx | ( ky << 1 ) | ( kz << 2 );
		let c = cells.get( key );
		if ( ! c ) { c = { n: 0, x: 0, y: 0, z: 0, r2: 0 }; cells.set( key, c ); }
		c.n ++; c.x += x; c.y += y; c.z += z;

	}

	const lobes = [];
	for ( const c of cells.values() ) {

		if ( c.n < n * 0.06 ) continue;
		c.x /= c.n; c.y /= c.n; c.z /= c.n;
		lobes.push( c );

	}
	if ( lobes.length === 0 ) return null;

	for ( let i = 0; i < n; i ++ ) {

		const x = bo[ i * 3 ], y = bo[ i * 3 + 1 ], z = bo[ i * 3 + 2 ];
		let best = null, bestD = Infinity;
		for ( let j = 0; j < lobes.length; j ++ ) {

			const l = lobes[ j ];
			const d = ( x - l.x ) ** 2 + ( y - l.y ) ** 2 + ( z - l.z ) ** 2;
			if ( d < bestD ) { bestD = d; best = l; }

		}
		if ( best ) best.r2 += bestD;

	}

	const base = new THREE.IcosahedronGeometry( 1, 1 );
	const parts = [];
	for ( let j = 0; j < lobes.length; j ++ ) {

		const l = lobes[ j ];
		const r = Math.sqrt( l.r2 / Math.max( 1, l.n ) ) * 1.15;
		if ( r < radius * 0.10 ) continue;
		const g = base.clone();
		g.scale( r, r * 0.72, r );
		g.translate( l.x, l.y, l.z );
		parts.push( g );

	}
	base.dispose();
	if ( parts.length === 0 ) return null;

	// hand-rolled merge (position only — it is a depth-only proxy)
	let total = 0;
	for ( const g of parts ) total += g.attributes.position.count;
	const pos = new Float32Array( total * 3 );
	const idx = [];
	let vOff = 0, pOff = 0;
	for ( const g of parts ) {

		const a = g.attributes.position.array;
		pos.set( a, pOff );
		pOff += a.length;
		// Not every part geometry is indexed — a non-indexed BufferGeometry has
		// index === null, and assuming otherwise throws on `.count`. Synthesise
		// sequential indices in that case so the merge works either way.
		const gi = g.index;
		if ( gi ) {
			for ( let i = 0; i < gi.count; i ++ ) idx.push( gi.getX( i ) + vOff );
		} else {
			const n = g.attributes.position.count;
			for ( let i = 0; i < n; i ++ ) idx.push( i + vOff );
		}
		vOff += g.attributes.position.count;
		g.dispose();

	}

	const merged = new THREE.BufferGeometry();
	merged.setAttribute( 'position', new THREE.BufferAttribute( pos, 3 ) );
	merged.setIndex( idx );
	merged.computeVertexNormals();
	merged.computeBoundingSphere();
	return merged;

}

// -----------------------------------------------------------------------------
// 6. Materials
// -----------------------------------------------------------------------------

const BARK_VERTEX = /* glsl */`
	vec3 transformed = vec3( position );
	vBarkFlex = aFlex;
	vBarkUv = uv;

	mat4 sakInst = mat4( 1.0 );
	#ifdef USE_INSTANCING
		sakInst = instanceMatrix;
	#endif
	mat4 sakM = modelMatrix * sakInst;

	vec3  sakAxX  = sakM[ 0 ].xyz;
	vec3  sakAxY  = sakM[ 1 ].xyz;
	vec3  sakAxZ  = sakM[ 2 ].xyz;
	float sakScl  = max( length( sakAxX ), 1e-5 );
	vec3  sakBx   = sakAxX / sakScl;
	vec3  sakBy   = sakAxY / max( length( sakAxY ), 1e-5 );
	vec3  sakBz   = sakAxZ / max( length( sakAxZ ), 1e-5 );
	vec3  sakOrg  = sakM[ 3 ].xyz;
	vec3  sakWpos = sakOrg + ( sakBx * transformed.x + sakBy * transformed.y + sakBz * transformed.z ) * sakScl;

	float sakWave = sakuraWindWave( sakWpos );
	float sakGust = sakuraWindGust( sakWpos );
	float sakAmp  = uWindStrength * uBarkSway * aFlex * sakGust;

	vec2  sakAx2  = sakuraWindAxis();
	vec3  sakLat  = vec3( sakAx2.x, 0.0, sakAx2.y );
	vec3  sakSide = vec3( - sakAx2.y, 0.0, sakAx2.x );

	vec3 sakDisp = sakLat * ( sakWave * sakAmp )
	             + sakSide * ( sin( uTime * uWindFreq * 1.63 + sakOrg.x * 0.71 + sakWpos.y * 0.93 ) * sakAmp * 0.34 )
	             - vec3( 0.0, 1.0, 0.0 ) * ( abs( sakWave ) * sakAmp * 0.12 );

	transformed += vec3( dot( sakDisp, sakBx ), dot( sakDisp, sakBy ), dot( sakDisp, sakBz ) ) / sakScl;
`;

const BARK_FRAGMENT = /* glsl */`
	{
		// horizontal lenticel dashes — the signature of Prunus bark
		vec2 gc = vec2( vBarkUv.x * 9.0, vBarkUv.y * 6.5 );
		vec2 cellId = floor( gc );
		vec2 f = fract( gc );
		float rnd = sakBarkHash( cellId );
		float dash = smoothstep( 0.50, 0.16, abs( f.y - 0.5 ) )
		           * smoothstep( 0.02, 0.20, f.x )
		           * smoothstep( 0.99, 0.80, f.x );
		dash *= step( 0.52, rnd );
		diffuseColor.rgb *= mix( 1.0, 0.52, dash * 0.9 );

		// vertical fibre streaks
		float streak = sakBarkHash( vec2( floor( vBarkUv.x * 27.0 ), 3.0 ) );
		diffuseColor.rgb *= 0.88 + 0.26 * streak;

		// moss / lichen collecting on the thick low wood
		float mossy = smoothstep( 0.42, 0.0, vBarkFlex )
		            * smoothstep( 0.40, 0.80, sakBarkHash( cellId * 1.73 + 4.0 ) );
		diffuseColor.rgb = mix( diffuseColor.rgb,
			diffuseColor.rgb * vec3( 0.58, 0.86, 0.52 ) + vec3( 0.006, 0.014, 0.004 ),
			mossy * 0.45 );
	}
`;

function createBarkMaterial( wind ) {

	const mat = new THREE.MeshStandardMaterial( {
		color: 0xffffff,
		vertexColors: true,
		roughness: 0.94,
		metalness: 0.0
	} );

	mat.onBeforeCompile = ( shader ) => {

		for ( const k in wind ) shader.uniforms[ k ] = wind[ k ];

		shader.vertexShader =
			'attribute float aFlex;\nvarying float vBarkFlex;\nvarying vec2 vBarkUv;\n'
			+ WIND_GLSL + '\n' + shader.vertexShader;

		shader.vertexShader = shader.vertexShader.replace( '#include <begin_vertex>', BARK_VERTEX );

		shader.fragmentShader =
			'varying float vBarkFlex;\nvarying vec2 vBarkUv;\n'
			+ 'float sakBarkHash( vec2 p ){ return fract( sin( dot( p, vec2( 27.61, 57.23 ) ) ) * 43758.5453 ); }\n'
			+ shader.fragmentShader;

		shader.fragmentShader = shader.fragmentShader.replace(
			'#include <color_fragment>',
			'#include <color_fragment>\n' + BARK_FRAGMENT );

	};

	mat.customProgramCacheKey = () => 'sakura-bark-v1';

	return mat;

}

const BLOSSOM_VERT = /* glsl */`
#include <common>
#include <fog_pars_vertex>
${WIND_GLSL}

attribute vec3  aOffset;
attribute vec3  aColor;
attribute vec4  aParams;   // x size, y phase, z flex, w ao
attribute float aLeaf;

uniform float uSeason;
uniform float uSizeScale;

varying vec2  vUv2;
varying vec3  vTint;
varying float vAo;
varying float vVariant;
varying float vLeaf;

void main() {

	vec3 worldAnchor = ( modelMatrix * vec4( aOffset, 1.0 ) ).xyz;

	float wave = sakuraWindWave( worldAnchor );
	float gust = sakuraWindGust( worldAnchor );
	float amp  = uWindStrength * uBlossomSway * aParams.z * gust;

	vec2 ax2   = sakuraWindAxis();
	vec3 lat   = vec3( ax2.x, 0.0, ax2.y );
	vec3 side  = vec3( - ax2.y, 0.0, ax2.x );

	worldAnchor += lat  * ( wave * amp );
	worldAnchor += side * ( sin( uTime * uWindFreq * 1.9 + aParams.y * 6.2831853 ) * amp * 0.30 );
	worldAnchor.y -= abs( wave ) * amp * 0.11;

	vec4 mvPosition = viewMatrix * vec4( worldAnchor, 1.0 );

	float leafRoll   = fract( aParams.y * 17.13 );
	float seasonLeaf = step( mix( 1.10, 0.15, uSeason ), leafRoll );
	vLeaf = clamp( aLeaf + seasonLeaf, 0.0, 1.0 );

	float size = aParams.x * uSizeScale * mix( 1.0, 0.74, smoothstep( 0.30, 1.0, uSeason ) );
	size *= mix( 1.0, 1.25, vLeaf );

	float rot = aParams.y * 6.2831853 + wave * amp * 0.55;
	float cr  = cos( rot ), sr = sin( rot );
	vec2  cn  = position.xy;
	mvPosition.xy += vec2( cn.x * cr - cn.y * sr, cn.x * sr + cn.y * cr ) * size;

	gl_Position = projectionMatrix * mvPosition;

	vUv2     = uv;
	vTint    = aColor;
	vAo      = aParams.w;
	vVariant = aParams.y;

	#include <fog_vertex>
}
`;

const BLOSSOM_FRAG = /* glsl */`
#include <common>
#include <fog_pars_fragment>

uniform vec3  uSunDir;         // world-space direction TOWARD the sun
uniform vec3  uSunColor;
uniform vec3  uAmbientSky;
uniform vec3  uAmbientGround;
uniform float uSeason;
uniform float uAlphaTest;
uniform float uBacklight;

varying vec2  vUv2;
varying vec3  vTint;
varying float vAo;
varying float vVariant;
varying float vLeaf;

void main() {

	vec2  p = vUv2 * 2.0 - 1.0;
	float r = length( p );
	if ( r > 1.0 ) discard;

	float a = atan( p.y, p.x );

	float alpha;
	vec3  tint;

	if ( vLeaf > 0.5 ) {

		// simple lanceolate leaf
		float rot = vVariant * 6.2831853;
		vec2 lp = vec2( p.x * cos( rot ) - p.y * sin( rot ), p.x * sin( rot ) + p.y * cos( rot ) );
		lp.x *= 2.15;
		float lr = length( lp ) + 0.22 * abs( lp.x );
		alpha = 1.0 - smoothstep( 0.70, 0.92, lr );
		float vein = smoothstep( 0.05, 0.0, abs( lp.y ) );
		tint = mix( vec3( 0.055, 0.150, 0.038 ), vec3( 0.170, 0.300, 0.070 ), 0.5 + 0.5 * lp.y );
		tint = mix( tint, tint * 1.5, vein * 0.6 );
		tint = mix( tint, vec3( 0.28, 0.20, 0.06 ), uSeason * 0.45 );

	} else {

		// 5-petal rosette: abs(cos(2.5*theta)) has exactly five lobes over 2*PI
		float lob = abs( cos( 2.5 * a + vVariant * 3.1416 ) );
		float R   = mix( 0.50, 1.0, pow( lob, 0.55 ) );
		R -= 0.14 * smoothstep( 0.90, 1.0, lob );           // notched petal tip
		alpha = 1.0 - smoothstep( R - 0.14, R, r );

		float core = 1.0 - smoothstep( 0.04, 0.21, r );
		vec3 deep  = vTint * vec3( 0.95, 0.58, 0.70 );      // pinker toward the throat
		tint = mix( vTint, deep, smoothstep( 0.90, 0.05, r ) * 0.78 );
		tint = mix( tint, vec3( 1.00, 0.76, 0.30 ), core * 0.80 );

		// faint radial veins along each petal seam
		tint *= 1.0 - 0.10 * smoothstep( 0.78, 1.0, abs( sin( 2.5 * a + vVariant * 3.1416 ) ) );

		// late season: petals redden and bruise
		tint = mix( tint, tint * vec3( 1.02, 0.78, 0.84 ), uSeason * 0.55 );

	}

	// fake spherical normal so a flat quad shades like a little dome
	float rc = min( r, 1.0 );
	vec3 nView = normalize( vec3( p.x * 0.78, p.y * 0.78, sqrt( max( 0.0, 1.0 - rc * rc ) ) * 0.9 + 0.30 ) );
	vec3 sunView = normalize( ( viewMatrix * vec4( uSunDir, 0.0 ) ).xyz );

	float ndl  = dot( nView, sunView );
	float diff = smoothstep( - 0.55, 0.90, ndl );

	// petals are ~paper thin: when the sun is behind them they glow. This is the
	// single term that makes sunrise / sunset read.
	float back = pow( clamp( - sunView.z, 0.0, 1.0 ), 1.5 )
	           * pow( clamp( 1.0 - abs( ndl ), 0.0, 1.0 ), 1.1 );

	vec3 sky = mix( uAmbientGround, uAmbientSky, clamp( nView.y * 0.5 + 0.5, 0.0, 1.0 ) );
	vec3 lit = tint * ( sky * vAo + uSunColor * ( diff * 0.95 * vAo + back * uBacklight ) );

	gl_FragColor = vec4( lit, alpha );
	if ( gl_FragColor.a < uAlphaTest ) discard;

	#include <tonemapping_fragment>
	#include <colorspace_fragment>
	#include <fog_fragment>
}
`;

function createBlossomMaterial( wind ) {

	const uniforms = Object.assign(
		THREE.UniformsUtils.clone( THREE.UniformsLib.fog ),
		{
			uSunDir:        { value: new THREE.Vector3( 0.42, 0.72, 0.55 ).normalize() },
			uSunColor:      { value: new THREE.Color( 1.65, 1.52, 1.34 ) },
			uAmbientSky:    { value: new THREE.Color( 0.30, 0.38, 0.50 ) },
			uAmbientGround: { value: new THREE.Color( 0.14, 0.15, 0.11 ) },
			uSeason:        { value: 0.0 },
			uAlphaTest:     { value: 0.38 },
			uSizeScale:     { value: 1.0 },
			uBacklight:     { value: 1.35 }
		},
		wind // by reference — shared with bark and (ideally) grass
	);

	const mat = new THREE.ShaderMaterial( {
		uniforms,
		vertexShader: BLOSSOM_VERT,
		fragmentShader: BLOSSOM_FRAG,
		side: THREE.DoubleSide,
		transparent: false,
		depthWrite: true,
		depthTest: true,
		fog: true
	} );

	mat.alphaToCoverage = true; // soft edges when the renderer has MSAA, free otherwise

	return mat;

}

// -----------------------------------------------------------------------------
// 7. createSakuraForest
// -----------------------------------------------------------------------------

export function createSakuraForest( options = {} ) {

	const o = Object.assign( {
		seed: 20240401,
		count: 180,
		radius: 120,
		center: [ 0, 0 ],
		bounds: null,                       // {minX,maxX,minZ,maxZ} overrides radius
		heightAt: () => 0,
		slopeAt:  () => 0,                  // expected 0..1
		isLand:   () => true,
		minAltitude: 0.4,
		maxAltitude: Infinity,
		maxSlope: 0.55,
		minSpacing: 3.2,
		windUniforms: null,
		prevailingWind: new THREE.Vector3( 1, 0, 0.38 ),
		quality: 1.0,
		blossomDensity: 1.0,
		blossomChunks: 4,
		terrainAlign: 0.35,
		castShadow: true,
		receiveShadow: true,
		canopyShadows: true,
		// Big massifs with real clearings between them: lower frequency = larger
		// coherent groves, higher contrast = the sparse zones actually go sparse
		// instead of everywhere being a uniform sprinkle.
		groveScale: 0.018,
		groveContrast: 0.85,
		keepBlossomSamples: true,
		prototypeCounts: { somei: 4, shidare: 3, windswept: 3, ancient: 3, young: 3 },
		weights: { somei: 0.38, shidare: 0.16, windswept: 0.14, ancient: 0.12, young: 0.20 }
	}, options );

	const rng  = makeRng( o.seed );
	const wind = ensureWindUniforms( o.windUniforms );
	const prevailing = o.prevailingWind.clone().setY( 0 );
	if ( prevailing.lengthSq() < 1e-8 ) prevailing.set( 1, 0, 0 );
	prevailing.normalize();

	const group = new THREE.Group();
	group.name = 'sakuraForest';

	// ---- 1. build unique prototypes -------------------------------------------
	const prototypes = [];
	for ( const name of ARCHETYPE_NAMES ) {

		const n = o.prototypeCounts[ name ] || 0;
		for ( let i = 0; i < n; i ++ ) {

			prototypes.push( makeTree( name, rng, {
				quality: o.quality,
				prevailingWind: prevailing,
				blossomDensity: o.blossomDensity
			} ) );

		}

	}

	const byArchetype = {};
	for ( let i = 0; i < prototypes.length; i ++ ) {

		const a = prototypes[ i ].archetype;
		( byArchetype[ a ] || ( byArchetype[ a ] = [] ) ).push( i );

	}

	// ---- 2. place instances ----------------------------------------------------
	const minX = o.bounds ? o.bounds.minX : o.center[ 0 ] - o.radius;
	const maxX = o.bounds ? o.bounds.maxX : o.center[ 0 ] + o.radius;
	const minZ = o.bounds ? o.bounds.minZ : o.center[ 1 ] - o.radius;
	const maxZ = o.bounds ? o.bounds.maxZ : o.center[ 1 ] + o.radius;

	const cell = o.minSpacing;
	const grid = new Map();
	const key = ( gx, gz ) => gx * 73856093 ^ gz * 19349663;

	function tooClose( x, z, spacing ) {

		const gx = Math.floor( x / cell ), gz = Math.floor( z / cell );
		const s2 = spacing * spacing;
		for ( let a = - 1; a <= 1; a ++ ) for ( let b = - 1; b <= 1; b ++ ) {

			const arr = grid.get( key( gx + a, gz + b ) );
			if ( ! arr ) continue;
			for ( let i = 0; i < arr.length; i += 2 ) {

				const dx = arr[ i ] - x, dz = arr[ i + 1 ] - z;
				if ( dx * dx + dz * dz < s2 ) return true;

			}

		}
		return false;

	}

	function addToGrid( x, z ) {

		const k = key( Math.floor( x / cell ), Math.floor( z / cell ) );
		let arr = grid.get( k );
		if ( ! arr ) { arr = []; grid.set( k, arr ); }
		arr.push( x, z );

	}

	const archetypeList = ARCHETYPE_NAMES.filter( n => ( byArchetype[ n ] || [] ).length > 0 );
	let weightSum = 0;
	for ( const n of archetypeList ) weightSum += ( o.weights[ n ] || 0 );

	function pickArchetype( ctxFlags, r ) {

		let t = r * weightSum;
		for ( const n of archetypeList ) {

			let w = o.weights[ n ] || 0;
			if ( ctxFlags.coastal && n === 'windswept' ) w *= 3.4;
			if ( ctxFlags.coastal && n === 'shidare' )   w *= 0.35;
			if ( ctxFlags.steep   && n === 'ancient' )   w *= 1.8;
			if ( ctxFlags.steep   && n === 'somei' )     w *= 0.6;
			if ( ctxFlags.high    && n === 'young' )     w *= 1.7;
			t -= w;
			if ( t <= 0 ) return n;

		}
		return archetypeList[ archetypeList.length - 1 ];

	}

	const placements = [];
	const perProto = prototypes.map( () => [] );
	const attemptsMax = o.count * 60;
	const UPV = new THREE.Vector3( 0, 1, 0 );
	const qTilt = new THREE.Quaternion();
	const qYaw  = new THREE.Quaternion();
	const qLean = new THREE.Quaternion();
	const nrm   = new THREE.Vector3();
	const axis  = new THREE.Vector3();

	let attempts = 0;
	while ( placements.length < o.count && attempts < attemptsMax ) {

		attempts ++;
		const relax = attempts / attemptsMax;

		const x = minX + rng.next() * ( maxX - minX );
		const z = minZ + rng.next() * ( maxZ - minZ );

		if ( ! o.bounds ) {

			const dx = x - o.center[ 0 ], dz = z - o.center[ 1 ];
			if ( dx * dx + dz * dz > o.radius * o.radius ) continue;

		}

		if ( ! o.isLand( x, z ) ) continue;

		const h = o.heightAt( x, z );
		if ( h < o.minAltitude || h > o.maxAltitude ) continue;

		const slope = Math.abs( o.slopeAt( x, z ) );
		if ( slope > o.maxSlope ) continue;

		// groves instead of a uniform sprinkle
		const g = fbm2( x * o.groveScale, z * o.groveScale, o.seed ^ 0x51ed, 3 );
		const accept = THREE.MathUtils.lerp( 1.0, THREE.MathUtils.smoothstep( g, 0.34, 0.72 ),
			o.groveContrast * ( 1 - relax * 0.8 ) );
		if ( rng.next() > accept ) continue;

		// coastal / steep / high context
		let coastal = false;
		for ( let a = 0; a < 4; a ++ ) {

			const ang = a * Math.PI * 0.5;
			if ( ! o.isLand( x + Math.cos( ang ) * 9, z + Math.sin( ang ) * 9 ) ) { coastal = true; break; }

		}
		const flags = { coastal, steep: slope > o.maxSlope * 0.62, high: h > o.minAltitude + 14 };

		const archetype = pickArchetype( flags, rng.next() );
		const pool = byArchetype[ archetype ];
		const pi = pool[ Math.min( pool.length - 1, Math.floor( rng.next() * pool.length ) ) ];
		const proto = prototypes[ pi ];

		const scale = rng.range( 0.84, 1.20 ) * ( flags.high ? 0.82 : 1.0 );
		const spacing = Math.max( o.minSpacing, proto.canopyRadius * scale * 0.86 );
		if ( tooClose( x, z, spacing * ( 1 - relax * 0.45 ) ) ) continue;

		// orientation: terrain tilt -> downwind lean -> yaw
		const eps = 0.7;
		nrm.set(
			o.heightAt( x - eps, z ) - o.heightAt( x + eps, z ),
			2 * eps,
			o.heightAt( x, z - eps ) - o.heightAt( x, z + eps )
		).normalize();

		_t1.set( 0, 1, 0 ).lerp( nrm, o.terrainAlign ).normalize();
		qTilt.setFromUnitVectors( UPV, _t1 );

		const leanAngle = ( archetype === 'windswept' ? rng.range( 0.10, 0.22 ) : rng.range( 0.0, 0.05 ) )
			* ( flags.coastal ? 1.35 : 1.0 );
		axis.crossVectors( UPV, prevailing );
		if ( axis.lengthSq() < 1e-8 ) axis.set( 1, 0, 0 );
		axis.normalize();
		qLean.setFromAxisAngle( axis, leanAngle );

		qYaw.setFromAxisAngle( UPV, rng.range( 0, Math.PI * 2 ) );

		const quat = qLean.clone().multiply( qTilt ).multiply( qYaw );
		const pos = new THREE.Vector3( x, h - 0.10 * scale, z );

		addToGrid( x, z );

		const rec = { position: pos, quaternion: quat, scale, protoIndex: pi, archetype };
		placements.push( rec );
		perProto[ pi ].push( rec );

	}

	// ---- 3. bark instanced meshes ---------------------------------------------
	const barkMaterial = createBarkMaterial( wind );
	const barkMeshes = [];
	const mat4 = new THREE.Matrix4();
	const scl  = new THREE.Vector3();

	for ( let pi = 0; pi < prototypes.length; pi ++ ) {

		const list = perProto[ pi ];
		if ( list.length === 0 ) continue;

		const im = new THREE.InstancedMesh( prototypes[ pi ].geometry, barkMaterial, list.length );
		im.name = 'sakuraBark_' + prototypes[ pi ].archetype + '_' + pi;
		im.castShadow = o.castShadow;
		im.receiveShadow = o.receiveShadow;

		for ( let i = 0; i < list.length; i ++ ) {

			const r = list[ i ];
			scl.set( r.scale, r.scale, r.scale );
			mat4.compose( r.position, r.quaternion, scl );
			im.setMatrixAt( i, mat4 );

		}
		im.instanceMatrix.needsUpdate = true;
		im.computeBoundingSphere();
		group.add( im );
		barkMeshes.push( im );

	}

	// ---- 4. canopy shadow proxies ---------------------------------------------
	const lobeMeshes = [];
	let lobeMaterial = null;

	if ( o.canopyShadows && o.castShadow ) {

		lobeMaterial = new THREE.MeshBasicMaterial( {
			colorWrite: false,   // invisible in the beauty pass...
			depthWrite: false,
			depthTest: true
		} );
		lobeMaterial.name = 'sakuraCanopyProxy';

		for ( let pi = 0; pi < prototypes.length; pi ++ ) {

			const list = perProto[ pi ];
			const lg = prototypes[ pi ].lobeGeometry;
			if ( list.length === 0 || ! lg ) continue;

			const im = new THREE.InstancedMesh( lg, lobeMaterial, list.length );
			im.name = 'sakuraCanopyProxy_' + pi;
			im.castShadow = true;      // ...but it still casts a soft dappled shadow
			im.receiveShadow = false;

			for ( let i = 0; i < list.length; i ++ ) {

				const r = list[ i ];
				scl.set( r.scale, r.scale, r.scale );
				mat4.compose( r.position, r.quaternion, scl );
				im.setMatrixAt( i, mat4 );

			}
			im.instanceMatrix.needsUpdate = true;
			im.computeBoundingSphere();
			group.add( im );
			lobeMeshes.push( im );

		}

	}

	// ---- 5. blossoms: bake to world space, bucket spatially, one material -----
	let totalBlossoms = 0;
	for ( const r of placements ) totalBlossoms += prototypes[ r.protoIndex ].blossom.count;

	const chunkN = Math.max( 1, o.blossomChunks | 0 );
	const buckets = [];
	for ( let i = 0; i < chunkN * chunkN; i ++ ) {

		buckets.push( { off: [], col: [], par: [], leaf: [] } );

	}

	const spanX = Math.max( 1e-3, maxX - minX );
	const spanZ = Math.max( 1e-3, maxZ - minZ );
	const tmp = new THREE.Vector3();

	for ( let r = 0; r < placements.length; r ++ ) {

		const rec = placements[ r ];
		const proto = prototypes[ rec.protoIndex ];
		const bl = proto.blossom;
		if ( bl.count === 0 ) continue;

		scl.set( rec.scale, rec.scale, rec.scale );
		mat4.compose( rec.position, rec.quaternion, scl );

		const bx = THREE.MathUtils.clamp( Math.floor( ( rec.position.x - minX ) / spanX * chunkN ), 0, chunkN - 1 );
		const bz = THREE.MathUtils.clamp( Math.floor( ( rec.position.z - minZ ) / spanZ * chunkN ), 0, chunkN - 1 );
		const bucket = buckets[ bz * chunkN + bx ];

		for ( let i = 0; i < bl.count; i ++ ) {

			tmp.set( bl.offsets[ i * 3 ], bl.offsets[ i * 3 + 1 ], bl.offsets[ i * 3 + 2 ] )
				.applyMatrix4( mat4 );
			bucket.off.push( tmp.x, tmp.y, tmp.z );
			bucket.col.push( bl.colors[ i * 3 ], bl.colors[ i * 3 + 1 ], bl.colors[ i * 3 + 2 ] );
			bucket.par.push(
				bl.params[ i * 4 ] * rec.scale,
				// decorrelate the phase per tree so neighbours never pulse together
				THREE.MathUtils.euclideanModulo( bl.params[ i * 4 + 1 ] + r * 0.6180339887, 1 ),
				bl.params[ i * 4 + 2 ],
				bl.params[ i * 4 + 3 ]
			);
			bucket.leaf.push( bl.leaf[ i ] );

		}

	}

	// shared unit quad
	const quadPos = new THREE.BufferAttribute( new Float32Array( [
		- 0.5, - 0.5, 0,   0.5, - 0.5, 0,   0.5, 0.5, 0,   - 0.5, 0.5, 0
	] ), 3 );
	const quadUv = new THREE.BufferAttribute( new Float32Array( [
		0, 0,  1, 0,  1, 1,  0, 1
	] ), 2 );
	const quadIdx = new THREE.BufferAttribute( new Uint16Array( [ 0, 1, 2, 0, 2, 3 ] ), 1 );

	const blossomMaterial = createBlossomMaterial( wind );
	const blossomMeshes = [];
	let maxBlossomSize = 0.3;

	for ( let bi = 0; bi < buckets.length; bi ++ ) {

		const bkt = buckets[ bi ];
		const n = bkt.leaf.length;
		if ( n === 0 ) continue;

		const geo = new THREE.InstancedBufferGeometry();
		geo.setAttribute( 'position', quadPos );
		geo.setAttribute( 'uv', quadUv );
		geo.setIndex( quadIdx );
		geo.setAttribute( 'aOffset', new THREE.InstancedBufferAttribute( new Float32Array( bkt.off ), 3 ) );
		geo.setAttribute( 'aColor',  new THREE.InstancedBufferAttribute( new Float32Array( bkt.col ), 3 ) );
		geo.setAttribute( 'aParams', new THREE.InstancedBufferAttribute( new Float32Array( bkt.par ), 4 ) );
		geo.setAttribute( 'aLeaf',   new THREE.InstancedBufferAttribute( new Float32Array( bkt.leaf ), 1 ) );
		geo.instanceCount = n;

		// CRITICAL: the auto bounding sphere would only cover the unit quad, so the
		// whole chunk would be culled the moment its origin left the frustum.
		let cx = 0, cy = 0, cz = 0, sMax = 0;
		for ( let i = 0; i < n; i ++ ) {

			cx += bkt.off[ i * 3 ]; cy += bkt.off[ i * 3 + 1 ]; cz += bkt.off[ i * 3 + 2 ];
			if ( bkt.par[ i * 4 ] > sMax ) sMax = bkt.par[ i * 4 ];

		}
		cx /= n; cy /= n; cz /= n;
		let rad = 0;
		for ( let i = 0; i < n; i ++ ) {

			const dx = bkt.off[ i * 3 ] - cx, dy = bkt.off[ i * 3 + 1 ] - cy, dz = bkt.off[ i * 3 + 2 ] - cz;
			const d = dx * dx + dy * dy + dz * dz;
			if ( d > rad ) rad = d;

		}
		maxBlossomSize = Math.max( maxBlossomSize, sMax );
		geo.boundingSphere = new THREE.Sphere(
			new THREE.Vector3( cx, cy, cz ),
			Math.sqrt( rad ) + sMax * 1.6 + 1.2   // + wind sway headroom
		);

		const mesh = new THREE.Mesh( geo, blossomMaterial );
		mesh.name = 'sakuraBlossoms_' + bi;
		mesh.castShadow = false;
		mesh.receiveShadow = false;
		mesh.renderOrder = 1;
		group.add( mesh );
		blossomMeshes.push( mesh );

	}

	// ---- 6. blossom sample cloud for the falling-petal emitter ----------------
	let sampleCloud = null;
	if ( o.keepBlossomSamples && totalBlossoms > 0 ) {

		const pos = new Float32Array( totalBlossoms * 3 );
		const col = new Float32Array( totalBlossoms * 3 );
		let w = 0;
		for ( const bkt of buckets ) {

			for ( let i = 0; i < bkt.leaf.length; i ++ ) {

				if ( bkt.leaf[ i ] > 0.5 ) continue;
				pos[ w * 3 ] = bkt.off[ i * 3 ];
				pos[ w * 3 + 1 ] = bkt.off[ i * 3 + 1 ];
				pos[ w * 3 + 2 ] = bkt.off[ i * 3 + 2 ];
				col[ w * 3 ] = bkt.col[ i * 3 ];
				col[ w * 3 + 1 ] = bkt.col[ i * 3 + 1 ];
				col[ w * 3 + 2 ] = bkt.col[ i * 3 + 2 ];
				w ++;

			}

		}
		sampleCloud = { positions: pos, colors: col, count: w };

	}

	// ---- 7. public API ---------------------------------------------------------
	function readWind( src, uKey, plainKey ) {

		if ( ! src ) return undefined;
		const u = src[ uKey ];
		if ( u && typeof u === 'object' && 'value' in u ) return u.value;
		if ( plainKey !== undefined && src[ plainKey ] !== undefined ) return src[ plainKey ];
		return undefined;

	}

	function update( time, windSrc ) {

		wind.uTime.value = time;

		if ( windSrc && windSrc !== wind ) {

			const dir = readWind( windSrc, 'uWindDir', 'direction' );
			if ( dir && dir.isVector3 ) {

				wind.uWindDir.value.set( dir.x, 0, dir.z );
				if ( wind.uWindDir.value.lengthSq() < 1e-8 ) wind.uWindDir.value.set( 1, 0, 0 );
				wind.uWindDir.value.normalize();

			}

			const st = readWind( windSrc, 'uWindStrength', 'strength' );
			if ( st !== undefined ) wind.uWindStrength.value = st;

			const fq = readWind( windSrc, 'uWindFreq', 'frequency' );
			if ( fq !== undefined ) wind.uWindFreq.value = fq;

			const gs = readWind( windSrc, 'uGustScale', 'gustScale' );
			if ( gs !== undefined ) wind.uGustScale.value = gs;

		}

	}

	const _c = new THREE.Color();

	function setEnvironment( env = {} ) {

		const u = blossomMaterial.uniforms;

		if ( env.sunDirection ) {

			u.uSunDir.value.copy( env.sunDirection ).normalize();

		}

		if ( env.sunColor !== undefined ) {

			if ( env.sunColor.isColor ) _c.copy( env.sunColor ); else _c.setHex( env.sunColor );
			const k = env.sunIntensity !== undefined ? env.sunIntensity : 1.0;
			u.uSunColor.value.setRGB( _c.r * k, _c.g * k, _c.b * k );

		} else if ( env.sunIntensity !== undefined ) {

			const cur = u.uSunColor.value;
			const m = Math.max( 1e-4, Math.max( cur.r, cur.g, cur.b ) );
			u.uSunColor.value.setRGB(
				cur.r / m * env.sunIntensity, cur.g / m * env.sunIntensity, cur.b / m * env.sunIntensity );

		}

		if ( env.ambientSky !== undefined ) {

			if ( env.ambientSky.isColor ) _c.copy( env.ambientSky ); else _c.setHex( env.ambientSky );
			const k = env.ambientIntensity !== undefined ? env.ambientIntensity : 1.0;
			u.uAmbientSky.value.setRGB( _c.r * k, _c.g * k, _c.b * k );

		}

		if ( env.ambientGround !== undefined ) {

			if ( env.ambientGround.isColor ) _c.copy( env.ambientGround ); else _c.setHex( env.ambientGround );
			const k = env.ambientIntensity !== undefined ? env.ambientIntensity : 1.0;
			u.uAmbientGround.value.setRGB( _c.r * k, _c.g * k, _c.b * k );

		}

		if ( env.backlight !== undefined ) u.uBacklight.value = env.backlight;

	}

	function setSeason( v ) {

		blossomMaterial.uniforms.uSeason.value = THREE.MathUtils.clamp( v, 0, 1 );

	}

	function getBlossomSamples( n, seed = 12345 ) {

		if ( ! sampleCloud || sampleCloud.count === 0 ) {

			return { positions: new Float32Array( 0 ), colors: new Float32Array( 0 ), count: 0 };

		}

		const r = mulberry32( seed >>> 0 );
		const cnt = Math.min( n, sampleCloud.count );
		const pos = new Float32Array( cnt * 3 );
		const col = new Float32Array( cnt * 3 );

		for ( let i = 0; i < cnt; i ++ ) {

			const j = Math.min( sampleCloud.count - 1, Math.floor( r() * sampleCloud.count ) );
			pos[ i * 3 ] = sampleCloud.positions[ j * 3 ];
			pos[ i * 3 + 1 ] = sampleCloud.positions[ j * 3 + 1 ];
			pos[ i * 3 + 2 ] = sampleCloud.positions[ j * 3 + 2 ];
			col[ i * 3 ] = sampleCloud.colors[ j * 3 ];
			col[ i * 3 + 1 ] = sampleCloud.colors[ j * 3 + 1 ];
			col[ i * 3 + 2 ] = sampleCloud.colors[ j * 3 + 2 ];

		}

		return { positions: pos, colors: col, count: cnt };

	}

	function dispose() {

		for ( const p of prototypes ) {

			p.geometry.dispose();
			if ( p.lobeGeometry ) p.lobeGeometry.dispose();

		}
		for ( const m of blossomMeshes ) m.geometry.dispose();
		barkMaterial.dispose();
		blossomMaterial.dispose();
		if ( lobeMaterial ) lobeMaterial.dispose();

	}

	let triTotal = 0;
	for ( const r of placements ) triTotal += prototypes[ r.protoIndex ].triangles;

	return {
		group,
		update,
		setEnvironment,
		setSeason,
		getBlossomSamples,
		windUniforms: wind,
		barkMaterial,
		blossomMaterial,
		prototypes,
		instances: placements,
		emitters: placements.map( r => {

			const p = prototypes[ r.protoIndex ];
			return {
				position: new THREE.Vector3().copy( p.canopyCenter )
					.applyQuaternion( r.quaternion ).multiplyScalar( r.scale ).add( r.position ),
				radius: p.canopyRadius * r.scale,
				archetype: r.archetype
			};

		} ),
		stats: {
			prototypes: prototypes.length,
			trees: placements.length,
			blossoms: totalBlossoms,
			barkTriangles: triTotal,
			drawCalls: barkMeshes.length + blossomMeshes.length + lobeMeshes.length,
			placementAttempts: attempts
		},
		dispose
	};

}
