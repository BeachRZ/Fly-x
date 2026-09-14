/* FLY X viewer: plays back a finished mission in 3D, as a launch webcast.
 *
 * Everything on screen comes from the mission bundle -- the flown path, the
 * pilot's lever, its DNp20 firing, the eye's adaptation, the flip, the
 * touchdown, the collision, the onboard log -- computed by the real brain in
 * sim/. Nothing here steers anything; the viewer only draws.
 */

import * as THREE from 'three';
import { createSpaceScene } from './scene.js';
import { createRocket, ROCKET_L } from './rocket.js';
import { createEyeView } from './eyeview.js';
import { createBrainView } from './brainview.js';
import { createAudio } from './audio.js';

const $ = (id) => document.getElementById(id);
const R_EARTH = 100;

/* Placeholder addresses until a real token exists; the page says so. */
const DEMO_CREW = demoAddresses(10);

const view = createSpaceScene($('view'));
const rocket = createRocket(view.scene, DEMO_CREW);
const eye = createEyeView($('eye'));
const brain = createBrainView($('brainCanvas'));
const audio = createAudio();
rocket.setEyeCanvas($('eye'));

const NUM = ['x', 'y', 'lever', 'eye_gain', 'throttle', 'fuel', 'alt', 'vr', 'vt', 'g', 'rel_deg'];
const PHASE = { pad: 'COUNTDOWN', ascent: 'ASCENT THROUGH AIR', cruise: 'CRUISE', flip: 'FLIP', landing: 'LANDING BURN', touch: 'TOUCHDOWN', post: 'ON THE GROUND' };
const OUTCOME = {
	landed: 'LANDED ON THE PAD', landed_off: 'LANDED OFF THE PAD', tipped: 'TIPPED OVER',
	crash: 'CRASHED ON LANDING', impact: 'HIT THE SURFACE', collision: 'COLLISION', earth: 'FELL BACK TO EARTH', lost: 'TARGET LOST',
};
const OUTCOME_SHORT = {
	landed: 'landed on the pad', landed_off: 'landed off the pad', tipped: 'tipped over', crash: 'crashed',
	impact: 'hit the surface', collision: 'collision', earth: 'fell back to Earth', lost: 'missed',
};
const targetName = (t) => String(t).toUpperCase();
const TIMELINE = { liftoff: 'LIFTOFF', out_of_air: 'SPACE', fuel_out: 'FUEL 0', flip_start: 'FLIP', flip_end: 'LANDING BURN', touchdown: 'TOUCHDOWN', explosion: 'EXPLOSION' };

let index = [], mission = null, rows = [];
const PREROLL = 5;                       // seconds of spoken countdown before the data starts
let t = -1, playing = true, speed = 1, camMode = 'chase';
let endedAt = null, logShown = 0, fxDone = new Set(), exploded = false, lastSmoke = 0, directed = false;
let preroll = 0, spoken = 99, panel = 'eye';
const lastTarget = new THREE.Vector3();

const TAU = Math.PI * 2;
const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------- loading ---------------- */

/* The broadcast keeps computing: check for new flights now and then, so a page
 * left open picks them up without a reload. */
const INDEX_POLL_MS = 60000;

async function fetchIndex() {
	return (await fetch(`missions/index.json?t=${Date.now()}`, { cache: 'no-store' })).json();
}

async function refreshIndex() {
	try {
		const fresh = await fetchIndex();
		if (fresh.length === index.length && fresh[fresh.length - 1]?.id === index[index.length - 1]?.id) return;
		index = fresh;
		buildList();
		renderScore();
	} catch (err) {
		console.warn('index refresh failed', err);
	}
}

/* ---------------- the broadcast ----------------
 *
 * Launches go out on a fixed grid of slots kept by the server, so everyone
 * watching sees the same flight at the same second. Between launches the page
 * counts down to the next one. The flight itself was computed earlier -- the
 * badge under the logo says how long ago. */
const LIVE = { interval_s: 600, epoch: 0, latest: null, skew: 0, on: false };
let holding = false;                              // waiting on the pad for the next slot
let currentSlot = -1;

async function fetchLive() {
	const res = await fetch(`missions/live.json?t=${Date.now()}`, { cache: 'no-store' });
	if (!res.ok) throw new Error('no live.json');
	const data = await res.json();
	const date = res.headers.get('date');
	if (date) LIVE.skew = new Date(date).getTime() - Date.now();     // our clock against the server's
	Object.assign(LIVE, data);
	return data;
}

