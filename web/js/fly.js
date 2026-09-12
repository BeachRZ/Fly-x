/* A fruit fly with a jointed skeleton, for the FLY X crew.
 *
 * Body frame: +X toward the head, +Y the back (dorsal), +Z the fly's right.
 *
 * Each leg is one chain -- coxa, femur, tibia, tarsus -- where every segment
 * hangs off the joint before it and every joint is a ball, so the leg can bend
 * any way without coming apart. Legs are posed by inverse kinematics: give a leg
 * a point to hold (a lever grip, an armrest, the seat edge) and the femur and
 * tibia bend to reach it, the knee toward a pole direction.
 *
 * Proportions follow Drosophila melanogaster: big red compound eyes, a humped
 * bristly thorax, a banded abdomen, wings longer than the body.
 *
 * SEAT describes the chair every fly sits in, in this same body frame, so the
 * caller can build a chair that fits: a seated fly has its body axis upright,
 * the tip of its abdomen on the cushion and its back against the backrest.
 */

import * as THREE from 'three';

const LEG_SPEC = {
	L1: { at: [0.78, -0.72, -0.40], len: [0.45, 1.45, 1.35, 1.2], pole: [0.4, 0.3, -1], coxa: 0.35 },
	L2: { at: [0.08, -0.84, -0.50], len: [0.40, 1.60, 1.65, 1.3], pole: [0.0, 0.7, -1], coxa: 0.30 },
	L3: { at: [-0.62, -0.78, -0.44], len: [0.45, 1.75, 1.80, 1.25], pole: [-0.4, 0.7, -1], coxa: 0.30 },
};
for (const k of ['1', '2', '3']) {
	const l = LEG_SPEC['L' + k];
	LEG_SPEC['R' + k] = { ...l, at: [l.at[0], l.at[1], -l.at[2]], pole: [l.pole[0], l.pole[1], -l.pole[2]] };
}
export const LEG_NAMES = ['L1', 'L2', 'L3', 'R1', 'R2', 'R3'];

export const SEAT = {
	cushionX: -4.75,          // seat surface, across the body axis
	backY: 1.5,               // front face of the backrest
	halfWidth: 1.9,
	armZ: 2.15, armX: -2.35,  // armrests: side offset and height
	rest: {
		L1: [-2.2, -2.3, -2.05], R1: [-2.2, -2.3, 2.05],
		L2: [-2.2, -0.9, -2.1], R2: [-2.2, -0.9, 2.1],
		L3: [-4.55, -2.55, -1.0], R3: [-4.55, -2.55, 1.0],
	},
};

const TARSUS_CURL = -0.55;       // total bend over the tarsal segments

