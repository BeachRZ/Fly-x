/* The world round the rocket: Earth with its night-side spaceport, the target,
 * rocks and meteors, the flown path, and the effects (smoke, dust, explosions).
 *
 * Coordinates are the simulation's plane: x right, y up, Earth at the origin
 * (radius 100), the launch pad on top of it at (0, 100). z is depth, so the
 * camera can orbit round the flight plane. Everything the simulation knows about
 * -- target, pad, rocks, meteors -- sits where the mission bundle puts it; the
 * rest (buildings, clouds, boulders) is scenery.
 *
 * The Sun sits behind the Earth, opposite the target. That makes the Moon full
 * -- the brightest thing in the sky -- and puts the launch site on the Earth's
 * night side, which is the situation the simulation renders for the fly's eye.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const R_EARTH = 100;

export function createSpaceScene(canvas) {
	const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true });
	renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));

	const scene = new THREE.Scene();
	/* a soft studio environment, only for the steel to reflect */
	scene.environment = new THREE.PMREMGenerator(renderer).fromScene(envScene(), 0.04).texture;
	const SKY_GROUND = new THREE.Color(0x0c1a36), SKY_SPACE = new THREE.Color(0x010207);
	scene.background = SKY_SPACE.clone();
	const camera = new THREE.PerspectiveCamera(50, 1, 0.002, 60000);
	const controls = new OrbitControls(camera, renderer.domElement);
	controls.enableDamping = true;
	controls.dampingFactor = 0.08;
	controls.minDistance = 0.4;
	controls.maxDistance = 6000;

	scene.add(new THREE.AmbientLight(0x202a3c, 0.75));
	const sun = new THREE.DirectionalLight(0xfff4e0, 2.3);
	scene.add(sun, sun.target);

	const earth = makeEarth();
	scene.add(earth.group);
	const port = makeSpaceport();
	scene.add(port.group);
	scene.add(makeStars());

	const worldGroup = new THREE.Group();          // per-mission: target, rocks, meteors
	scene.add(worldGroup);
	let target = null, meteors = [], asteroids = [];

	const pathGeo = new THREE.BufferGeometry();
	const path = new THREE.Line(pathGeo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }));
	path.frustumCulled = false;
	scene.add(path);

	const fx = makeFx(scene);

	function setMission(m, rows) {
		worldGroup.clear();
		fx.clear();
		const lvl = m.level;
		target = makeTarget(lvl, m.eye);
		worldGroup.add(target.group);
		const toT = new THREE.Vector3(lvl.target[0], lvl.target[1], 0).normalize();
		sun.position.copy(toT.clone().multiplyScalar(-6000)).add(new THREE.Vector3(0, 0, 2200));
		earth.setSun(sun.position.clone().normalize());
		asteroids = lvl.asteroids.map((a, i) => {
			const mesh = makeAsteroid(a[2], 101 + i * 7);
			mesh.position.set(a[0], a[1], 0);
			worldGroup.add(mesh);
			return mesh;
		});
		meteors = lvl.meteors.map((row) => {
			const mt = makeMeteor(row);
			worldGroup.add(mt.group);
			return mt;
		});
		const pts = new Float32Array(rows.length * 3);
		rows.forEach((r, i) => { pts[i * 3] = r.x; pts[i * 3 + 1] = r.y; pts[i * 3 + 2] = 0; });
		pathGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
		pathGeo.setDrawRange(0, 0);
	}

	function update(sample, dt, t) {
		pathGeo.setDrawRange(0, sample.i + 1);
		for (const a of asteroids) { a.rotation.x += dt * a.userData.spin.x; a.rotation.y += dt * a.userData.spin.y; }
		for (const mt of meteors) mt.update(t);
		earth.update(dt);
		port.update(dt);
		if (target) target.update(dt);
		fx.update(dt, camera);
		/* the sky is dark blue down in the air and black above it */
		const alt = camera.position.length() - R_EARTH;
		scene.background.copy(SKY_GROUND).lerp(SKY_SPACE, THREE.MathUtils.smoothstep(alt, 2, 45));
	}

	let w = 0, h = 0;
	function resize() {
		const cw = canvas.clientWidth, ch = canvas.clientHeight;
		if (cw === w && ch === h) return;
		w = cw; h = ch;
		renderer.setSize(w, h, false);
		camera.aspect = w / h;
		camera.updateProjectionMatrix();
	}

	function render() {
		resize();
		/* OrbitControls.update() re-aims the camera at its target even while
		 * disabled, which would fight the in-rocket cameras. */
		if (controls.enabled) controls.update();
		renderer.render(scene, camera);
	}

	return { renderer, scene, camera, controls, setMission, update, render, fx, surfacePoint: (phi) => target && target.surfacePoint(phi) };
}

/* ---------- Earth ---------- */