const serverNow = () => (Date.now() + LIVE.skew) / 1000;

const slotStartOf = (ts) => Math.floor((ts - LIVE.epoch) / LIVE.interval_s) * LIVE.interval_s + LIVE.epoch;

/* Which flight a slot shows: the newest one finished before the slot began, so
 * everybody watching that slot sees the same flight whatever their clock does. */
function missionForSlot(slotStart) {
	const byTime = [...index].sort((a, b) => (a.published || 0) - (b.published || 0));
	const ready = byTime.filter((m) => (m.published || 0) <= slotStart);
	return (ready.length ? ready[ready.length - 1] : byTime[byTime.length - 1]) || null;
}

async function startSlot(slotStart) {
	const m = missionForSlot(slotStart);
	if (!m) return;
	try {
		await loadMission(m.id);                   // always reload: a slot starts the flight from scratch
	} catch (err) {
		console.warn('broadcast flight not available', err);
		return;
	}
	const elapsed = serverNow() - slotStart;
	const flight = rows[rows.length - 1].t - rows[0].t + PREROLL;
	holding = elapsed > flight + 2;
	if (holding) {                                 // the launch of this slot is over: stand by on the pad
		preroll = 0;
		t = rows[0].t;
		playing = false;
		endedAt = null;
		logShown = 0;
		$('log').querySelector('ol').innerHTML = '';
		$('banner').hidden = true;
		$('play').textContent = '▶';
		setCam('chase');
		return;
	}
	if (elapsed < PREROLL) {                       // the countdown is still running
		preroll = PREROLL - elapsed;
		spoken = Math.ceil(preroll) + 1;
		t = rows[0].t;
	} else {                                       // join the flight where it already is
		preroll = 0;
		t = rows[0].t + (elapsed - PREROLL);
	}
	playing = true;
	$('play').textContent = '❚❚';
}

async function joinLive() {
	await fetchLive().catch(() => {});
	await refreshIndex();
	currentSlot = slotStartOf(serverNow());
	await startSlot(currentSlot);
}

function setLive(on) {
	LIVE.on = on;
	$('liveBtn').classList.toggle('on', on);
	if (on) joinLive();
}

function liveTick() {
	if (!LIVE.interval_s) return;
	const now = serverNow();
	const slot = slotStartOf(now);
	const left = Math.max(0, slot + LIVE.interval_s - now);
	const mm = String(Math.floor(left / 60)).padStart(2, '0');
	const ss = String(Math.floor(left % 60)).padStart(2, '0');
	$('liveTimer').textContent = `${mm}:${ss}`;
	$('liveState').textContent = !LIVE.on ? 'NEXT LAUNCH IN'
		: holding ? 'HOLD · NEXT LAUNCH IN'
		: endedAt === null ? 'ON AIR · NEXT IN' : 'NEXT LAUNCH IN';
	if (LIVE.on && slot !== currentSlot) {         // a new slot: launch, for everybody at once
		currentSlot = slot;
		refreshIndex().then(() => startSlot(slot));
	}
}

function buildList() {
	const sel = $('missionSel');
	const chosen = sel.value;
	sel.innerHTML = '';
	/* The seeing fly is the show; blind flights are the control, grouped apart. */
	const groups = {};
	for (const m of index) {
		const key = m.mode === 'fly' ? `${targetName(m.target)} · fly` : `${targetName(m.target)} · control: window covered`;
		if (!groups[key]) { groups[key] = document.createElement('optgroup'); groups[key].label = key; sel.append(groups[key]); }
		const o = document.createElement('option');
		o.value = m.id;
		o.textContent = `mission ${m.seed} · ${OUTCOME_SHORT[m.outcome] || m.outcome}`;
		groups[key].append(o);
	}
	if (chosen && index.some((m) => m.id === chosen)) sel.value = chosen;
	sel.onchange = () => { setLive(false); loadMission(sel.value); };
}

