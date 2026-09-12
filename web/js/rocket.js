/* FLY X: a steel passenger rocket with a pilot cockpit under a glass canopy.
 *
 * Model units, +Y toward the nose, the landing feet at y = 0 -- the point the
 * simulation calls the tail, so the model is placed exactly where the
 * simulation says its legs are. The whole model is scaled to ROCKET_L, the
 * length the simulation uses for collisions.
 *
 * Bottom to top:
 *   four landing legs with touch sensors on the feet, three engines
 *   tank section with the FLY X lettering
 *   passenger deck -- two tiers of five seats behind a wide window
 *   cockpit -- the pilot in its chair, both front legs on the levers, a console
 *   with the screen that shows exactly the frame its retina receives, and the
 *   glass canopy the fly looks up through
 *
 * The levers move with the pilot's real left and right DNp20 firing. Only the
 * pilot has a brain; passengers are the top-10 holders, drawn with their short
 * addresses, and have no effect on the flight.
 */

import * as THREE from 'three';
import { createFly, SEAT, LEG_NAMES } from './fly.js';

export const ROCKET_L = 1.2;             // simulation units, feet to nose (world.py)

const R = 1.6;                           // hull radius
const Y_ENG = 0.62;                      // engine exits
const Y_AFT = 1.5;                       // bottom of the hull
const Y_DECK0 = 5.0;                     // lower passenger tier floor
const TIER_H = 1.55;
const Y_DECK1 = Y_DECK0 + 2 * TIER_H;    // deck ceiling
const Y_COCK0 = Y_DECK1 + 0.3;           // cockpit floor
const Y_NOSE0 = Y_COCK0 + 1.9;           // nose cone begins
const Y_CANOPY = Y_NOSE0 + 0.75;         // glass from here up
const Y_TIP = 12.6;
const GAP = 1.9;                         // arc of the deck window, radians
const P_SCALE = 0.12, PILOT_SCALE = 0.13;
const LEG_LEN = 2.18, LEG_DEPLOYED = 2.395, LEG_STOWED = 0.05;