export function createFly({ scale = 1, tint = 0xa47a4a, detail = 'high' } = {}) {
	const high = detail === 'high';
	const root = new THREE.Group();
	root.scale.setScalar(scale);
	const body = new THREE.Group();
	root.add(body);

	const base = new THREE.Color(tint);
	const chitin = new THREE.MeshPhongMaterial({ color: base, specular: 0x554433, shininess: 38 });
	const chitinDark = new THREE.MeshPhongMaterial({
		color: base.clone().multiplyScalar(0.55), specular: 0x332a20, shininess: 30,
	});
	const legMat = new THREE.MeshPhongMaterial({ color: base.clone().multiplyScalar(0.42), specular: 0x2a2218, shininess: 24 });
	const bristleMat = new THREE.MeshBasicMaterial({ color: 0x140e08 });
	const seg = high ? 14 : 9;

	/* thorax: a humped ellipsoid with the scutellum behind and bristles on top */
	const thorax = new THREE.Mesh(new THREE.SphereGeometry(1, seg * 2, seg + 4), chitin);
	thorax.scale.set(1.3, 1.08, 1.02);
	body.add(thorax);
	const scutellum = new THREE.Mesh(new THREE.SphereGeometry(0.55, seg, seg), chitin);
	scutellum.scale.set(0.9, 0.55, 1.1);
	scutellum.position.set(-1.05, 0.72, 0);
	body.add(scutellum);
	if (high) {
		const bristle = new THREE.CylinderGeometry(0.012, 0.035, 0.75, 5);
		bristle.translate(0, 0.375, 0);
		for (const [x, z] of [[0.85, 0.35], [0.4, 0.75], [0.1, 0.35], [-0.35, 0.8], [-0.6, 0.3], [-1.15, 0.35]]) {
			for (const s of [-1, 1]) {
				const b = new THREE.Mesh(bristle, bristleMat);
				const y = 1.08 * Math.sqrt(Math.max(0.05, 1 - (x / 1.3) ** 2 - (z / 1.02) ** 2));
				b.position.set(x, y - 0.03, s * z);
				b.rotation.set(s * 0.25, 0, 0.95);          // swept back
				body.add(b);
			}
		}
	}

	/* abdomen: a lathe with its tergites banded, darker toward the tip */
	const prof = [];
	for (let i = 0; i <= 24; i++) {
		const s = i / 24;
		prof.push(new THREE.Vector2(Math.max(0.001, 1.02 * Math.pow(Math.sin(Math.PI * (0.13 + 0.87 * s)), 0.7)), 3.35 * s));
	}
	const abdomen = new THREE.Mesh(new THREE.LatheGeometry(prof, seg * 2),
		new THREE.MeshPhongMaterial({ map: bandTexture(tint), specular: 0x443322, shininess: 34 }));
	abdomen.rotation.z = Math.PI / 2;                    // lathe axis +Y -> body -X
	abdomen.position.set(-1.15, -0.05, 0);
	abdomen.scale.set(1, 1, 0.95);
	body.add(abdomen);

	/* head */
	const head = new THREE.Group();
	head.position.set(1.72, 0.18, 0);
	body.add(head);
	const skull = new THREE.Mesh(new THREE.SphereGeometry(0.78, seg * 2, seg), chitin);
	skull.scale.set(0.82, 1, 1.12);
	head.add(skull);
	const eyeMat = new THREE.MeshPhongMaterial({ map: facetTexture(), specular: 0xffc0a0, shininess: 70 });
	for (const s of [-1, 1]) {
		const eye = new THREE.Mesh(new THREE.SphereGeometry(0.6, seg * 2, seg), eyeMat);
		eye.scale.set(0.78, 1.05, 0.62);
		eye.position.set(0.12, 0.08, s * 0.6);
		head.add(eye);
		/* antenna: scape, pedicel, a round funiculus and the feathery arista */
		const ant = new THREE.Group();
		ant.position.set(0.62, 0.12, s * 0.17);
		ant.rotation.set(0, s * 0.35, -0.55);
		head.add(ant);
		const scape = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.18, 6), chitinDark);
		scape.position.y = 0.09;
		ant.add(scape);
		const fun = new THREE.Mesh(new THREE.SphereGeometry(0.11, 8, 6), chitin);
		fun.scale.set(0.8, 1.4, 0.8);
		fun.position.y = 0.3;
		ant.add(fun);
		const arista = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.016, 0.55, 4), bristleMat);
		arista.position.set(0.12, 0.5, 0);
		arista.rotation.z = -0.9;
		ant.add(arista);
		head.userData['ant' + s] = ant;
	}
	for (const [x, z] of [[-0.1, 0], [-0.25, 0.12], [-0.25, -0.12]]) {          // ocelli
		const o = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 4), new THREE.MeshPhongMaterial({ color: 0x5a1a10, shininess: 80 }));
		o.position.set(x, 0.76, z);
		head.add(o);
	}
	const proboscis = new THREE.Mesh(new THREE.CapsuleGeometry(0.1, 0.34, 4, 8), chitinDark);
	proboscis.position.set(0.38, -0.72, 0);
	proboscis.rotation.z = 0.5;
	head.add(proboscis);

	/* wings, with veins, and the halteres behind them */
	const wingMat = new THREE.MeshBasicMaterial({
		map: wingTexture(), transparent: true, side: THREE.DoubleSide, depthWrite: false,
	});
	const wings = [];
	for (const s of [-1, 1]) {
		const shape = new THREE.Shape();
		shape.moveTo(0, 0);
		shape.bezierCurveTo(-1.3, 0.62, -3.5, 0.82, -4.7, 0.16);
		shape.bezierCurveTo(-3.6, -0.55, -1.5, -0.46, 0, 0);
		const g = new THREE.ShapeGeometry(shape, 24);
		fitUV(g);
		const wing = new THREE.Mesh(g, wingMat);
		const pivot = new THREE.Group();
		pivot.position.set(-0.35, 0.86, s * 0.4);
		pivot.rotation.set(-Math.PI / 2 * (s > 0 ? 1 : 1), 0, 0);
		wing.scale.z = 1;
		if (s > 0) wing.scale.y = -1;                          // mirror for the right wing
		pivot.add(wing);
		body.add(pivot);
		wings.push({ pivot, s });
		const halt = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.3, 3, 6), chitinDark);
		halt.position.set(-0.95, 0.35, s * 0.62);
		halt.rotation.set(s * 0.9, 0, 0.3);
		body.add(halt);
		const knob = new THREE.Mesh(new THREE.SphereGeometry(0.075, 8, 6), chitin);
		knob.position.set(-1.0, 0.45, s * 0.78);
		body.add(knob);
	}

	/* legs */
	const legs = {};
	for (const name of LEG_NAMES) legs[name] = buildLeg(name, LEG_SPEC[name], legMat, high);
	for (const name of LEG_NAMES) body.add(legs[name].plane);

	let time = Math.random() * 10, lean = 0;
	const fidget = new Map();          // leg name -> amplitude of idle movement

	function setTarget(name, v) { legs[name].target.copy(v); }
	function setTargetWorld(name, world) {
		body.updateWorldMatrix(true, false);
		legs[name].target.copy(body.worldToLocal(world.clone()));
	}
	function setFidget(name, amp) { fidget.set(name, amp); }
	function seat() {
		for (const name of LEG_NAMES) { legs[name].target.fromArray(SEAT.rest[name]); fidget.set(name, 0.12); }
		for (const w of wings) w.pivot.rotation.set(-Math.PI / 2, w.s * 0.45, 0);
	}
	seat();

	/* active: 0..1 how agitated; lean: -1..1 roll toward the right; look: head yaw. */
	function animate(dt, { active = 0.3, lean: targetLean = 0, look = 0 } = {}) {
		time += dt;
		lean += (targetLean - lean) * Math.min(1, dt * 6);
		body.rotation.x = lean * 0.22;
		head.rotation.y = look * 0.4 + Math.sin(time * 0.6) * 0.08;
		head.rotation.z = Math.sin(time * 0.37) * 0.05;
		for (const s of [-1, 1]) {
			const a = head.userData['ant' + s];
			a.rotation.z = -0.55 + Math.sin(time * (3 + active * 6) + s) * 0.08 * (0.4 + active);
		}
		for (const w of wings) w.pivot.rotation.z = Math.sin(time * 40) * 0.015 * active;
		abdomen.scale.y = 1 + Math.sin(time * 2.2) * 0.02;
		for (const name of LEG_NAMES) {
			const leg = legs[name], amp = fidget.get(name) || 0;
			const k = LEG_NAMES.indexOf(name);
			const wob = amp * (0.3 + active);
			_t.copy(leg.target);
			if (wob) _t.add(_o.set(Math.sin(time * 1.7 + k * 1.3), Math.sin(time * 1.3 + k * 2.1), Math.sin(time * 1.1 + k)).multiplyScalar(wob * 0.3));
			solve(leg, _t);
		}
	}

	return { root, body, head, legs, setTarget, setTargetWorld, setFidget, seat, animate };
}