async function loadIndex() {
	index = await fetchIndex();
	const sel = $('missionSel');
	buildList();
	renderScore();
	setInterval(refreshIndex, INDEX_POLL_MS);
	await fetchLive().catch(() => {});
	setInterval(liveTick, 1000);
	liveTick();

	/* ?mission=fly-L1-s3&t=12&cam=cockpit&paused=1&auto=0 -- open a given moment,
	 * for screenshots and for sharing a clip of one flight. */
	const q = new URLSearchParams(location.search);
	const wanted = q.get('mission');
	const first = (wanted && index.find((m) => m.id === wanted)) || index.find((m) => m.mode === 'fly') || index[0];
	if (!first) return;
	sel.value = first.id;
	await loadMission(first.id);
	if (q.get('auto') === '0') { $('auto').checked = false; $('director').checked = false; }
	if (q.get('paused') === '1') { playing = false; $('play').textContent = '▶'; }
	if (q.has('t')) { t = parseFloat(q.get('t')); preroll = 0; }     // a deep link starts where it says
	if (q.get('cam')) setCam(q.get('cam'));
}

/* The running score per target: the seeing fly against its blind control. */
function renderScore() {
	const parts = [];
	for (const t of [...new Set(index.map((m) => m.target))]) {
		const count = (mode) => {
			const ms = index.filter((m) => m.target === t && m.mode === mode);
			return `${ms.filter((m) => m.landed).length} of ${ms.length}`;
		};
		parts.push(`${targetName(t)}: fly ${count('fly')} · blind ${count('blind')}`);
	}
	$('score').textContent = `LANDINGS · ${parts.join('   ')}`;
}

async function loadMission(id) {
	mission = await (await fetch(`missions/${id}.json`)).json();
	const f = mission.trace_fields;
	rows = mission.trace.map((r) => Object.fromEntries(f.map((k, i) => [k, r[i]])));
	t = rows[0].t;
	endedAt = null;
	logShown = 0;
	exploded = false;
	directed = false;
	fxDone = new Set();
	view.setMission(mission, rows);
	eye.setMission(mission);
	brain.setMission(mission);
	audio.setVoiceRotation(mission.result.level * 7 + mission.result.seed);
	audio.resetVoice();
	preroll = PREROLL;
	spoken = PREROLL + 1;
	setPanel(panel);
	rocket.setVisible(true);
	$('log').querySelector('ol').innerHTML = '';
	$('banner').hidden = true;
	const r = mission.result;
	$('missionTitle').textContent = `${targetName(r.target)} · MISSION ${r.seed}`;
	$('levelTag').textContent = `LEVEL ${r.level}`;
	$('pilotLabel').textContent = r.mode === 'blind'
		? 'pilot: fly · window covered (control flight)'
		: `pilot: fly · ${mission.brain.dataset}, ${mission.brain.neurons.toLocaleString('en-US')} neurons`;
	$('liveTxt').textContent = `REPLAY · the brain computed this flight in ${Math.round(r.wall_s / 60)} min`;
	$('missionSel').value = id;
	buildTimeline();
	setCam(camMode === 'landing' ? 'chase' : camMode);
}

/* ---------------- sampling ---------------- */

function sampleAt(tt) {
	const n = rows.length;
	if (tt <= rows[0].t) return { ...rows[0], i: 0 };
	if (tt >= rows[n - 1].t) return { ...rows[n - 1], i: n - 1 };
	let lo = 0, hi = n - 1;
	while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (rows[mid].t <= tt) lo = mid; else hi = mid; }
	const a = rows[lo], b = rows[hi], k = (tt - a.t) / (b.t - a.t);
	const s = { ...a, t: tt, i: lo };
	for (const key of NUM) if (a[key] != null && b[key] != null) s[key] = a[key] + (b[key] - a[key]) * k;
	s.heading = a.heading + wrap(b.heading - a.heading) * k;
	return s;
}

/* Per-sample rates are 0 or 35 Hz (one spike in a 28.6 ms step); average the
 * last second so the bars and levers show a rate rather than a flicker. */
function rateAround(i, key) {
	let s = 0, n = 0;
	for (let j = i; j >= 0 && rows[i].t - rows[j].t < 1.0; j--) { if (rows[j][key] != null) { s += rows[j][key]; n++; } }
	return n ? s / n : 0;
}

/* ---------------- cameras ---------------- */

/* In-rocket cameras orbit an anchor in the hull's own frame and travel with it;
 * the landing camera orbits the rocket with the ground level under it. Drag to
 * turn, wheel to zoom. Chase and overview use OrbitControls in world space. */