function makeEarth() {
	const group = new THREE.Group();
	const { day, night, clouds } = earthTextures();
	const uniforms = { dayMap: { value: day }, nightMap: { value: night }, sunDir: { value: new THREE.Vector3(0, -1, 0) } };
	const mat = new THREE.ShaderMaterial({
		uniforms,
		vertexShader: `
			varying vec2 vUv; varying vec3 vN;
			#include <common>
			#include <logdepthbuf_pars_vertex>
			void main() {
				vUv = uv; vN = normalize(mat3(modelMatrix) * normal);
				gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
				#include <logdepthbuf_vertex>
			}`,
		fragmentShader: `
			uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sunDir;
			varying vec2 vUv; varying vec3 vN;
			#include <logdepthbuf_pars_fragment>
			void main() {
				#include <logdepthbuf_fragment>
				float l = dot(normalize(vN), normalize(sunDir));
				float day = smoothstep(-0.15, 0.2, l);
				vec3 d = texture2D(dayMap, vUv).rgb;
				vec3 n = texture2D(nightMap, vUv).rgb;
				vec3 col = d * (0.04 + 1.05 * max(l, 0.0)) * day + n * (1.0 - day) * 1.5 + d * 0.05;
				gl_FragColor = vec4(col, 1.0);
			}`,
	});
	/* Poles along z: the launch site, on top of the planet, sits on the equator. */
	const mesh = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH, 256, 128), mat);
	mesh.rotation.x = Math.PI / 2;
	group.add(mesh);
	const cloudMesh = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.012, 128, 64), new THREE.MeshLambertMaterial({
		map: clouds, transparent: true, opacity: 0.55, depthWrite: false,
	}));
	cloudMesh.rotation.x = Math.PI / 2;
	group.add(cloudMesh);

	const atmo = new THREE.Mesh(new THREE.SphereGeometry(R_EARTH * 1.06, 96, 64), new THREE.ShaderMaterial({
		transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending,
		vertexShader: `
			varying vec3 vN; varying vec3 vView;
			#include <common>
			#include <logdepthbuf_pars_vertex>
			void main() {
				vec4 wp = modelMatrix * vec4(position, 1.0);
				vN = normalize(mat3(modelMatrix) * normal);
				vView = normalize(cameraPosition - wp.xyz);
				gl_Position = projectionMatrix * viewMatrix * wp;
				#include <logdepthbuf_vertex>
			}`,
		fragmentShader: `
			varying vec3 vN; varying vec3 vView;
			#include <logdepthbuf_pars_fragment>
			void main() {
				#include <logdepthbuf_fragment>
				float rim = pow(clamp(1.0 + dot(vN, vView), 0.0, 1.0), 2.4);
				gl_FragColor = vec4(0.22, 0.5, 1.0, rim * 0.85);
			}`,
	}));
	group.add(atmo);
	return {
		group,
		setSun: (v) => uniforms.sunDir.value.copy(v),
		update: (dt) => { cloudMesh.rotation.y += dt * 0.002; },
	};
}

function earthTextures() {
	const W = 2048, H = 1024;
	const rnd = mulberry32(7);
	const land = document.createElement('canvas');
	land.width = W; land.height = H;
	const lg = land.getContext('2d');
	lg.fillStyle = '#000';
	lg.fillRect(0, 0, W, H);
	lg.fillStyle = '#fff';
	lg.filter = 'blur(10px)';
	for (let c = 0; c < 11; c++) {
		const cx = rnd() * W, cy = H * (0.18 + rnd() * 0.64), size = 70 + rnd() * 170;
		for (let k = 0; k < 30; k++) {
			lg.beginPath();
			lg.ellipse(cx + (rnd() - 0.5) * size * 2.4, cy + (rnd() - 0.5) * size * 1.3,
				size * (0.25 + rnd() * 0.5), size * (0.18 + rnd() * 0.35), rnd() * Math.PI, 0, Math.PI * 2);
			lg.fill();
		}
	}
	/* a continent under the launch site (texture u = 0.25 faces +y after the rotation) */
	for (let k = 0; k < 26; k++) {
		lg.beginPath();
		lg.ellipse(W * 0.25 + (rnd() - 0.5) * 300, H * 0.5 + (rnd() - 0.5) * 220, 60 + rnd() * 90, 40 + rnd() * 70, rnd() * 3, 0, Math.PI * 2);
		lg.fill();
	}
	lg.filter = 'none';
	const mask = lg.getImageData(0, 0, W, H).data;

	const day = document.createElement('canvas');
	day.width = W; day.height = H;
	const dg = day.getContext('2d');
	const img = dg.createImageData(W, H);
	const nightC = document.createElement('canvas');
	nightC.width = W; nightC.height = H;
	const ng = nightC.getContext('2d');
	const nimg = ng.createImageData(W, H);
	/* cities: clusters of lights along the coasts and inland, brightest round the launch site */
	const cities = [];
	for (let k = 0; k < 140; k++) cities.push([rnd() * W, H * (0.15 + rnd() * 0.7), 3 + rnd() * 16]);
	for (let k = 0; k < 30; k++) cities.push([W * 0.25 + (rnd() - 0.5) * 380, H * 0.5 + (rnd() - 0.5) * 260, 4 + rnd() * 14]);
	const cityAt = new Float32Array(W * H);
	for (const [cx, cy, r] of cities) {
		for (let y = Math.max(0, cy - r * 3 | 0); y < Math.min(H, cy + r * 3); y++) {
			for (let x = Math.max(0, cx - r * 3 | 0); x < Math.min(W, cx + r * 3); x++) {
				const d = Math.hypot(x - cx, y - cy) / r;
				cityAt[y * W + x] += Math.exp(-d * d);
			}
		}
	}
	for (let y = 0; y < H; y++) {
		const lat = Math.abs(y / H - 0.5) * 2;
		for (let x = 0; x < W; x++) {
			const i = (y * W + x) * 4;
			const m = mask[i] / 255;
			const isLand = m > 0.5;
			const polar = lat > 0.88;
			let r, g, b;
			if (polar) { r = g = b = 235; }
			else if (isLand) { const k = rnd() * 18; r = 70 + k + lat * 60; g = 100 + k - lat * 20; b = 55 + k; }
			else { r = 10 + m * 20; g = 45 + m * 40; b = 105 + m * 50; }
			img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
			const c = isLand && !polar ? Math.min(1, cityAt[y * W + x]) : 0;
			const lit = c > 0.05 && rnd() < 0.08 + c * 0.6 ? 1 : 0;
			nimg.data[i] = lit ? 255 : 2; nimg.data[i + 1] = lit ? 190 : 3; nimg.data[i + 2] = lit ? 105 : 9;
			nimg.data[i + 3] = 255;
		}
	}
	dg.putImageData(img, 0, 0);
	ng.putImageData(nimg, 0, 0);

	const cloudC = document.createElement('canvas');
	cloudC.width = 1024; cloudC.height = 512;
	const cg = cloudC.getContext('2d');
	cg.filter = 'blur(7px)';
	for (let k = 0; k < 420; k++) {
		cg.fillStyle = `rgba(255,255,255,${0.1 + rnd() * 0.25})`;
		cg.beginPath();
		cg.ellipse(rnd() * 1024, 60 + rnd() * 392, 10 + rnd() * 50, 5 + rnd() * 18, rnd() * 0.6, 0, Math.PI * 2);
		cg.fill();
	}
	const mk = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
	return { day: mk(day), night: mk(nightC), clouds: mk(cloudC) };
}