export function createRocket(scene, passengers = []) {
	const root = new THREE.Group();
	root.scale.setScalar(ROCKET_L / Y_TIP);
	scene.add(root);
	const hull = new THREE.Group();
	root.add(hull);

	const M = materials();
	const add = (mesh, x = 0, y = 0, z = 0, parent = hull) => { mesh.position.set(x, y, z); parent.add(mesh); return mesh; };

	/* ---------------- engines ---------------- */
	const bellProfile = [];
	for (let i = 0; i <= 16; i++) {
		const s = i / 16;
		bellProfile.push(new THREE.Vector2(0.13 + 0.3 * Math.pow(s, 1.6), 1.45 - s * (1.45 - Y_ENG)));
	}
	const bellGeo = new THREE.LatheGeometry(bellProfile, 28);
	const glowMat = new THREE.MeshBasicMaterial({ color: 0xff7a2a, side: THREE.BackSide, transparent: true, opacity: 0 });
	const bells = [];
	for (let k = 0; k < 3; k++) {
		const a = k * Math.PI * 2 / 3 + Math.PI / 6;
		const g = add(new THREE.Group(), Math.sin(a) * 0.62, 0, Math.cos(a) * 0.62);
		g.add(new THREE.Mesh(bellGeo, M.bell));
		g.add(new THREE.Mesh(bellGeo, glowMat));
		const pump = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.3, 12), M.dark);
		pump.position.set(0.1, 1.55, 0);
		g.add(pump);
		bells.push(g);
	}
	add(new THREE.Mesh(new THREE.CylinderGeometry(R * 0.96, R * 0.9, 0.2, 48), M.dark), 0, Y_AFT - 0.05, 0);

	/* ---------------- hull: skirt, tank, weld lines, lettering ---------------- */
	add(new THREE.Mesh(new THREE.CylinderGeometry(R, R * 0.96, 0.55, 64), M.steelDark), 0, Y_AFT + 0.27, 0);
	add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, Y_DECK0 - Y_AFT - 0.55, 64), M.steel), 0, (Y_AFT + 0.55 + Y_DECK0) / 2, 0);
	for (let y = Y_AFT + 0.9; y < Y_DECK0; y += 0.62) {
		add(new THREE.Mesh(new THREE.TorusGeometry(R + 0.004, 0.012, 4, 64), M.weld), 0, y, 0).rotation.x = Math.PI / 2;
	}
	for (const [z, flip] of [[R + 0.014, 0], [-R - 0.014, Math.PI]]) {
		const decal = add(new THREE.Mesh(new THREE.PlaneGeometry(0.95, 2.9),
			new THREE.MeshBasicMaterial({ map: nameTexture(), transparent: true, depthWrite: false })), 0, 3.3, z);
		decal.rotation.y = flip;
		decal.renderOrder = 1;
	}
	/* grid fins, raised */
	for (let k = 0; k < 4; k++) {
		const a = k * Math.PI / 2 + Math.PI / 4;
		const fin = add(new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.62, 0.06), M.gridFin),
			Math.sin(a) * (R + 0.38), Y_DECK0 - 0.6, Math.cos(a) * (R + 0.38));
		fin.rotation.y = a + Math.PI / 2;
	}

	/* ---------------- landing legs ---------------- */
	const legs = [];
	for (let k = 0; k < 4; k++) {
		const a = k * Math.PI / 2 + Math.PI / 4;
		const lr = add(new THREE.Group(), Math.sin(a) * R * 0.98, 1.6, Math.cos(a) * R * 0.98);
		lr.rotation.y = a;                      // local +Z points out of the hull
		const arm = new THREE.Group();
		lr.add(arm);
		const strut = new THREE.Mesh(new THREE.BoxGeometry(0.16, LEG_LEN, 0.12), M.leg);
		strut.position.y = LEG_LEN / 2;
		arm.add(strut);
		const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.165, 0.5, 0.125), M.red);
		stripe.position.y = LEG_LEN * 0.7;
		arm.add(stripe);
		const foot = new THREE.Group();
		foot.position.y = LEG_LEN;
		arm.add(foot);
		const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.3, 0.07, 20), M.dark);
		foot.add(pad);
		const sensor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.12),
			new THREE.MeshBasicMaterial({ color: 0x3a0a0a }));
		sensor.position.y = 0.06;
		foot.add(sensor);
		const piston = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1, 8), M.steelDark);
		lr.add(piston);
		legs.push({ arm, foot, sensor, piston });
	}
	let legAngle = LEG_DEPLOYED;
	const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
	function poseLegs(theta) {
		for (const l of legs) {
			l.arm.rotation.x = theta;
			l.foot.rotation.x = -theta;           // the pad stays level with the hull base
			_a.set(0, 1.55, -0.02);
			_b.set(0, Math.cos(theta) * LEG_LEN * 0.55, Math.sin(theta) * LEG_LEN * 0.55);
			l.piston.position.copy(_a).add(_b).multiplyScalar(0.5);
			const d = _b.sub(_a);
			l.piston.scale.set(1, d.length(), 1);
			l.piston.quaternion.setFromUnitVectors(_up, d.normalize());
		}
	}
	poseLegs(legAngle);

	/* ---------------- passenger deck ---------------- */
	const deckH = Y_DECK1 - Y_DECK0;
	const deckMid = (Y_DECK0 + Y_DECK1) / 2;
	const shellGeo = new THREE.CylinderGeometry(R, R, deckH, 64, 1, true, GAP / 2, Math.PI * 2 - GAP);
	add(new THREE.Mesh(shellGeo, M.steel), 0, deckMid, 0);
	add(new THREE.Mesh(shellGeo, M.trim), 0, deckMid, 0);
	add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, deckH, 32, 1, true, -GAP / 2, GAP), M.glass), 0, deckMid, 0);
	for (const s of [-1, -0.33, 0.33, 1]) {                    // window mullions
		const a = s * GAP / 2;
		add(new THREE.Mesh(new THREE.BoxGeometry(0.07, deckH, 0.07), M.dark), Math.sin(a) * R, deckMid, Math.cos(a) * R);
	}
	for (const y of [Y_DECK0, Y_DECK0 + TIER_H, Y_DECK1]) {
		const ring = add(new THREE.Mesh(new THREE.TorusGeometry(R, 0.04, 6, 64, GAP), M.dark), 0, y, 0);
		ring.rotation.set(Math.PI / 2, 0, Math.PI / 2 - GAP / 2);
		const floor = add(new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 48), M.floor), 0, y + 0.005, 0);
		floor.rotation.x = -Math.PI / 2;
	}
	for (let tier = 0; tier < 2; tier++) {
		const y = Y_DECK0 + tier * TIER_H;
		add(new THREE.PointLight(0xd8ecff, 0.9, 5, 1.6), 0, y + TIER_H - 0.25, -0.2);
		add(new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.04, 0.08), M.lamp), 0, y + TIER_H - 0.06, -1.1);
	}

	const crew = [];
	const XS = [-1.12, -0.56, 0, 0.56, 1.12];
	passengers.slice(0, 10).forEach((addr, i) => {
		const tier = i < 5 ? 1 : 0;                           // #1..#5 on the upper tier
		const x = XS[i % 5], floor = Y_DECK0 + tier * TIER_H;
		const cushion = floor + 0.28;
		const pos = new THREE.Vector3(x, cushion - SEAT.cushionX * P_SCALE, -0.36);
		const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
			new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, -1), new THREE.Vector3(-1, 0, 0)));
		const chair = makeChair(M, false);
		chair.position.copy(pos); chair.quaternion.copy(q); chair.scale.setScalar(P_SCALE);
		hull.add(chair);
		add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.28, 10), M.dark), x, floor + 0.14, -0.36);
		const f = createFly({ scale: P_SCALE, tint: TINTS[i % TINTS.length], detail: 'low' });
		f.root.position.copy(pos);
		f.root.quaternion.copy(q);
		hull.add(f.root);
		const label = new THREE.Sprite(new THREE.SpriteMaterial({
			map: labelTexture(`#${i + 1} ${addr}`, '#ffffff', '#e0262b'), transparent: true,
			depthWrite: false, depthTest: false,
		}));
		label.scale.set(0.56, 0.14, 1);
		label.renderOrder = 20;
		add(label, x, cushion + 0.98, -0.1);
		crew.push({ fly: f, jitter: i * 1.7, label });
	});

	/* ---------------- cockpit ---------------- */
	add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, Y_COCK0 - Y_DECK1, 64), M.red), 0, (Y_DECK1 + Y_COCK0) / 2, 0);
	const cockH = Y_NOSE0 - Y_COCK0;
	add(new THREE.Mesh(new THREE.CylinderGeometry(R, R, cockH, 64, 1, true), M.steel), 0, (Y_COCK0 + Y_NOSE0) / 2, 0);
	add(new THREE.Mesh(new THREE.CylinderGeometry(R - 0.02, R - 0.02, cockH, 64, 1, true), M.cockTrim), 0, (Y_COCK0 + Y_NOSE0) / 2, 0);
	for (const a of [Math.PI / 2, -Math.PI / 2]) {             // portholes
		const ph = add(new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.05, 8, 24), M.dark), Math.sin(a) * (R + 0.01), Y_COCK0 + 1.05, Math.cos(a) * (R + 0.01));
		ph.rotation.y = a;
		const pg = add(new THREE.Mesh(new THREE.CircleGeometry(0.27, 24), M.porthole), Math.sin(a) * (R + 0.012), Y_COCK0 + 1.05, Math.cos(a) * (R + 0.012));
		pg.rotation.y = a;
	}
	const cfloor = add(new THREE.Mesh(new THREE.CircleGeometry(R - 0.02, 48), M.floor), 0, Y_COCK0 + 0.005, 0);
	cfloor.rotation.x = -Math.PI / 2;

	/* nose: steel ogive, glass canopy, steel cap */
	const noseProfile = (y0, y1, n) => {
		const pts = [];
		for (let i = 0; i <= n; i++) {
			const y = y0 + (y1 - y0) * i / n;
			const s = (y - Y_NOSE0) / (Y_TIP - Y_NOSE0);
			pts.push(new THREE.Vector2(Math.max(0.001, R * Math.sqrt(Math.max(0, 1 - s * s * 0.985))), y));
		}
		return pts;
	};
	hull.add(new THREE.Mesh(new THREE.LatheGeometry(noseProfile(Y_NOSE0, Y_CANOPY, 8), 64), M.steel));
	hull.add(new THREE.Mesh(new THREE.LatheGeometry(noseProfile(Y_NOSE0, Y_CANOPY, 8), 64), M.cockTrim));
	/* glass nearly to the tip: the pilot looks straight out along the axis */
	const canopyProf = noseProfile(Y_CANOPY, Y_TIP, 20);
	hull.add(new THREE.Mesh(new THREE.LatheGeometry(canopyProf, 64), M.glass));
	for (let k = 0; k < 8; k++) {                               // canopy frame
		const a = k * Math.PI / 4;
		/* the ribs stop short of the tip, so they do not meet in a dark knot in the pilot's view */
		const pts = canopyProf.slice(0, -4).map((p) => new THREE.Vector3(p.x * Math.sin(a), p.y, p.x * Math.cos(a)));
		const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 20, 0.03, 5), M.dark);
		hull.add(tube);
	}
	for (const i of [0, 9]) {
		const p = canopyProf[i];
		add(new THREE.Mesh(new THREE.TorusGeometry(p.x, 0.04, 6, 64), M.red), 0, p.y, 0).rotation.x = Math.PI / 2;
	}
	add(new THREE.PointLight(0xffe2b8, 0.6, 4.5, 1.5), 0, Y_NOSE0 + 0.5, 0.2);
	add(new THREE.PointLight(0x9fd6ff, 0.8, 3.5, 1.5), 0, Y_COCK0 + 1.2, -0.9);

	/* pilot: seated facing -Z, back to the +Z wall. Its head points to the nose,
	 * which is the direction the simulation renders its eyes along. */
	const pilotQ = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(
		new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(1, 0, 0)));
	const pCushion = Y_COCK0 + 0.3;
	const pilotPos = new THREE.Vector3(0, pCushion - SEAT.cushionX * PILOT_SCALE, 0.32);
	const pchair = makeChair(M, true);
	pchair.position.copy(pilotPos); pchair.quaternion.copy(pilotQ); pchair.scale.setScalar(PILOT_SCALE);
	hull.add(pchair);
	add(new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 0.3, 12), M.dark), 0, Y_COCK0 + 0.15, 0.32);
	const pilot = createFly({ scale: PILOT_SCALE, tint: 0xb08450, detail: 'high' });
	pilot.root.position.copy(pilotPos);
	pilot.root.quaternion.copy(pilotQ);
	hull.add(pilot.root);
	const pilotTag = new THREE.Sprite(new THREE.SpriteMaterial({
		map: labelTexture('PILOT · 166,700 NEURONS', '#ffffff', '#e0262b'), transparent: true,
		depthWrite: false, depthTest: false,
	}));
	pilotTag.scale.set(0.9, 0.2, 1);
	pilotTag.renderOrder = 20;
	add(pilotTag, 0, Y_COCK0 + 1.55, 0.3);

	/* console in front of the pilot: levers, screens, switch panels */
	const consoleTop = Y_COCK0 + 0.72;
	const con = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.72, 0.55), M.console), 0, Y_COCK0 + 0.36, -0.62);
	con.castShadow = false;
	const slope = add(new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.05, 0.62), M.consoleTop), 0, consoleTop + 0.06, -0.6);
	slope.rotation.x = 0.28;
	const panelTex = buttonsTexture();
	const topPanel = add(new THREE.Mesh(new THREE.PlaneGeometry(1.36, 0.5), new THREE.MeshBasicMaterial({ map: panelTex })), 0, consoleTop + 0.095, -0.6);
	topPanel.rotation.x = -Math.PI / 2 + 0.28;

	const levers = [];
	for (const s of [-1, 1]) {                                  // s = -1: left lever (left DNp20)
		const pivot = add(new THREE.Group(), s * 0.16, consoleTop + 0.05, -0.36);
		const base = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 0.05, 14), M.dark);
		pivot.add(base);
		const arm = new THREE.Group();
		pivot.add(arm);
		const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, 0.3, 8), M.steelDark);
		rod.position.y = 0.15;
		arm.add(rod);
		const grip = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.06, 4, 10), s < 0 ? M.gripL : M.gripR);
		grip.position.y = 0.31;
		arm.add(grip);
		const gripPoint = new THREE.Object3D();
		gripPoint.position.set(0, 0.31, 0.02);
		arm.add(gripPoint);
		levers.push({ arm, gripPoint, s, v: 0 });
	}

	const screens = {};
	const makeScreen = (name, w, h, x, y, z, rx, canvas) => {
		const c = canvas || Object.assign(document.createElement('canvas'), { width: 320, height: 200 });
		const tex = new THREE.CanvasTexture(c);
		tex.colorSpace = THREE.SRGBColorSpace;
		const frame = add(new THREE.Mesh(new THREE.BoxGeometry(w + 0.06, h + 0.06, 0.04), M.dark), x, y, z);
		frame.rotation.x = rx;
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex }));
		m.position.set(0, 0, 0.021);
		frame.add(m);
		screens[name] = { canvas: c, ctx: c.getContext('2d'), tex, mesh: m };
	};
	makeScreen('telemetry', 0.44, 0.28, -0.52, consoleTop + 0.42, -0.95, 0.12);
	makeScreen('neurons', 0.44, 0.28, 0.52, consoleTop + 0.42, -0.95, 0.12);
	/* side switch panels round the -Z half of the wall */
	for (const a of [2.2, 2.65, 3.6, 4.05]) {
		const p = add(new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.7), new THREE.MeshBasicMaterial({ map: panelTex })),
			Math.sin(a) * (R - 0.06), Y_COCK0 + 1.0, Math.cos(a) * (R - 0.06));
		p.rotation.y = a + Math.PI;
	}
	const overhead = add(new THREE.Mesh(new THREE.CylinderGeometry(R - 0.05, R - 0.05, 0.4, 48, 1, true, Math.PI * 0.62, Math.PI * 0.76),
		new THREE.MeshBasicMaterial({ map: panelTex, side: THREE.BackSide })), 0, Y_NOSE0 - 0.1, 0);
	overhead.rotation.y = 0;

	/* ---------------- exhaust, RCS ---------------- */
	const flame = new THREE.Group();
	const flameOuter = new THREE.Mesh(new THREE.ConeGeometry(0.95, 4.6, 24, 1, true), new THREE.MeshBasicMaterial({
		color: 0xff8a2a, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false,
	}));
	const flameInner = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2.8, 18, 1, true), new THREE.MeshBasicMaterial({
		color: 0xfff1c2, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false,
	}));
	flameOuter.rotation.x = flameInner.rotation.x = Math.PI;
	flameOuter.position.y = Y_ENG - 2.3;
	flameInner.position.y = Y_ENG - 1.4;
	flame.add(flameOuter, flameInner);
	hull.add(flame);
	const flameLight = add(new THREE.PointLight(0xff9a3c, 0, 30, 1.6), 0, -1.2, 0);

	const puffTex = radialTexture('rgba(235,240,255,0.95)');
	const rcs = [];
	for (const s of [-1, 1]) {
		const nozzle = add(new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 0.14, 8), M.dark), s * (R + 0.05), Y_DECK1 + 0.15, 0);
		nozzle.rotation.z = s * Math.PI / 2;
		const puff = add(new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, transparent: true, depthWrite: false, opacity: 0 })),
			s * (R + 0.5), Y_DECK1 + 0.15, 0);
		puff.scale.setScalar(0.8);
		rcs.push({ s, puff });
	}

	/* ---------------- per frame ---------------- */
	let time = 0, lastScreens = 0, touchFlash = 0;
	const dir = new THREE.Vector3();

	/* s: interpolated simulation sample (x, y = centre of mass; heading; lever;
	 * throttle; phase ...). o: { burning, throttle, legs (0 stowed .. 1 deployed),
	 * rcs (-1..1, + = pushing toward the pilot's left), L, R (DNp20 Hz),
	 * touched (feet on the ground), active } */
	function update(s, dt, o) {
		time += dt;
		dir.set(Math.cos(s.heading), Math.sin(s.heading), 0);
		root.position.set(s.x, s.y, 0).addScaledVector(dir, -ROCKET_L / 2);
		root.rotation.set(0, 0, s.heading - Math.PI / 2);

		const want = LEG_STOWED + (LEG_DEPLOYED - LEG_STOWED) * (o.legs ?? 1);
		if (Math.abs(want - legAngle) > 1e-3) {
			legAngle += Math.sign(want - legAngle) * Math.min(Math.abs(want - legAngle), dt * 1.4);
			poseLegs(legAngle);
		}
		touchFlash = o.touched ? Math.min(1, touchFlash + dt * 4) : Math.max(0, touchFlash - dt);
		for (const l of legs) l.sensor.material.color.setRGB(0.25 + 0.75 * touchFlash, 0.05 + 0.9 * touchFlash, 0.05 + 0.5 * touchFlash);

		const th = o.throttle ?? 1;
		flame.visible = o.burning;
		const flick = 0.85 + 0.15 * Math.sin(time * 40) + 0.08 * Math.sin(time * 71);
		flame.scale.set(0.55 + 0.45 * th, flick * (0.3 + 0.7 * th), 0.55 + 0.45 * th);
		flameLight.intensity = o.burning ? 3 * flick * th : 0;
		glowMat.opacity = o.burning ? 0.35 + 0.5 * th : 0;
		for (const [i, b] of bells.entries()) {                 // engine gimbal follows the lever
			b.rotation.z = -(s.lever || 0) * 0.08 + Math.sin(time * 9 + i) * 0.004 * th;
		}
		for (const r of rcs) {
			const on = Math.max(0, (o.rcs || 0) * r.s);            // + pushes left: the right-side jet fires
			r.puff.material.opacity = on * (0.6 + 0.4 * Math.sin(time * 50));
			r.puff.scale.setScalar(0.4 + on * 0.9);
		}

		/* The levers are the pilot's two DNp20 cells; its front legs hold them. */
		for (const lv of levers) {
			const hz = lv.s < 0 ? (o.L || 0) : (o.R || 0);
			lv.v += (Math.min(1, hz / 60) - lv.v) * Math.min(1, dt * 6);
			lv.arm.rotation.x = -0.25 + lv.v * 0.75;
		}
		hull.updateMatrixWorld(true);
		pilot.setTargetWorld('L1', levers[0].gripPoint.getWorldPosition(_a));
		pilot.setTargetWorld('R1', levers[1].gripPoint.getWorldPosition(_a));
		pilot.animate(dt, { active: o.active ?? 0.4, lean: -(s.lever || 0), look: (s.lever || 0) * 0.5 });
		for (const c of crew) {
			c.fly.animate(dt, { active: o.burning ? 0.35 : 0.1, lean: Math.sin(time * 0.7 + c.jitter) * 0.2, look: Math.sin(time * 0.3 + c.jitter) });
		}
	}

	/* Screens are canvases; the caller hands over the numbers to draw. */
	function drawScreens(tel, now) {
		if (now - lastScreens < 150) return;
		lastScreens = now;
		const t = screens.telemetry, g = t.ctx;
		screenBase(g, 'TELEMETRY');
		g.font = '600 22px ui-monospace, Consolas, monospace';
		const rows = [['ALTITUDE', tel.alt], ['SPEED', tel.speed], ['G-FORCE', tel.g], ['FUEL', tel.fuel], ['THROTTLE', tel.throttle]];
		rows.forEach(([k, v], i) => {
			g.fillStyle = '#8fa3c0'; g.fillText(k, 14, 62 + i * 27);
			g.fillStyle = '#ffffff'; g.textAlign = 'right'; g.fillText(v, 306, 62 + i * 27); g.textAlign = 'left';
		});
		t.tex.needsUpdate = true;
		const n = screens.neurons, h = n.ctx;
		screenBase(h, 'DNp20 · LEVERS');
		for (const [i, [k, v, col]] of [['LEFT', tel.L, '#e0262b'], ['RIGHT', tel.R, '#e0262b']].entries()) {
			h.fillStyle = '#8fa3c0'; h.font = '600 20px ui-monospace, Consolas, monospace';
			h.fillText(k, 14, 70 + i * 50);
			h.fillStyle = '#1b2230'; h.fillRect(110, 54 + i * 50, 150, 20);
			h.fillStyle = col; h.fillRect(110, 54 + i * 50, 150 * Math.min(1, v / 60), 20);
			h.fillStyle = '#fff'; h.fillText(`${v.toFixed(0)}`, 268, 70 + i * 50);
		}
		h.fillStyle = '#8fa3c0'; h.fillText(tel.mode, 14, 176);
		n.tex.needsUpdate = true;
	}

	/* The main screen shows the pilot's window; the eye canvas is drawn elsewhere. */
	let eyeTex = null;
	function setEyeCanvas(canvas) {
		makeScreen('eye', 0.86, 0.645, 0, consoleTop + 0.5, -1.12, 0.1, canvas);
		eyeTex = screens.eye.tex;
	}
	function eyeUpdated() { if (eyeTex) eyeTex.needsUpdate = true; }

	const local = (x, y, z) => { root.updateMatrixWorld(true); return hull.localToWorld(new THREE.Vector3(x, y, z)); };
	const axis = (x, y, z) => { root.updateMatrixWorld(true); return new THREE.Vector3(x, y, z).transformDirection(hull.matrixWorld); };

	/* Orbit rigs in hull space: the camera circles an anchor inside the rocket and
	 * travels with it. az from +Z toward +X, el up from the hull's cross-section. */
	const RIGS = {
		/* from the pilot's right, a little in front: the fly, both levers in its
		 * front legs, the console and its screens; drag up to see the canopy */
		cockpit: { anchor: [0, Y_COCK0 + 0.92, -0.2], az: 1.15, el: 0.26, dist: 1.5, min: 0.4, max: 5, fov: 62 },
		cabin: { anchor: [0, (Y_DECK0 + Y_DECK1) / 2, -0.25], az: 0, el: 0.02, dist: R + 3.0, min: 1, max: 14, fov: 50 },
	};
	function rig(mode) { return RIGS[mode]; }

	/* The pilot's view: from low at its front right, up through the canopy along
	 * the rocket's axis -- the direction the simulation renders its eyes along,
	 * with the same left and right as the eye panel -- with the fly's head and
	 * its legs on the levers in the frame. yaw/pitch let the viewer look round. */
	const _pv = new THREE.Vector3(), _pz = new THREE.Vector3(0, 0, 1), _pr = new THREE.Vector3();
	function pilotView(yaw = 0, pitch = 0) {
		const P = new THREE.Vector3(0.45, Y_COCK0 + 0.55, -0.2);          // in front of the seat, below the head
		_pv.set(-0.15, 1, 0.3).normalize().applyAxisAngle(_pz, yaw);
		_pr.crossVectors(_pv, _pz).normalize();
		_pv.applyAxisAngle(_pr, pitch);
		return { position: local(P.x, P.y, P.z), target: local(P.x + _pv.x, P.y + _pv.y, P.z + _pv.z), up: axis(0, 0, 1), fov: 82 };
	}

	function setCameraMode(mode) {
		pilotTag.visible = mode !== 'cockpit' && mode !== 'pilot';
		for (const c of crew) c.label.visible = mode === 'cabin' || mode === 'chase';
	}
	function setVisible(v) { root.visible = v; }

	/* The passenger list belongs to the flight, not to the page: every mission
	 * carries the holders as they were when it was published, so a replay shows
	 * who was aboard then rather than who holds the token now. */
	function setCrew(list) {
		crew.forEach((c, i) => {
			const name = list && list[i] ? list[i] : 'seat empty';
			c.label.material.map.dispose();
			c.label.material.map = labelTexture(`#${i + 1} ${name}`, '#ffffff', '#e0262b');
			c.label.material.needsUpdate = true;
		});
	}

	return { root, hull, update, drawScreens, setEyeCanvas, eyeUpdated, local, axis, rig, pilotView, setCameraMode, setVisible, setCrew, pilot };
}