const rigs = {
	cockpit: { ...rocket.rig('cockpit') },
	cabin: { ...rocket.rig('cabin') },
	landing: { az: 0.6, el: 0.16, dist: 4.5, min: 1.5, max: 120, fov: 45 },
	pilot: { az: 0, el: 0, dist: 1, min: 1, max: 1, fov: 82 },          // drag to look round
};

function setCam(mode) {
	camMode = mode;
	document.querySelectorAll('[data-cam]').forEach((x) => x.classList.toggle('on', x.dataset.cam === mode));
	const s = sampleAt(t);
	view.camera.up.set(0, 1, 0);
	const c = new THREE.Vector3(s.x, s.y, 0);
	view.controls.enabled = mode === 'chase' || mode === 'overview';
	if (mode === 'overview') {
		const T = mission.level.target, d = Math.hypot(T[0], T[1]);
		const mid = new THREE.Vector3(T[0] / 2, T[1] / 2, 0);
		view.controls.target.copy(mid);
		view.camera.position.copy(mid).add(new THREE.Vector3(0.3 * d, -0.2 * d, 1.5 * d));
	} else if (mode === 'chase') {
		view.controls.target.copy(c);
		view.camera.position.copy(c).add(s.t < 3 ? new THREE.Vector3(1.9, -0.35, 2.9) : new THREE.Vector3(1.2, -0.3, 2.3));
	}
	if (view.controls.enabled && view.camera.fov !== 50) { view.camera.fov = 50; view.camera.updateProjectionMatrix(); }
	lastTarget.copy(c);
	rocket.setCameraMode(mode);
}

const _u = new THREE.Vector3(), _f = new THREE.Vector3(), _r = new THREE.Vector3();
function followCamera(s) {
	const c = new THREE.Vector3(s.x, s.y, 0);
	const rig = rigs[camMode];
	if (camMode === 'chase') {
		view.camera.position.add(c.clone().sub(lastTarget));
		view.controls.target.copy(c);
	} else if (camMode === 'pilot') {
		const v = rocket.pilotView(rig.az, rig.el);
		if (view.camera.fov !== v.fov) { view.camera.fov = v.fov; view.camera.updateProjectionMatrix(); }
		view.camera.position.copy(v.position);
		view.camera.up.copy(v.up);
		view.camera.lookAt(v.target);
	} else if (rig) {
		if (view.camera.fov !== rig.fov) { view.camera.fov = rig.fov; view.camera.updateProjectionMatrix(); }
		const ca = Math.cos(rig.el);
		if (camMode === 'landing') {
			/* keep the ground in the frame: aim between the rocket and the surface,
			 * and pull back while it is still high */
			const T = mission.level.target;
			_u.set(s.x - T[0], s.y - T[1], 0).normalize();
			_f.set(0, 0, 1);
			_r.crossVectors(_u, _f).normalize();
			const alt = Math.max(0, Math.min(40, s.alt ?? 40));
			const look = c.clone().addScaledVector(_u, -alt * 0.3);
			const dist = rig.dist * (1 + alt / 6);
			view.camera.position.copy(look).addScaledVector(_r, Math.sin(rig.az) * ca * dist)
				.addScaledVector(_u, Math.sin(rig.el) * dist).addScaledVector(_f, Math.cos(rig.az) * ca * dist);
			view.camera.up.copy(_u);
			view.camera.lookAt(look);
		} else {
			const [ax, ay, az] = rig.anchor;
			view.camera.position.copy(rocket.local(ax + Math.sin(rig.az) * ca * rig.dist, ay + Math.sin(rig.el) * rig.dist, az + Math.cos(rig.az) * ca * rig.dist));
			view.camera.up.copy(rocket.axis(0, 1, 0));
			view.camera.lookAt(rocket.local(ax, ay, az));
		}
	}
	lastTarget.copy(new THREE.Vector3(s.x, s.y, 0));
}

/* One finger turns the camera, two pinch it closer, a wheel does the same on a
 * desktop. Every pointer is tracked rather than just the last one: with two
 * fingers down, a single "last position" jumps between them and the view spins. */
const canvas = $('view');
const pointers = new Map();
let pinch = 0;

const spread = () => {
	const [a, b] = [...pointers.values()];
	return Math.hypot(a.x - b.x, a.y - b.y);
};