/* ---------- the spaceport, on top of the Earth at night ---------- */

/* Tangent coordinates at the pad: u along +x, v along +z, h up the local normal. */
function onEarth(u, v, h = 0) {
	const n = new THREE.Vector3(u, R_EARTH, v).normalize();
	return { p: n.clone().multiplyScalar(R_EARTH + h), n };
}
const _Y = new THREE.Vector3(0, 1, 0);

function makeSpaceport() {
	const group = new THREE.Group();
	const rnd = mulberry32(42);

	/* ground: a curved patch with roads, pads and lots, lit where the lamps are */
	const { map, lights } = portTextures();
	const geo = new THREE.PlaneGeometry(32, 32, 64, 64);
	geo.rotateX(-Math.PI / 2);
	const pos = geo.attributes.position;
	for (let i = 0; i < pos.count; i++) {
		const { p } = onEarth(pos.getX(i), pos.getZ(i), 0.004);
		pos.setXYZ(i, p.x, p.y, p.z);
	}
	geo.computeVertexNormals();
	group.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({
		map, emissiveMap: lights, emissive: 0xffffff, emissiveIntensity: 1.0,
	})));

	const conc = new THREE.MeshLambertMaterial({ color: 0x5a5f68 });
	const steel = new THREE.MeshPhongMaterial({ color: 0x6d747e, specular: 0x888888, shininess: 50 });
	const place = (mesh, u, v, h, rotY = 0) => {
		const { p, n } = onEarth(u, v, h);
		mesh.position.copy(p);
		mesh.quaternion.setFromUnitVectors(_Y, n);
		mesh.rotateY(rotY);
		group.add(mesh);
		return mesh;
	};

	/* the pad the simulation launches from: feet at R + 0.02 */
	place(new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.9, 0.02, 40), conc), 0, 0, 0.01);

	/* launch tower with crew access arm and beacons */
	const tower = new THREE.Group();
	const latt = latticeTexture();
	const towerMat = new THREE.MeshLambertMaterial({ map: latt, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, color: 0x9aa3ad });
	const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.7, 0.22), towerMat);
	shaft.position.y = 0.85;
	tower.add(shaft);
	const arm = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.05, 0.08), steel);
	arm.position.set(-0.26, 0.82, 0);
	tower.add(arm);
	const beacons = [];
	for (const y of [1.72, 1.2, 0.6]) {
		const b = new THREE.Mesh(new THREE.SphereGeometry(0.018, 8, 6), new THREE.MeshBasicMaterial({ color: 0xff2020 }));
		b.position.set(0.11, y, 0.11);
		tower.add(b);
		beacons.push(b);
	}
	place(tower, 0.62, 0, 0);
	/* lightning masts and floodlights round the pad */
	const flood = [];
	const glowTex = radialTexture('rgba(255,236,200,1)');
	for (let k = 0; k < 4; k++) {
		const a = k * Math.PI / 2 + Math.PI / 4;
		const u = Math.cos(a) * 1.5, v = Math.sin(a) * 1.5;
		place(new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.02, 1.3, 6), steel), u, v, 0.65);
		const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
		s.scale.setScalar(0.35);
		place(s, u, v, 1.32);
		flood.push(s);
		const light = new THREE.PointLight(0xffe6c0, 0.5, 3.5, 1.4);
		place(light, u * 0.8, v * 0.8, 1.2);
	}
	/* tanks and the assembly building */
	for (const [u, v] of [[-2.6, -1.9], [-2.9, -1.55], [-2.3, -2.25]]) {
		place(new THREE.Mesh(new THREE.SphereGeometry(0.12, 18, 12), new THREE.MeshPhongMaterial({ color: 0xd8dade, shininess: 60 })), u, v, 0.17);
		place(new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.08, 6), steel), u, v, 0.04);
	}
	const vab = place(new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.9, 0.8), new THREE.MeshLambertMaterial({
		map: vabTexture(), emissiveMap: vabTexture(true), emissive: 0xffffff,
	})), 3.2, -2.2, 0.45, 0.3);
	vab.userData.kind = 'vab';

	/* the city: blocks of buildings with lit windows, keeping the launch area clear */
	const win = windowsTexture();
	const bMat = new THREE.MeshLambertMaterial({ map: win.map, emissiveMap: win.lights, emissive: 0xffffff, emissiveIntensity: 0.9 });
	const N = 900;
	const inst = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), bMat, N);
	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
	let n = 0;
	for (let tries = 0; n < N && tries < 20000; tries++) {
		const u = (rnd() - 0.5) * 30, v = (rnd() - 0.5) * 30;
		const d = Math.hypot(u, v);
		if (d < 5 || Math.abs(v) < 0.3 || Math.abs(u) < 0.3) continue;                 // clear zone and avenues
		if ((Math.abs(u) % 2.4) < 0.22 || (Math.abs(v) % 2.4) < 0.22) continue;         // streets
		const tall = Math.max(0.05, (rnd() ** 3) * 1.2 * Math.exp(-((d - 9) ** 2) / 40));
		const { p, nrm } = (() => { const r = onEarth(u, v, tall / 2); return { p: r.p, nrm: r.n }; })();
		q.setFromUnitVectors(_Y, nrm);
		sc.set(0.12 + rnd() * 0.4, tall, 0.12 + rnd() * 0.4);
		inst.setMatrixAt(n++, m4.compose(p, q, sc));
	}
	inst.count = n;
	group.add(inst);

	/* street lamps along the avenues */
	const lamps = [];
	for (let a = -15; a <= 15; a += 0.35) {
		for (const off of [-0.18, 0.18]) {
			if (Math.abs(a) > 1.2) { lamps.push(onEarth(a, off, 0.03).p, onEarth(off, a, 0.03).p); }
		}
	}
	for (let r = 2.4; r <= 15; r += 2.4) {
		for (let a = -15; a <= 15; a += 0.5) {
			if (Math.hypot(a, r) > 5) { lamps.push(onEarth(a, r, 0.03).p, onEarth(a, -r, 0.03).p, onEarth(r, a, 0.03).p, onEarth(-r, a, 0.03).p); }
		}
	}
	const lampGeo = new THREE.BufferGeometry().setFromPoints(lamps);
	group.add(new THREE.Points(lampGeo, new THREE.PointsMaterial({
		color: 0xffc070, size: 0.06, sizeAttenuation: true, map: glowTex, transparent: true,
		depthWrite: false, blending: THREE.AdditiveBlending,
	})));

	let time = 0;
	return {
		group,
		update(dt) {
			time += dt;
			const on = (Math.sin(time * 3) > 0.2) ? 1 : 0.15;
			for (const b of beacons) b.material.color.setRGB(on, 0.05, 0.05);
			for (const f of flood) f.material.opacity = 0.85 + 0.15 * Math.sin(time * 13 + f.id);
		},
	};
}