/* ---------- legs ---------- */

function buildLeg(name, spec, mat, high) {
	const plane = new THREE.Group();
	plane.position.fromArray(spec.at);
	const [lc, lf, lt, lta] = spec.len;
	const joint = (r) => new THREE.Mesh(new THREE.SphereGeometry(r, high ? 10 : 7, high ? 8 : 5), mat);
	const bone = (len, r0, r1) => {
		const g = new THREE.CylinderGeometry(r1, r0, len, high ? 10 : 6, 1);
		g.rotateZ(-Math.PI / 2);          // along +X
		g.translate(len / 2, 0, 0);
		return new THREE.Mesh(g, mat);
	};
	const coxaJ = new THREE.Group();
	plane.add(coxaJ);
	coxaJ.add(joint(0.2), bone(lc, 0.2, 0.15));
	const femurJ = new THREE.Group();
	femurJ.position.x = lc;
	coxaJ.add(femurJ);
	femurJ.add(joint(0.17), bone(lf, 0.17, 0.13));
	const tibiaJ = new THREE.Group();
	tibiaJ.position.x = lf;
	femurJ.add(tibiaJ);
	tibiaJ.add(joint(0.13), bone(lt, 0.12, 0.085));
	/* tarsus: five segments curling a little, with claws at the end */
	const n = high ? 5 : 2;
	let parent = tibiaJ, x = lt;
	const segLen = lta / n;
	const end = new THREE.Vector2(0, 0);
	let ang = 0;
	for (let i = 0; i < n; i++) {
		const j = new THREE.Group();
		j.position.x = x;
		j.rotation.z = TARSUS_CURL / n;
		parent.add(j);
		const r = 0.07 - i * 0.008;
		j.add(joint(r), bone(segLen, r, r * 0.85));
		ang += TARSUS_CURL / n;
		end.x += Math.cos(ang) * segLen;
		end.y += Math.sin(ang) * segLen;
		parent = j;
		x = segLen;
	}
	if (high) {
		for (const s of [-1, 1]) {
			const claw = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.14, 5), mat);
			claw.position.set(segLen + 0.04, -0.03, s * 0.04);
			claw.rotation.z = -Math.PI / 2 - 0.5;
			parent.add(claw);
		}
	}
	/* The tibia and the curled tarsus act as one bone for the solver. */
	const ex = lt + end.x, ey = end.y;
	return {
		name, plane, coxaJ, femurJ, tibiaJ,
		anchor: new THREE.Vector3().fromArray(spec.at),
		pole: new THREE.Vector3().fromArray(spec.pole).normalize(),
		coxa: spec.coxa, len: spec.len,
		eff: Math.hypot(ex, ey), effAngle: Math.atan2(ey, ex),
		target: new THREE.Vector3(),
	};
}

