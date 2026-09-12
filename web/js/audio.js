/* Sound for the webcast, synthesised in the browser -- no audio files.
 *
 * Engine roar is filtered noise plus a low rumble, its level following the
 * throttle the simulation recorded; thicker in the air, thinner in vacuum (what
 * an onboard microphone would pick up through the structure). The explosion is
 * built from a sub-bass drop, a saturated low body, a metallic tear and a long
 * tail of debris -- no sharp click, because a rocket coming apart is a roar and
 * not a clap.
 *
 * The voice is the browser's own speech synthesis, kept plain. Only Google's
 * English voices are used; the system ones are skipped because a locally
 * installed voice may read English text with its own language's phonetics.
 *
 * This is sound design, not physics: the flight itself is silent data.
 */

const CALLOUTS = {
	flip_start: 'Flip',
	flip_end: 'Landing burn',
	touchdown: 'Touchdown',
	explosion: 'Loss of vehicle',
	fuel_out: 'Fuel depleted',
};
const VOICE_VOLUME = 0.5;

export function createAudio() {
	let ctx = null, master = null, engine = null, shaper = null;
	let muted = false, ready = false;
	let voices = [], rotation = 0, lastSaid = '', lastSaidAt = 0;

	/* Google's English voices only: male and female are enough. */
	function loadVoices() {
		if (!window.speechSynthesis) return;
		const all = speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
		const google = all.filter((v) => /google/i.test(v.name));
		const usable = google.length ? google : all.filter((v) => !/microsoft/i.test(v.name));
		if (usable.length) voices = usable.slice().sort((a, b) => a.name.localeCompare(b.name)).slice(0, 3);
	}
	loadVoices();
	if (window.speechSynthesis) speechSynthesis.addEventListener('voiceschanged', loadVoices);

	function noiseBuffer(seconds, brown) {
		const len = Math.ceil(seconds * ctx.sampleRate);
		const buf = ctx.createBuffer(1, len, ctx.sampleRate);
		const d = buf.getChannelData(0);
		let last = 0;
		for (let i = 0; i < len; i++) {
			const white = Math.random() * 2 - 1;
			if (brown) { last = (last + 0.02 * white) / 1.02; d[i] = last * 3.2; } else d[i] = white;
		}
		return buf;
	}

	function build() {
		if (ctx) return;
		const AC = window.AudioContext || window.webkitAudioContext;
		if (!AC) return;
		ctx = new AC();
		master = ctx.createGain();
		master.gain.value = 0.9;
		master.connect(ctx.destination);

		/* a soft saturation stage, for the explosion body */
		shaper = ctx.createWaveShaper();
		const n = 1024, curve = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			const x = (i / (n - 1)) * 2 - 1;
			curve[i] = Math.tanh(2.4 * x);
		}
		shaper.curve = curve;
		shaper.oversample = '2x';
		shaper.connect(master);

		/* engine: looping brown noise -> lowpass -> gain, plus two low oscillators */
		const src = ctx.createBufferSource();
		src.buffer = noiseBuffer(2, true);
		src.loop = true;
		const lp = ctx.createBiquadFilter();
		lp.type = 'lowpass';
		lp.frequency.value = 400;
		const gain = ctx.createGain();
		gain.gain.value = 0;
		src.connect(lp).connect(gain).connect(master);
		const rumble = ctx.createGain();
		rumble.gain.value = 0;
		rumble.connect(master);
		for (const f of [38, 52]) {
			const o = ctx.createOscillator();
			o.type = 'sine';
			o.frequency.value = f;
			o.connect(rumble);
			o.start();
		}
		src.start();
		engine = { gain, lp, rumble };
		ready = true;
	}

	/* Browsers only allow sound after a gesture; call this from any click. */
	function unlock() {
		build();
		if (ctx && ctx.state === 'suspended') ctx.resume();
		loadVoices();
	}

	function setMuted(v) {
		muted = v;
		if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ctx.currentTime, 0.05);
		if (v && window.speechSynthesis) speechSynthesis.cancel();
	}

	/* throttle 0..1, air 0..1 (1 = dense atmosphere), on = engine burning */
	function setEngine(on, throttle = 1, air = 0) {
		if (!ready || muted) return;
		const t = ctx.currentTime;
		const level = on ? 0.16 + 0.5 * throttle : 0;
		engine.gain.gain.setTargetAtTime(level * (0.45 + 0.55 * air), t, 0.08);
		engine.rumble.gain.setTargetAtTime(on ? 0.05 + 0.12 * throttle : 0, t, 0.1);
		engine.lp.frequency.setTargetAtTime(220 + 900 * throttle * (0.4 + 0.6 * air), t, 0.15);
	}

	/* a band of noise, its filter sweeping, with a chosen attack */
	function noiseSweep({ dur, f0, f1, level, q = 0.6, attack = 0.02, delay = 0, type = 'lowpass', dirty = false }) {
		const src = ctx.createBufferSource();
		src.buffer = noiseBuffer(dur + 0.1, true);
		const f = ctx.createBiquadFilter();
		f.type = type;
		f.Q.value = q;
		const t = ctx.currentTime + delay;
		f.frequency.setValueAtTime(f0, t);
		f.frequency.exponentialRampToValueAtTime(f1, t + dur);
		const g = ctx.createGain();
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(level, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		src.connect(f).connect(g).connect(dirty ? shaper : master);
		src.start(t);
		src.stop(t + dur + 0.1);
	}

	function tone({ f0, f1, dur, level, delay = 0, type = 'sine', attack = 0.02 }) {
		const o = ctx.createOscillator();
		const g = ctx.createGain();
		const t = ctx.currentTime + delay;
		o.type = type;
		o.frequency.setValueAtTime(f0, t);
		o.frequency.exponentialRampToValueAtTime(f1, t + dur);
		g.gain.setValueAtTime(0.0001, t);
		g.gain.exponentialRampToValueAtTime(level, t + attack);
		g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
		o.connect(g).connect(master);
		o.start(t);
		o.stop(t + dur + 0.05);
	}

	/* A rocket coming apart: a deep drop, a saturated roar, metal tearing, and
	 * a long tail. No sharp transient -- that is what made it sound like a clap. */
	function explosion() {
		tone({ f0: 90, f1: 22, dur: 2.8, level: 1.0, attack: 0.05 });
		tone({ f0: 46, f1: 18, dur: 4.0, level: 0.7, attack: 0.12, delay: 0.05 });
		noiseSweep({ dur: 3.8, f0: 900, f1: 55, level: 0.85, attack: 0.06, dirty: true });
		noiseSweep({ dur: 5.0, f0: 260, f1: 40, level: 0.5, attack: 0.35, delay: 0.15 });
		for (const [d, f] of [[0.02, 230], [0.06, 178], [0.1, 291]]) {         // tearing metal
			tone({ f0: f, f1: f * 0.55, dur: 0.75, level: 0.1, delay: d, type: 'sawtooth', attack: 0.03 });
		}
		for (let i = 0; i < 14; i++) {                                        // debris, thinning out
			noiseSweep({ dur: 0.12 + Math.random() * 0.16, f0: 700 + Math.random() * 900, f1: 180,
				level: 0.05 + Math.random() * 0.07, attack: 0.01, delay: 0.5 + Math.random() * 2.6 });
		}
	}

	function say(text, who = 'computer') {
		if (muted || !window.speechSynthesis) return;
		const now = performance.now();
		if (text === lastSaid && now - lastSaidAt < 1500) return;      // never say the same thing twice
		lastSaid = text;
		lastSaidAt = now;
		const u = new SpeechSynthesisUtterance(text);
		const v = voices.length ? voices[(who === 'control' ? rotation : rotation + 1) % voices.length] : null;
		if (v) { u.voice = v; u.lang = v.lang; }
		u.volume = VOICE_VOLUME;
		u.rate = who === 'control' ? 0.95 : 1.0;
		u.pitch = who === 'control' ? 0.95 : 1.05;
		speechSynthesis.speak(u);
	}

	/* Different voices from mission to mission, so the channel feels staffed. */
	function setVoiceRotation(n) { rotation = Math.abs(n | 0); }

	/* A new mission: drop anything the synthesiser still has queued. */
	function resetVoice() {
		if (window.speechSynthesis) speechSynthesis.cancel();
		lastSaid = '';
	}

	function event(type) {
		if (!ready || muted) return;
		if (type === 'explosion') explosion();
		else if (type === 'touchdown') {
			noiseSweep({ dur: 0.5, f0: 900, f1: 120, level: 0.35, attack: 0.01 });
			tone({ f0: 70, f1: 26, dur: 0.55, level: 0.45, attack: 0.01 });
		} else if (type === 'liftoff') {
			noiseSweep({ dur: 1.8, f0: 1400, f1: 180, level: 0.55, attack: 0.05 });
		}
		if (CALLOUTS[type]) say(CALLOUTS[type], 'computer');
	}

	function countdown(n) { say(n > 0 ? String(n) : 'Liftoff', 'control'); }

	return {
		unlock, setMuted, setEngine, event, countdown, setVoiceRotation, resetVoice,
		get muted() { return muted; },
		get ready() { return ready; },
		get voiceCount() { return voices.length; },
	};
}