function portTextures() {
	const S = 2048, size = 32;
	const px = (u) => (u / size + 0.5) * S;
	const c = document.createElement('canvas'), l = document.createElement('canvas');
	c.width = c.height = l.width = l.height = S;
	const g = c.getContext('2d'), gl = l.getContext('2d');
	g.fillStyle = '#1b2118';
	g.fillRect(0, 0, S, S);
	gl.fillStyle = '#000';
	gl.fillRect(0, 0, S, S);
	const rnd = mulberry32(9);
	for (let k = 0; k < 3000; k++) {                         // ground texture
		g.fillStyle = `rgba(${40 + rnd() * 30},${45 + rnd() * 30},${35 + rnd() * 20},0.35)`;
		g.fillRect(rnd() * S, rnd() * S, 4 + rnd() * 30, 4 + rnd() * 30);
	}
	g.strokeStyle = '#3d4149';
	/* avenues and a street grid */
	for (let k = -6; k <= 6; k++) {
		g.lineWidth = k === 0 ? 22 : 9;
		g.beginPath(); g.moveTo(0, px(k * 2.4)); g.lineTo(S, px(k * 2.4)); g.stroke();
		g.beginPath(); g.moveTo(px(k * 2.4), 0); g.lineTo(px(k * 2.4), S); g.stroke();
	}
	/* the launch complex: a concrete apron, the crawlerway, the flame trench */
	g.fillStyle = '#4a4e55';
	g.beginPath(); g.arc(px(0), px(0), 2.3 / size * S, 0, Math.PI * 2); g.fill();
	g.fillStyle = '#56595f';
	g.fillRect(px(0.6), px(-0.3), px(3.4) - px(0.6), px(0.3) - px(-0.3));
	g.fillStyle = '#34373d';
	g.fillRect(px(-0.12), px(0.5), px(0.12) - px(-0.12), px(1.4) - px(0.5));
	g.strokeStyle = '#e0262b';
	g.lineWidth = 6;
	g.beginPath(); g.arc(px(0), px(0), 0.95 / size * S, 0, Math.PI * 2); g.stroke();
	/* lights: lamps along the streets and lit lots */
	gl.fillStyle = 'rgba(255,190,110,0.9)';
	for (let k = -6; k <= 6; k++) {
		for (let a = 0; a < S; a += 14) {
			gl.fillRect(a, px(k * 2.4) - 3, 3, 3);
			gl.fillRect(px(k * 2.4) - 3, a, 3, 3);
		}
	}
	const apron = gl.createRadialGradient(px(0), px(0), 0, px(0), px(0), 2.6 / size * S);
	apron.addColorStop(0, 'rgba(255,240,210,0.55)');
	apron.addColorStop(1, 'rgba(255,240,210,0)');
	gl.fillStyle = apron;
	gl.fillRect(0, 0, S, S);
	const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
	return { map: mk(c), lights: mk(l) };
}