const _d = new THREE.Vector3(), _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3();
const _m = new THREE.Matrix4(), _t = new THREE.Vector3(), _o = new THREE.Vector3();
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* Two-bone IK in the plane through the hip, the target and the pole. */
function solve(leg, P) {
	_d.subVectors(P, leg.anchor);
	const dist = _d.length();
	if (dist < 1e-4) return;
	_x.copy(_d).divideScalar(dist);
	_y.copy(leg.pole).addScaledVector(_x, -leg.pole.dot(_x));
	if (_y.lengthSq() < 1e-6) _y.set(0, 1, 0).addScaledVector(_x, -_x.y);
	_y.normalize();
	_z.crossVectors(_x, _y);
	leg.plane.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
	const g0 = leg.coxa, lc = leg.len[0];
	const tx = dist - lc * Math.cos(g0), ty = -lc * Math.sin(g0);
	const L1 = leg.len[1], L2 = leg.eff;
	const dd = clamp(Math.hypot(tx, ty), Math.abs(L1 - L2) + 1e-3, L1 + L2 - 1e-3);
	const phi = Math.atan2(ty, tx);
	const alpha = Math.acos(clamp((L1 * L1 + dd * dd - L2 * L2) / (2 * L1 * dd), -1, 1));
	const beta = Math.acos(clamp((L1 * L1 + L2 * L2 - dd * dd) / (2 * L1 * L2), -1, 1));
	leg.coxaJ.rotation.z = g0;
	leg.femurJ.rotation.z = phi + alpha - g0;
	leg.tibiaJ.rotation.z = -(Math.PI - beta) - leg.effAngle;
}

/* ---------- textures (shared) ---------- */

const cache = {};