canvas.addEventListener('pointerdown', (e) => {
	if (!rigs[camMode]) return;
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	canvas.setPointerCapture(e.pointerId);
	if (pointers.size === 2) pinch = spread();
});
canvas.addEventListener('pointermove', (e) => {
	const r = rigs[camMode];
	if (!r || !pointers.has(e.pointerId)) return;
	const was = pointers.get(e.pointerId);
	pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
	if (pointers.size === 1) {
		r.az -= (e.clientX - was.x) * 0.006;
		r.el = clamp(r.el + (e.clientY - was.y) * 0.006, -1.45, 1.45);
	} else if (pointers.size === 2) {
		const now = spread();
		if (pinch > 0 && now > 0) r.dist = clamp(r.dist * (pinch / now), r.min, r.max);
		pinch = now;
	}
});
const liftPointer = (e) => {
	pointers.delete(e.pointerId);
	if (pointers.size < 2) pinch = 0;
};
canvas.addEventListener('pointerup', liftPointer);
canvas.addEventListener('pointercancel', liftPointer);
canvas.addEventListener('wheel', (e) => {
	const r = rigs[camMode];
	if (!r) return;
	e.preventDefault();
	r.dist = clamp(r.dist * Math.exp(e.deltaY * 0.0012), r.min, r.max);
}, { passive: false });

/* The director: cuts to the landing camera when the flip begins, and out of the
 * rocket when it is gone. Any camera button overrides it. */
function director(s) {
	if (!$('director').checked) return;
	if (!directed && camMode === 'chase' && ['flip', 'landing', 'touch', 'post'].includes(s.phase)) {
		directed = true;
		setCam('landing');
	}
}

/* ---------------- effects from the simulation's own events ---------------- */

function events(s) {
	const last = s.i >= rows.length - 1;          // at the end, whatever is left happens now
	for (const [k, e] of mission.events.entries()) {
		if ((e.t > s.t + 1e-6 && !last) || fxDone.has(k)) continue;
		fxDone.add(k);
		audio.event(e.type);
		if (e.type === 'liftoff') {
			view.fx.dust(new THREE.Vector3(0, R_EARTH + 0.02, 0), new THREE.Vector3(0, 1, 0));
		} else if (e.type === 'touchdown') {
			const T = mission.level.target;
			const feet = rocket.root.position.clone();
			view.fx.dust(feet, feet.clone().sub(new THREE.Vector3(T[0], T[1], 0)).normalize());
		} else if (e.type === 'explosion') {
			view.fx.explode(new THREE.Vector3(s.x, s.y, 0), 1.3);
			rocket.setVisible(false);
			exploded = true;
			if (camMode === 'cockpit' || camMode === 'cabin' || camMode === 'pilot') setCam('chase');
		}
	}
}

function smoke(s, now) {
	const earthAlt = Math.hypot(s.x, s.y) - R_EARTH;
	if (exploded || s.t < 0 || s.throttle < 0.5 || earthAlt > 45 || now - lastSmoke < 40) return;
	lastSmoke = now;
	const dir = new THREE.Vector3(Math.cos(s.heading), Math.sin(s.heading), 0);
	view.fx.smoke(rocket.root.position.clone().addScaledVector(dir, -0.15), dir.multiplyScalar(-1.2));
}

/* ---------------- HUD ---------------- */

function clockText(tt) {
	const a = Math.abs(tt), h = Math.floor(a / 3600), m = Math.floor(a / 60) % 60, sec = Math.floor(a % 60);
	const p = (x) => String(x).padStart(2, '0');
	return `T${tt < 0 ? '−' : '+'} ${p(h)}:${p(m)}:${p(sec)}`;
}

function side(deg) { return Math.abs(deg) < 1 ? 'dead centre' : `${Math.abs(deg).toFixed(0)}° ${deg > 0 ? 'left' : 'right'}`; }