function windowsTexture() {
	const c = document.createElement('canvas'), l = document.createElement('canvas');
	c.width = l.width = 64; c.height = l.height = 128;
	const g = c.getContext('2d'), gl = l.getContext('2d');
	g.fillStyle = '#2a2e36'; g.fillRect(0, 0, 64, 128);
	gl.fillStyle = '#000'; gl.fillRect(0, 0, 64, 128);
	const rnd = mulberry32(3);
	for (let y = 4; y < 124; y += 8) {
		for (let x = 4; x < 60; x += 8) {
			g.fillStyle = '#15181d'; g.fillRect(x, y, 5, 5);
			if (rnd() < 0.42) { gl.fillStyle = rnd() < 0.8 ? '#ffd9a0' : '#bfe4ff'; gl.fillRect(x, y, 5, 5); }
		}
	}
	const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };
	return { map: mk(c), lights: mk(l) };
}

function vabTexture(lights = false) {
	const c = document.createElement('canvas');
	c.width = 256; c.height = 256;
	const g = c.getContext('2d');
	g.fillStyle = lights ? '#000' : '#8a8f98';
	g.fillRect(0, 0, 256, 256);
	g.fillStyle = lights ? '#ff2a30' : '#d4202a';
	g.font = '900 64px "Arial Black", sans-serif';
	g.textAlign = 'center';
	g.fillText('FLY-X', 128, 150);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

function latticeTexture() {
	const c = document.createElement('canvas');
	c.width = 64; c.height = 256;
	const g = c.getContext('2d');
	g.clearRect(0, 0, 64, 256);
	g.strokeStyle = '#fff';
	g.lineWidth = 4;
	g.strokeRect(2, 0, 60, 256);
	for (let y = 0; y < 256; y += 32) {
		g.beginPath(); g.moveTo(2, y); g.lineTo(62, y + 32); g.moveTo(62, y); g.lineTo(2, y + 32); g.moveTo(2, y); g.lineTo(62, y); g.stroke();
	}
	return new THREE.CanvasTexture(c);
}

/* ---------- target: Moon or Mars, with its pad and rough ground ---------- */

function makeTarget(lvl, eye) {
	const group = new THREE.Group();
	const T = new THREE.Vector3(lvl.target[0], lvl.target[1], 0);
	group.position.copy(T);
	const R = lvl.R, mars = lvl.key === 'mars';
	const body = new THREE.Mesh(new THREE.SphereGeometry(R, 192, 96),
		new THREE.MeshLambertMaterial({ map: bodyTexture(mars), emissive: mars ? 0x1a0a05 : 0x1c1c1a }));
	body.rotation.x = Math.PI / 2;
	group.add(body);
	const halo = new THREE.Sprite(new THREE.SpriteMaterial({
		map: radialTexture(mars ? 'rgba(255,150,110,0.45)' : 'rgba(255,250,230,0.55)'), transparent: true,
		depthWrite: false, blending: THREE.AdditiveBlending,
	}));
	halo.scale.setScalar(R * (mars ? 4 : 6));
	group.add(halo);

	/* the landing zone: a detailed patch round the pad, in the flight plane */
	const surf = (phi, z, h) => {
		const a = new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0);
		const n = a.multiplyScalar(Math.sqrt(Math.max(0, R * R - z * z))).add(new THREE.Vector3(0, 0, z)).normalize();
		return { p: n.clone().multiplyScalar(R + h), n };
	};
	const span = 48 / R;
	const geo = new THREE.PlaneGeometry(1, 1, 96, 48);
	const P = geo.attributes.position;
	for (let i = 0; i < P.count; i++) {
		const phi = lvl.pad_phi + P.getX(i) * span, z = P.getY(i) * 24;
		const { p } = surf(phi, z, 0.006);
		P.setXYZ(i, p.x, p.y, p.z);
	}
	geo.computeVertexNormals();
	const zone = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: regolithTexture(mars), transparent: true, alphaMap: fadeTexture(), depthWrite: false }));
	group.add(zone);

	/* the pad: lit ring, landing mark */
	const padN = new THREE.Vector3(Math.cos(lvl.pad_phi), Math.sin(lvl.pad_phi), 0);
	const pad = new THREE.Mesh(new THREE.CircleGeometry(eye.PAD_R, 48), new THREE.MeshBasicMaterial({ map: padTexture(), transparent: true }));
	pad.position.copy(padN.clone().multiplyScalar(R + 0.02));
	pad.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), padN);
	group.add(pad);
	const lightTex = radialTexture('rgba(255,250,235,1)');
	const padLights = [];
	for (let k = 0; k < 16; k++) {
		const a = k / 16 * Math.PI * 2;
		const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
		s.scale.setScalar(0.5);
		s.position.copy(pad.position).add(new THREE.Vector3(0, 0, Math.sin(a) * eye.PAD_R))
			.add(new THREE.Vector3(-padN.y, padN.x, 0).multiplyScalar(Math.cos(a) * eye.PAD_R)).addScaledVector(padN, 0.05);
		group.add(s);
		padLights.push(s);
	}
	const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: lightTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.6 }));
	beacon.scale.setScalar(9);
	beacon.position.copy(pad.position).addScaledVector(padN, 0.3);
	group.add(beacon);

	/* boulders where the simulation says the ground is steep */
	const [l1, p1, l2, p2] = lvl.terrain;
	const slopeAt = (arc) => Math.abs(arc) <= eye.PAD_R ? 0 : eye.SLOPE_AMP * Math.abs(0.6 * Math.sin(arc / l1 + p1) + 0.4 * Math.sin(arc / l2 + p2));
	const rnd = mulberry32(lvl.level * 1000 + Math.round(lvl.pad_phi * 1000));
	const rockGeo = new THREE.DodecahedronGeometry(1, 1);
	const rocks = new THREE.InstancedMesh(rockGeo, new THREE.MeshLambertMaterial({ color: mars ? 0x7a4a36 : 0x77756f, flatShading: true }), 1500);
	const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
	let n = 0;
	for (let tries = 0; n < 1500 && tries < 12000; tries++) {
		const arc = (rnd() - 0.5) * 46, z = (rnd() - 0.5) * 40;
		const slope = slopeAt(arc);
		if (rnd() > 0.08 + slope / eye.SLOPE_AMP * 0.9) continue;
		const size = 0.02 + rnd() ** 3 * (0.08 + slope / eye.SLOPE_AMP * 0.22);
		const { p, n: nrm } = surf(lvl.pad_phi + arc / R, z, size * 0.4);
		q.setFromUnitVectors(_Y, nrm).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)));
		sc.set(size * (0.7 + rnd() * 0.6), size * (0.5 + rnd() * 0.4), size * (0.7 + rnd() * 0.6));
		rocks.setMatrixAt(n++, m4.compose(p, q, sc));
	}
	rocks.count = n;
	group.add(rocks);

	let time = 0;
	return {
		group, body,
		surfacePoint(phi) { return T.clone().add(new THREE.Vector3(Math.cos(phi), Math.sin(phi), 0).multiplyScalar(R)); },
		update(dt) {
			time += dt;
			padLights.forEach((s, k) => { s.material.opacity = 0.55 + 0.45 * Math.max(0, Math.sin(time * 4 - k * 0.4)); });
		},
	};
}