function bandTexture(tint) {
	const key = 'band' + tint;
	if (cache[key]) return cache[key];
	const c = document.createElement('canvas');
	c.width = 16; c.height = 256;
	const g = c.getContext('2d');
	const base = new THREE.Color(tint);
	const css = (col) => `rgb(${col.r * 255 | 0},${col.g * 255 | 0},${col.b * 255 | 0})`;
	g.fillStyle = css(base);
	g.fillRect(0, 0, 16, 256);
	/* v = 0 at the waist, 1 at the tip; the canvas is flipped, so draw from the bottom */
	const dark = base.clone().multiplyScalar(0.28);
	for (let k = 0; k < 6; k++) {
		const v0 = 0.08 + k * 0.15, v1 = v0 + (k >= 4 ? 0.15 : 0.06);
		g.fillStyle = css(dark);
		g.fillRect(0, (1 - v1) * 256, 16, (v1 - v0) * 256);
	}
	g.fillStyle = css(dark);
	g.fillRect(0, 0, 16, 0.12 * 256);
	return (cache[key] = srgb(new THREE.CanvasTexture(c)));
}

function facetTexture() {
	if (cache.facet) return cache.facet;
	const c = document.createElement('canvas');
	c.width = c.height = 256;
	const g = c.getContext('2d');
	g.fillStyle = '#7a120c';
	g.fillRect(0, 0, 256, 256);
	const r = 5;
	for (let row = 0, y = 0; y < 260; row++, y += r * 1.5) {
		for (let x = (row % 2) * r * 0.87; x < 260; x += r * 1.74) {
			const grd = g.createRadialGradient(x - 1, y - 1, 0, x, y, r);
			grd.addColorStop(0, '#e0503a');
			grd.addColorStop(0.7, '#a8231a');
			grd.addColorStop(1, '#4a0906');
			g.fillStyle = grd;
			g.beginPath(); g.arc(x, y, r * 0.92, 0, Math.PI * 2); g.fill();
		}
	}
	return (cache.facet = srgb(new THREE.CanvasTexture(c)));
}

function wingTexture() {
	if (cache.wing) return cache.wing;
	const W = 512, H = 128;
	const c = document.createElement('canvas');
	c.width = W; c.height = H;
	const g = c.getContext('2d');
	/* the wing shape spans x -4.7..0 and y -0.55..0.82 (fitUV maps it to 0..1) */
	const X = (x) => (x + 4.7) / 4.7 * W, Y = (y) => (1 - (y + 0.55) / 1.37) * H;
	const grd = g.createLinearGradient(0, 0, W, 0);
	grd.addColorStop(0, 'rgba(200,215,255,0.34)');
	grd.addColorStop(0.5, 'rgba(225,215,255,0.22)');
	grd.addColorStop(1, 'rgba(230,240,255,0.30)');
	g.fillStyle = grd;
	g.fillRect(0, 0, W, H);
	g.strokeStyle = 'rgba(70,55,40,0.85)';
	g.lineWidth = 2.2;
	for (const [y0, y1, x1] of [[0.05, 0.62, -4.4], [0, 0.35, -4.6], [-0.02, 0.05, -4.5], [-0.05, -0.28, -3.9], [-0.1, -0.42, -2.8]]) {
		g.beginPath();
		g.moveTo(X(0), Y(y0));
		g.quadraticCurveTo(X(x1 / 2), Y((y0 + y1) / 2 + 0.05), X(x1), Y(y1));
		g.stroke();
	}
	g.lineWidth = 1.6;
	for (const [x, ya, yb] of [[-1.9, 0.22, -0.02], [-3.1, 0.05, -0.28]]) {                   // cross veins
		g.beginPath(); g.moveTo(X(x), Y(ya)); g.lineTo(X(x - 0.15), Y(yb)); g.stroke();
	}
	return (cache.wing = srgb(new THREE.CanvasTexture(c)));
}

function srgb(t) { t.colorSpace = THREE.SRGBColorSpace; return t; }

/* ShapeGeometry puts raw x, y in its UVs; stretch them over the texture. */
function fitUV(geo) {
	geo.computeBoundingBox();
	const b = geo.boundingBox, uv = geo.attributes.uv, p = geo.attributes.position;
	for (let i = 0; i < uv.count; i++) {
		uv.setXY(i, (p.getX(i) - b.min.x) / (b.max.x - b.min.x), (p.getY(i) - b.min.y) / (b.max.y - b.min.y));
	}
	uv.needsUpdate = true;
}