/* ---------------- chair (built in the fly's body frame) ---------------- */

function makeChair(M, pilot) {
	const g = new THREE.Group();
	const S = SEAT, depth = S.backY + 2.9;
	const box = (w, h, d, x, y, z, mat) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y, z); g.add(m); return m; };
	const shell = pilot ? M.seatPilot : M.seat;
	box(0.45, depth, S.halfWidth * 2, S.cushionX - 0.22, S.backY - depth / 2, 0, shell);                // cushion
	box(7.3, 0.4, 3.0, S.cushionX + 3.65, S.backY + 0.2, 0, shell);                                   // backrest
	box(1.1, 0.45, 1.9, 3.3, S.backY + 0.25, 0, shell);                                               // headrest
	box(0.3, 0.8, 3.1, S.cushionX + 3.65, S.backY + 0.45, 0, M.dark);                                 // back frame
	for (const s of [-1, 1]) {
		box(0.35, 3.8, 0.4, S.armX - 0.18, -0.55, s * S.armZ, M.dark);                                  // armrest
		box(S.armX - S.cushionX, 0.35, 0.35, (S.armX + S.cushionX) / 2, -2.2, s * S.armZ, M.dark);      // its support
		box(7.2, 0.3, 0.3, S.cushionX + 3.6, S.backY + 0.2, s * 1.62, M.red);                            // side bolsters
	}
	if (pilot) {                                                                                       // harness
		for (const s of [-1, 1]) {
			const strap = box(0.18, 0.1, 3.6, 0.6, 0.2, 0, M.strap);
			strap.rotation.y = s * 0.55;
			strap.position.y = -0.2;
		}
	}
	return g;
}