function bodyTexture(mars) {
	const W = 2048, H = 1024;
	const c = document.createElement('canvas');
	c.width = W; c.height = H;
	const g = c.getContext('2d');
	const rnd = mulberry32(mars ? 23 : 11);
	g.fillStyle = mars ? '#b5603a' : '#9c9b96';
	g.fillRect(0, 0, W, H);
	for (let k = 0; k < 900; k++) {                        // mottling
		g.fillStyle = mars ? `rgba(${120 + rnd() * 80},${50 + rnd() * 40},${30 + rnd() * 20},0.18)` : `rgba(${120 + rnd() * 60},${120 + rnd() * 60},${118 + rnd() * 60},0.12)`;
		g.beginPath(); g.arc(rnd() * W, rnd() * H, 8 + rnd() * 60, 0, Math.PI * 2); g.fill();
	}
	for (let k = 0; k < 22; k++) {                         // maria / dark regions
		g.fillStyle = mars ? `rgba(70,35,25,${0.2 + rnd() * 0.3})` : `rgba(58,58,62,${0.25 + rnd() * 0.25})`;
		g.beginPath();
		g.ellipse(rnd() * W, H * (0.25 + rnd() * 0.5), 40 + rnd() * 110, 25 + rnd() * 60, rnd() * 3, 0, Math.PI * 2);
		g.fill();
	}
	for (let k = 0; k < 700; k++) {                        // craters
		const x = rnd() * W, y = rnd() * H, r = 2 + Math.pow(rnd(), 3) * 34;
		g.fillStyle = mars ? 'rgba(60,25,15,0.3)' : 'rgba(40,40,44,0.35)';
		g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
		g.strokeStyle = mars ? 'rgba(240,170,130,0.25)' : 'rgba(235,235,230,0.28)';
		g.lineWidth = Math.max(1, r * 0.15);
		g.beginPath(); g.arc(x - r * 0.15, y - r * 0.15, r, 0, Math.PI * 2); g.stroke();
	}
	if (mars) {
		g.fillStyle = 'rgba(245,240,235,0.9)';
		g.fillRect(0, 0, W, 50);
		g.fillRect(0, H - 40, W, 40);
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

function regolithTexture(mars) {
	const S = 1024;
	const c = document.createElement('canvas');
	c.width = S * 2; c.height = S;
	const g = c.getContext('2d');
	const rnd = mulberry32(mars ? 77 : 55);
	g.fillStyle = mars ? '#a65a36' : '#8e8d88';
	g.fillRect(0, 0, S * 2, S);
	for (let k = 0; k < 9000; k++) {
		const v = rnd();
		g.fillStyle = mars ? `rgba(${90 + v * 90},${40 + v * 50},${25 + v * 30},0.35)` : `rgba(${100 + v * 90},${100 + v * 90},${96 + v * 90},0.3)`;
		g.fillRect(rnd() * S * 2, rnd() * S, 1 + rnd() * 5, 1 + rnd() * 5);
	}
	for (let k = 0; k < 500; k++) {
		const x = rnd() * S * 2, y = rnd() * S, r = 2 + Math.pow(rnd(), 2.5) * 40;
		g.fillStyle = 'rgba(30,28,26,0.28)';
		g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
		g.strokeStyle = 'rgba(240,238,230,0.25)';
		g.lineWidth = Math.max(1, r * 0.12);
		g.beginPath(); g.arc(x - r * 0.12, y - r * 0.12, r, Math.PI * 0.9, Math.PI * 1.9); g.stroke();
	}
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8;
	return t;
}

function fadeTexture() {
	const c = document.createElement('canvas');
	c.width = c.height = 256;
	const g = c.getContext('2d');
	const grd = g.createRadialGradient(128, 128, 60, 128, 128, 128);
	grd.addColorStop(0, '#fff');
	grd.addColorStop(1, '#000');
	g.fillStyle = grd;
	g.fillRect(0, 0, 256, 256);
	return new THREE.CanvasTexture(c);
}

function padTexture() {
	const c = document.createElement('canvas');
	c.width = c.height = 512;
	const g = c.getContext('2d');
	g.fillStyle = '#3a3c40';
	g.beginPath(); g.arc(256, 256, 254, 0, Math.PI * 2); g.fill();
	g.strokeStyle = '#f2f2f2';
	g.lineWidth = 18;
	g.beginPath(); g.arc(256, 256, 200, 0, Math.PI * 2); g.stroke();
	g.fillStyle = '#e0262b';
	g.font = '900 250px "Arial Black", sans-serif';
	g.textAlign = 'center';
	g.textBaseline = 'middle';
	g.fillText('X', 256, 270);
	const t = new THREE.CanvasTexture(c);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

/* ---------- rocks and meteors ---------- */

function makeAsteroid(r, seed) {
	const geo = new THREE.IcosahedronGeometry(r, 4);
	const p = geo.attributes.position, v = new THREE.Vector3();
	const rnd = mulberry32(seed);
	const f = [0, 1, 2, 3].map(() => [rnd() * 3 + 1, rnd() * 6, rnd() * 3 + 1, rnd() * 6]);
	for (let i = 0; i < p.count; i++) {
		v.fromBufferAttribute(p, i).normalize();
		let k = 1;
		for (const [a, b, c, d] of f) k += 0.07 * Math.sin(v.x * a + b) * Math.sin(v.y * c + d + v.z * a);
		k += 0.04 * Math.sin(v.x * 11 + v.y * 7) * Math.sin(v.z * 13);
		v.multiplyScalar(r * k);
		p.setXYZ(i, v.x, v.y, v.z);
	}
	geo.computeVertexNormals();
	const mesh = new THREE.Mesh(geo, new THREE.MeshPhongMaterial({ color: 0x3b3834, specular: 0x111111, shininess: 8, flatShading: true }));
	mesh.userData.spin = new THREE.Vector2((rnd() - 0.5) * 0.3, (rnd() - 0.5) * 0.3);
	return mesh;
}

function makeMeteor([x0, y0, vx, vy, t0, t1, r]) {
	const group = new THREE.Group();
	const head = new THREE.Sprite(new THREE.SpriteMaterial({
		map: radialTexture('rgba(255,244,220,1)'), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
	}));
	head.scale.setScalar(r * 5);
	const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xffe2b0 }));
	const N = 24;
	const trailGeo = new THREE.BufferGeometry();
	const tp = new Float32Array(N * 3), tc = new Float32Array(N * 3);
	for (let i = 0; i < N; i++) { const k = 1 - i / N; tc[i * 3] = k; tc[i * 3 + 1] = k * 0.75; tc[i * 3 + 2] = k * 0.45; }
	trailGeo.setAttribute('position', new THREE.BufferAttribute(tp, 3));
	trailGeo.setAttribute('color', new THREE.BufferAttribute(tc, 3));
	const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
	trail.frustumCulled = false;
	group.add(head, core, trail);
	const speed = Math.hypot(vx, vy), ux = vx / speed, uy = vy / speed;
	return {
		group,
		update(t) {
			const on = t >= t0 && t <= t1;
			group.visible = on;
			if (!on) return;
			const x = x0 + vx * (t - t0), y = y0 + vy * (t - t0);
			head.position.set(x, y, 0);
			core.position.set(x, y, 0);
			const len = Math.min(18, speed * (t - t0));
			for (let i = 0; i < N; i++) { tp[i * 3] = x - ux * len * i / N; tp[i * 3 + 1] = y - uy * len * i / N; tp[i * 3 + 2] = 0; }
			trailGeo.attributes.position.needsUpdate = true;
		},
	};
}