function hud(s) {
	const lvl = mission.level;
	/* waiting for a scheduled launch: the big clock counts down to it. Otherwise
	 * the countdown shows the number the voice is saying -- both round up. */
	const toLaunch = LIVE.on && holding && LIVE.interval_s
		? slotStartOf(serverNow()) + LIVE.interval_s - serverNow() : 0;
	$('clock').textContent = clockText(toLaunch > 0 ? -toLaunch : preroll > 0 ? -Math.ceil(preroll) : s.t);
	const earthAlt = Math.max(0, Math.hypot(s.x, s.y) - R_EARTH - ROCKET_L / 2);
	const overTarget = s.alt < earthAlt;
	const alt = Math.max(0, overTarget ? s.alt : earthAlt);
	const spd = Math.hypot(s.vr || 0, s.vt || 0);
	gauge($('gSpeed'), spd / 50, spd.toFixed(1), 'U/S');
	gauge($('gAlt'), Math.log10(1 + alt) / Math.log10(1 + 1200), alt < 100 ? alt.toFixed(1) : alt.toFixed(0), 'U');
	$('altLbl').textContent = overTarget ? `ALTITUDE ABOVE ${targetName(lvl.name)}` : 'ALTITUDE ABOVE EARTH';
	gauge($('gG'), (s.g || 0) / 3, (s.g || 0).toFixed(2), 'G');
	const fuel = Math.max(0, (s.fuel ?? 0) / lvl.fuel_s);
	gauge($('gFuel'), fuel, (fuel * 100).toFixed(0), '%');
	$('stage').textContent = toLaunch > 0 ? 'HOLD FOR LAUNCH'
		: endedAt ? OUTCOME[mission.result.outcome] : PHASE[s.phase] || '';
	const dist = Math.hypot(lvl.target[0] - s.x, lvl.target[1] - s.y) - lvl.R;
	const aim = s.view === 'down' ? `PAD ${side(s.rel_deg)}` : `${targetName(lvl.name)} ${side(s.rel_deg)}`;
	$('details').textContent = `${dist.toFixed(0)} U TO ${targetName(lvl.name)} · ${aim} · THROTTLE ${(s.throttle * 100).toFixed(0)}% · VERT ${(-(s.vr || 0)).toFixed(1)} · LAT ${(s.vt || 0).toFixed(1)} U/S`;
	const R = rateAround(s.i, 'R_hz'), L = rateAround(s.i, 'L_hz');
	$('hzR').textContent = R.toFixed(0); $('hzL').textContent = L.toFixed(0);
	$('barR').style.width = `${Math.min(100, R / 60 * 100)}%`;
	$('barL').style.width = `${Math.min(100, L / 60 * 100)}%`;
	const lever = s.lever || 0;
	$('leverKnob').style.left = `${50 - lever * 46}%`;
	$('leverTxt').textContent = s.phase === 'flip' ? 'lever off: flip in progress'
		: Math.abs(lever) < 0.1 ? 'lever: centred'
		: `lever: ${lever > 0 ? 'left' : 'right'} ${(Math.abs(lever) * 100).toFixed(0)}% · ${s.view === 'down' ? 'sideways' : 'turn'}`;
	$('gain').textContent = s.eye_gain < 0.999 ? `sensitivity ${(s.eye_gain * 100).toFixed(0)}%` : '';
	timelineStep(s);
	rocket.drawScreens({
		alt: `${alt.toFixed(1)}`, speed: `${spd.toFixed(1)}`, g: `${(s.g || 0).toFixed(2)} g`,
		fuel: `${(fuel * 100).toFixed(0)}%`, throttle: `${(s.throttle * 100).toFixed(0)}%`,
		L, R, mode: PHASE[s.phase] || '',
	}, performance.now());
}

function gauge(cv, frac, value, unit) {
	const g = cv.getContext('2d'), W = cv.width, H = cv.height, cx = W / 2, cy = H / 2, r = W / 2 - 8;
	g.clearRect(0, 0, W, H);
	const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
	g.lineCap = 'butt';
	g.lineWidth = 5;
	g.strokeStyle = 'rgba(255,255,255,0.16)';
	g.beginPath(); g.arc(cx, cy, r, a0, a1); g.stroke();
	g.strokeStyle = '#ffffff';
	g.beginPath(); g.arc(cx, cy, r, a0, a0 + (a1 - a0) * clamp(frac, 0, 1)); g.stroke();
	g.fillStyle = '#fff';
	g.textAlign = 'center';
	g.font = '500 30px "Segoe UI", "Helvetica Neue", Arial, sans-serif';
	g.fillText(value, cx, cy + 8);
	g.font = '600 11px "Segoe UI", Arial, sans-serif';
	g.fillStyle = 'rgba(255,255,255,0.6)';
	g.fillText(unit, cx, cy + 28);
}