/* ---------------- materials and textures ---------------- */

const TINTS = [0x9c7446, 0x8a6a4c, 0xa6824f, 0x7f6448, 0xb08a58, 0x957050, 0x8c7552, 0xa07a4c, 0x7a5f44, 0xa98556];

function materials() {
	return {
		steel: new THREE.MeshStandardMaterial({ color: 0xd2d7de, metalness: 0.82, roughness: 0.3 }),
		steelDark: new THREE.MeshStandardMaterial({ color: 0x959ca6, metalness: 0.78, roughness: 0.4 }),
		weld: new THREE.MeshStandardMaterial({ color: 0xa8aeb8, metalness: 0.9, roughness: 0.22 }),
		dark: new THREE.MeshPhongMaterial({ color: 0x23272f, specular: 0x333333, shininess: 30 }),
		bell: new THREE.MeshPhongMaterial({ color: 0x3a3430, specular: 0xaa8866, shininess: 50, side: THREE.DoubleSide }),
		gridFin: new THREE.MeshPhongMaterial({ color: 0x4a4f58, specular: 0x666666, shininess: 40, wireframe: false }),
		leg: new THREE.MeshPhongMaterial({ color: 0x2b2f36, specular: 0x555555, shininess: 40 }),
		red: new THREE.MeshPhongMaterial({ color: 0xd4202a, specular: 0xff8080, shininess: 50 }),
		trim: new THREE.MeshLambertMaterial({ color: 0x323a48, side: THREE.BackSide }),
		cockTrim: new THREE.MeshLambertMaterial({ color: 0x2a303b, side: THREE.BackSide }),
		floor: new THREE.MeshLambertMaterial({ map: floorTexture() }),
		lamp: new THREE.MeshBasicMaterial({ color: 0xe8f4ff }),
		glass: new THREE.MeshPhongMaterial({
			color: 0x9ad7ff, transparent: true, opacity: 0.12, shininess: 140, specular: 0xffffff,
			side: THREE.DoubleSide, depthWrite: false,
		}),
		porthole: new THREE.MeshPhongMaterial({ color: 0x0a1a2a, specular: 0xffffff, shininess: 120, transparent: true, opacity: 0.8 }),
		console: new THREE.MeshPhongMaterial({ color: 0x1c2029, specular: 0x444444, shininess: 40 }),
		consoleTop: new THREE.MeshPhongMaterial({ color: 0x2a303a, specular: 0x555555, shininess: 40 }),
		seat: new THREE.MeshPhongMaterial({ color: 0xe8e8ea, specular: 0x777777, shininess: 30 }),
		seatPilot: new THREE.MeshPhongMaterial({ color: 0xf2f2f2, specular: 0x999999, shininess: 40 }),
		strap: new THREE.MeshLambertMaterial({ color: 0x111111 }),
		gripL: new THREE.MeshPhongMaterial({ color: 0xe0262b, shininess: 60 }),
		gripR: new THREE.MeshPhongMaterial({ color: 0xe0262b, shininess: 60 }),
	};
}