/* ---------- effects: smoke, dust, fire, debris ---------- */

function makeFx(scene) {
	const group = new THREE.Group();
	scene.add(group);
	const soft = radialTexture('rgba(255,255,255,1)');
	const parts = [];
	const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshPhongMaterial({ color: 0x9aa0a8, shininess: 40 }), 60);
	debris.count = 0;
	debris.frustumCulled = false;
	group.add(debris);
	const bits = [];
	const flash = new THREE.PointLight(0xffb060, 0, 60, 1.4);
	group.add(flash);
	let flashLeft = 0;

	function spawn(pos, vel, { size0, size1, life, color, opacity, additive = false, drag = 0 }) {
		const s = new THREE.Sprite(new THREE.SpriteMaterial({
			map: soft, color, transparent: true, depthWrite: false, opacity,
			blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
		}));
		s.position.copy(pos);
		s.scale.setScalar(size0);
		group.add(s);
		parts.push({ s, vel: vel.clone(), age: 0, life, size0, size1, opacity, drag });
	}
	const rv = (k) => new THREE.Vector3((Math.random() - 0.5) * k, (Math.random() - 0.5) * k, (Math.random() - 0.5) * k);

	return {
		smoke(pos, vel) {
			spawn(pos, vel.clone().add(rv(0.15)), { size0: 0.12, size1: 1.4, life: 3.5, color: 0x8a8a90, opacity: 0.32, drag: 0.8 });
		},
		dust(pos, normal) {
			for (let k = 0; k < 26; k++) {
				const v = rv(1).projectOnPlane(normal).normalize().multiplyScalar(0.8 + Math.random() * 1.2).addScaledVector(normal, 0.2);
				spawn(pos, v, { size0: 0.1, size1: 0.9, life: 2.2, color: 0xc9c2b4, opacity: 0.55, drag: 1.2 });
			}
		},
		explode(pos, scale = 1) {
			spawn(pos, new THREE.Vector3(), { size0: 1.5 * scale, size1: 7 * scale, life: 0.35, color: 0xffffff, opacity: 1, additive: true });
			for (let k = 0; k < 18; k++) {
				spawn(pos, rv(2.4 * scale), { size0: 0.4 * scale, size1: (2 + Math.random() * 2) * scale, life: 1.2 + Math.random() * 0.8, color: k % 3 ? 0xff8a2a : 0xffd27a, opacity: 0.9, additive: true, drag: 1.5 });
			}
			for (let k = 0; k < 16; k++) {
				spawn(pos, rv(1.2 * scale), { size0: 0.6 * scale, size1: 3.5 * scale, life: 4 + Math.random() * 2, color: 0x3a3634, opacity: 0.55, drag: 0.9 });
			}
			for (let k = 0; k < 40; k++) {
				bits.push({ p: pos.clone(), v: rv(5 * scale), r: rv(8), s: 0.03 + Math.random() * 0.12 * scale, age: 0, rot: new THREE.Euler() });
			}
			flash.position.copy(pos);
			flash.intensity = 25;
			flashLeft = 1.2;
		},
		clear() {
			for (const p of parts) group.remove(p.s);
			parts.length = 0;
			bits.length = 0;
			debris.count = 0;
			flash.intensity = 0;
		},
		update(dt) {
			for (let i = parts.length - 1; i >= 0; i--) {
				const p = parts[i];
				p.age += dt;
				const k = p.age / p.life;
				if (k >= 1) { group.remove(p.s); p.s.material.dispose(); parts.splice(i, 1); continue; }
				p.vel.multiplyScalar(Math.exp(-p.drag * dt));
				p.s.position.addScaledVector(p.vel, dt);
				p.s.scale.setScalar(p.size0 + (p.size1 - p.size0) * Math.sqrt(k));
				p.s.material.opacity = p.opacity * (1 - k);
			}
			const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
			let n = 0;
			for (const b of bits) {
				b.age += dt;
				if (b.age > 4 || n >= 60) continue;
				b.v.multiplyScalar(Math.exp(-0.3 * dt));
				b.p.addScaledVector(b.v, dt);
				b.rot.x += b.r.x * dt; b.rot.y += b.r.y * dt;
				debris.setMatrixAt(n++, m4.compose(b.p, q.setFromEuler(b.rot), sc.set(b.s, b.s * 0.4, b.s * 0.7)));
			}
			debris.count = n;
			debris.instanceMatrix.needsUpdate = true;
			if (flashLeft > 0) { flashLeft -= dt; flash.intensity = Math.max(0, 25 * flashLeft / 1.2); }
		},
	};
}