function buildTimeline() {
	const tl = $('timeline');
	tl.querySelectorAll('.tl-ev').forEach((n) => n.remove());
	const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
	let k = 0;
	for (const e of mission.events) {
		if (!TIMELINE[e.type]) continue;
		const d = document.createElement('div');
		d.className = `tl-ev${e.type === 'explosion' ? ' bad' : ''}${k++ % 2 ? ' up' : ''}`;
		d.style.left = `${(e.t - t0) / (t1 - t0) * 100}%`;
		d.dataset.t = e.t;
		d.innerHTML = `<i></i><span>${TIMELINE[e.type]}</span>`;
		tl.append(d);
	}
}

function timelineStep(s) {
	const t0 = rows[0].t, t1 = rows[rows.length - 1].t;
	$('tlFill').style.width = `${clamp((s.t - t0) / (t1 - t0), 0, 1) * 100}%`;
	for (const d of $('timeline').querySelectorAll('.tl-ev')) d.classList.toggle('past', +d.dataset.t <= s.t);
}

function revealLog() {
	const ol = $('log').querySelector('ol');
	while (logShown < mission.log.length && mission.log[logShown].t <= t) {
		const e = mission.log[logShown++];
		const li = document.createElement('li');
		li.innerHTML = `<span class="t">T+${e.t.toFixed(1)}</span>`;
		li.append(document.createTextNode(e.text));
		ol.append(li);
		ol.scrollTop = ol.scrollHeight;
	}
}

function finish() {
	const ol = $('log').querySelector('ol');
	const li = document.createElement('li');
	li.className = 'cause';
	li.textContent = mission.cause;
	ol.append(li);
	ol.scrollTop = ol.scrollHeight;
	const b = $('banner');
	b.className = mission.landed ? 'good' : 'bad';
	$('bannerTitle').textContent = OUTCOME[mission.result.outcome] || mission.result.outcome;
	$('bannerCause').textContent = mission.cause;
	b.hidden = false;
}

function nextMission() {
	const flights = index.filter((m) => m.mode === mission.result.mode);
	const i = flights.findIndex((m) => m.id === mission.id);
	const next = flights[(i + 1) % flights.length];
	if (next) loadMission(next.id);
}

/* ---------------- loop ---------------- */

const clock = new THREE.Clock();
let lastHud = 0, lastEye = 0, lastBrain = 0, booted = false;

function frame() {
	requestAnimationFrame(frame);
	const dt = Math.min(0.1, clock.getDelta());
	if (mission) {
		const tEnd = rows[rows.length - 1].t;
		if (preroll > 0 && playing) {
			preroll = Math.max(0, preroll - dt);           // the broadcast countdown, not simulation time
			const n = Math.ceil(preroll);
			if (n < spoken) { spoken = n; audio.countdown(n); }
		} else if (playing && endedAt === null) t = Math.min(tEnd, t + dt * speed);
		const s = sampleAt(t);
		const now = performance.now();
		events(s);
		const onGround = s.phase === 'touch' || s.phase === 'post';
		const burning = !exploded && !onGround && (s.t > -0.35 && s.t < 0 || s.throttle > 0.01);
		rocket.update(s, dt, {
			burning, throttle: s.t < 0 ? 0.25 : s.throttle,
			legs: s.t < 2.5 || ['landing', 'touch', 'post'].includes(s.phase) ? 1 : 0,
			rcs: s.phase === 'landing' ? s.lever : 0,
			L: rateAround(s.i, 'L_hz'), R: rateAround(s.i, 'R_hz'),
			touched: onGround, active: s.t < 0 ? 0.25 : 0.6,
		});
		view.update(s, dt, Math.max(0, s.t));
		smoke(s, now);
		director(s);
		followCamera(s);
		audio.setEngine(burning, s.t < 0 ? 0.25 : s.throttle, clamp(1 - (Math.hypot(s.x, s.y) - R_EARTH) / 45, 0, 1));
		if (panel === 'brain' && now - lastBrain > 55) { brain.draw(s.i, (now - lastBrain) / 1000); lastBrain = now; }
		if (now - lastHud > 66) { hud(s); lastHud = now; }
		if (now - lastEye > 100) {
			eye.draw(s.x, s.y, s.heading, s.eye_gain, mission.result.mode === 'blind', s.view, Math.max(0, s.t));
			rocket.eyeUpdated();
			lastEye = now;
		}
		revealLog();
		if (t >= tEnd && endedAt === null) { endedAt = now; finish(); }
		if (endedAt !== null && $('auto').checked && !LIVE.on && now - endedAt > 9000) nextMission();
		if (!booted) { booted = true; $('boot').classList.add('gone'); setTimeout(() => $('boot').remove(), 900); }
	}
	view.render();
}