function screenBase(g, title) {
	g.fillStyle = '#05080e';
	g.fillRect(0, 0, 320, 200);
	g.fillStyle = '#e0262b';
	g.fillRect(0, 0, 320, 30);
	g.fillStyle = '#fff';
	g.font = '700 17px ui-monospace, Consolas, monospace';
	g.textAlign = 'left';
	g.fillText(title, 12, 21);
}

function nameTexture() {
	const c = document.createElement('canvas');
	c.width = 160; c.height = 512;
	const g = c.getContext('2d');
	g.translate(80, 256);
	g.rotate(-Math.PI / 2);
	g.font = '900 118px "Arial Black", "Segoe UI", sans-serif';
	g.textAlign = 'left';
	g.textBaseline = 'middle';
	/* "FLY-" white, "X" red, the same as the logo on the page */
	const head = 'FLY-', mark = 'X';
	const wHead = g.measureText(head).width, wMark = g.measureText(mark).width;
	const x0 = -(wHead + wMark) / 2;
	g.fillStyle = '#ffffff';
	g.fillText(head, x0, 6);
	g.fillStyle = '#d4202a';
	g.fillText(mark, x0 + wHead, 6);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function labelTexture(text, color, accent) {
	const c = document.createElement('canvas');
	c.width = 320; c.height = 72;
	const g = c.getContext('2d');
	g.fillStyle = 'rgba(6,8,12,0.82)';
	g.beginPath();
	g.roundRect(4, 10, 312, 52, 6);
	g.fill();
	g.fillStyle = accent;
	g.fillRect(4, 10, 6, 52);
	g.fillStyle = color;
	g.font = '600 26px ui-monospace, Menlo, Consolas, monospace';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText(text, 164, 37);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function buttonsTexture() {
	const c = document.createElement('canvas');
	c.width = 512; c.height = 256;
	const g = c.getContext('2d');
	g.fillStyle = '#1a1f28';
	g.fillRect(0, 0, 512, 256);
	let seed = 5;
	const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
	for (let y = 12; y < 250; y += 30) {
		for (let x = 10; x < 500; x += 34) {
			const r = rnd();
			g.fillStyle = r < 0.12 ? '#e0262b' : r < 0.2 ? '#4ee6a8' : r < 0.28 ? '#ffb45c' : r < 0.55 ? '#3a4352' : '#262c36';
			g.fillRect(x, y, 24, 16);
			g.fillStyle = '#0c0f14';
			g.fillRect(x, y + 18, 24, 3);
		}
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function floorTexture() {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const g = c.getContext('2d');
	g.fillStyle = '#20252e';
	g.fillRect(0, 0, 128, 128);
	g.strokeStyle = '#2d3440';
	g.lineWidth = 2;
	for (let i = 0; i <= 128; i += 16) {
		g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke();
		g.beginPath(); g.moveTo(0, i); g.lineTo(128, i); g.stroke();
	}
	const t = new THREE.CanvasTexture(c);
	t.wrapS = t.wrapT = THREE.RepeatWrapping;
	t.repeat.set(4, 4);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function radialTexture(inner) {
	const c = document.createElement('canvas');
	c.width = c.height = 64;
	const g = c.getContext('2d');
	const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
	grd.addColorStop(0, inner);
	grd.addColorStop(1, 'rgba(255,255,255,0)');
	g.fillStyle = grd;
	g.fillRect(0, 0, 64, 64);
	return new THREE.CanvasTexture(c);
}