/* ---------- reflections ---------- */

function envScene() {
	const s = new THREE.Scene();
	const geo = new THREE.SphereGeometry(10, 32, 16);
	const p = geo.attributes.position, col = [];
	for (let i = 0; i < p.count; i++) {
		const k = THREE.MathUtils.smoothstep(p.getY(i) / 10, -0.2, 0.9);
		col.push(0.06 + 0.4 * k, 0.07 + 0.45 * k, 0.09 + 0.55 * k);
	}
	geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
	s.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
	const panel = (w, h, x, y, z, color, k) => {
		const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide }));
		m.material.color.multiplyScalar(k);            // brighter than white: the PMREM target is half float
		m.position.set(x, y, z);
		m.lookAt(0, 0, 0);
		s.add(m);
	};
	panel(6, 3, 0, 6, 6, 0xffffff, 3);
	panel(4, 2, -7, 1, -3, 0x6a86b0, 1.5);
	panel(3, 3, 6, -2, -5, 0xffc890, 2);
	return s;
}

/* ---------- stars ---------- */

function makeStars() {
	const n = 9000, rnd = mulberry32(3);
	const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
	for (let i = 0; i < n; i++) {
		let u = rnd() * 2 - 1, th = rnd() * Math.PI * 2;
		if (i < n * 0.45) {                                 // a Milky Way band
			u = (rnd() - 0.5) * 0.28 + 0.2 * Math.sin(th * 2);
		}
		const s = Math.sqrt(1 - u * u), r = 20000;
		pos[i * 3] = r * s * Math.cos(th); pos[i * 3 + 1] = r * u; pos[i * 3 + 2] = r * s * Math.sin(th);
		const b = i < n * 0.45 ? 0.25 + rnd() * 0.4 : 0.35 + rnd() * 0.65;
		col[i * 3] = b; col[i * 3 + 1] = b * (0.92 + rnd() * 0.1); col[i * 3 + 2] = b * (0.9 + rnd() * 0.2);
	}
	const geo = new THREE.BufferGeometry();
	geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
	geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
	const pts = new THREE.Points(geo, new THREE.PointsMaterial({ size: 1.5, sizeAttenuation: false, vertexColors: true }));
	pts.frustumCulled = false;
	return pts;
}

function radialTexture(inner) {
	const c = document.createElement('canvas');
	c.width = c.height = 128;
	const g = c.getContext('2d');
	const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
	grd.addColorStop(0, inner);
	grd.addColorStop(0.35, inner.replace(/[\d.]+\)$/, (m) => `${parseFloat(m) * 0.3})`));
	grd.addColorStop(1, 'rgba(255,245,220,0)');
	g.fillStyle = grd;
	g.fillRect(0, 0, 128, 128);
	return new THREE.CanvasTexture(c);
}

function mulberry32(a) {
	return function () {
		a |= 0; a = a + 0x6D2B79F5 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