/* ---------------- controls ---------------- */

$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚' : '▶'; };
$('restart').onclick = () => mission && loadMission(mission.id);
$('liveBtn').onclick = () => { audio.unlock(); setLive(!LIVE.on); };
$('rulesBtn').onclick = () => {
	$('rules').hidden = !$('rules').hidden;
	$('rulesBtn').classList.toggle('on', !$('rules').hidden);
};
for (const b of document.querySelectorAll('[data-speed]')) {
	b.onclick = () => {
		speed = +b.dataset.speed;
		document.querySelectorAll('[data-speed]').forEach((x) => x.classList.toggle('on', x === b));
	};
}
for (const b of document.querySelectorAll('[data-cam]')) b.onclick = () => { directed = true; setCam(b.dataset.cam); };

/* the side panel: what the pilot sees, or where its neurons are firing */
function setPanel(which) {
	panel = which;
	document.querySelectorAll('[data-panel]').forEach((x) => x.classList.toggle('on', x.dataset.panel === which));
	$('eye').hidden = which !== 'eye';
	$('brainCanvas').hidden = which !== 'brain';
	$('panelNote').textContent = which === 'eye'
		? "this frame goes into the fly's 3,335 photoreceptors. Only its brain steers."
		: brain.available
			? 'a fixed sample of neurons at their real soma coordinates; a cell flashes when it fires'
			: 'this flight was computed before brain recording — choose a newer mission';
}
for (const b of document.querySelectorAll('[data-panel]')) b.onclick = () => setPanel(b.dataset.panel);

$('sound').onclick = () => {
	audio.unlock();
	audio.setMuted(!audio.muted);
	$('sound').classList.toggle('on', !audio.muted);
};
addEventListener('pointerdown', () => audio.unlock(), { once: true });
addEventListener('keydown', (e) => {
	if (e.code === 'Space') { e.preventDefault(); $('play').click(); }
});

/* Who is aboard. The passengers are not part of a flight: there is one list --
 * whoever holds the token right now -- and every flight on the page shows it,
 * the newest and the oldest alike. The server re-reads it from Robinhood Chain
 * (sim/holders.py) and the page picks the change up while it plays. */
const CREW_REFRESH_MS = 60_000;

function setCrew(crew) {
	const real = crew && crew.seats && crew.seats.length;
	rocket.setCrew(real ? crew.seats.map((s) => s.label) : DEMO_CREW);
	$('crewNote').textContent = real
		? `passengers are the top 10 holders of ${crew.token.symbol} on Robinhood Chain right now. `
			+ 'They have no brain and no effect on the flight.'
		: 'passengers are the top-10 holders (demo addresses until the token launches). '
			+ 'They have no brain and no effect on the flight.';
}

async function refreshCrew() {
	try {
		const r = await fetch(`missions/crew.json?t=${Date.now()}`, { cache: 'no-store' });
		setCrew(r.ok ? await r.json() : null);
	} catch (err) {
		/* the seats keep whoever is in them; a missing list is not a broken page */
	}
}

function demoAddresses(n) {
	const abc = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
	let seed = 20260911;
	const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
	return Array.from({ length: n }, () => {
		const s = Array.from({ length: 8 }, () => abc[Math.floor(rnd() * abc.length)]).join('');
		return `${s.slice(0, 4)}…${s.slice(4)}`;
	});
}

refreshCrew();
setInterval(refreshCrew, CREW_REFRESH_MS);

$('caCopy').addEventListener('click', async () => {
	const addr = $('ca').dataset.addr;
	try {
		await navigator.clipboard.writeText(addr);
	} catch {
		const field = Object.assign(document.createElement('textarea'), { value: addr });
		document.body.append(field);
		field.select();
		document.execCommand('copy');
		field.remove();
	}
	$('caCopy').textContent = 'copied';
	$('caCopy').classList.add('done');
	setTimeout(() => { $('caCopy').textContent = 'copy'; $('caCopy').classList.remove('done'); }, 1500);
});

loadIndex().catch((err) => {
	console.error(err);
	$('stage').textContent = 'no missions/index.json — run sim/export.py';
});
frame();
