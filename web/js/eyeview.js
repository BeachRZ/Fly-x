/* The pilot's window: the frame the fly's retina receives.
 *
 * Redrawn by the same rules as world.py's render_forward() and render_down():
 * the same star table (it ships in the mission bundle), the same field of view
 * and horizon line, the night-side Earth disc, the target as a bright disc with
 * a Gaussian halo, dark asteroids occluding what is behind them, meteors fading
 * with distance, and -- after the flip -- the landing camera looking down at the
 * ground and the pad's lights, in the pilot's own left/right. The eye's light
 * adaptation is applied on top, so what is shown is what the 3,335
 * photoreceptors were actually fed.
 */

export function createEyeView(canvas) {
	let eye = null, lvl = null, img = null;
	let W = 640, H = 480;
	const ctx = canvas.getContext('2d');

	function setMission(m) {
		eye = m.eye;
		lvl = m.level;
		W = eye.W; H = eye.H;
		canvas.width = W; canvas.height = H;
		img = ctx.createImageData(W, H);
	}

	const TAU = Math.PI * 2;
	const wrap = (a) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;

	function draw(x, y, heading, gain = 1, blind = false, view = 'fwd', t = 0) {
		if (!eye) return;
		const px = img.data;
		px.fill(0);
		for (let i = 3; i < px.length; i += 4) px[i] = 255;
		const half = eye.FOV / 2;
		const toX = (rel) => W / 2 - rel / half * (W / 2);
		const angPx = (a) => a / half * (W / 2);
		const HY = eye.HORIZON_Y;

		const glow = (cx, cy, core, col, sigmaMin = 18) => {
			const sigma = Math.max(sigmaMin, core * 2.5), rad = core + 3 * sigma;
			const x0 = Math.max(0, Math.trunc(cx - rad)), x1 = Math.min(W, Math.trunc(cx + rad) + 1);
			const y0 = Math.max(0, Math.trunc(cy - rad)), y1 = Math.min(H, Math.trunc(cy + rad) + 1);
			for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
				const d = Math.hypot(xx - cx, yy - cy);
				const v = d <= core ? 1 : 0.55 * Math.exp(-((d - core) ** 2) / (2 * sigma * sigma));
				if (v < 0.003) continue;
				const i = (yy * W + xx) * 4;
				px[i] = Math.min(255, px[i] + col[0] * v);
				px[i + 1] = Math.min(255, px[i + 1] + col[1] * v);
				px[i + 2] = Math.min(255, px[i + 2] + col[2] * v);
			}
		};
		const disc = (cx, cy, r, col) => {
			const x0 = Math.max(0, Math.trunc(cx - r)), x1 = Math.min(W, Math.trunc(cx + r) + 1);
			const y0 = Math.max(0, Math.trunc(cy - r)), y1 = Math.min(H, Math.trunc(cy + r) + 1);
			for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
				if (Math.hypot(xx - cx, yy - cy) > r) continue;
				const i = (yy * W + xx) * 4;
				px[i] = col[0]; px[i + 1] = col[1]; px[i + 2] = col[2];
			}
		};
		const stars = (center, mirror) => {
			for (const [a, sy, b] of eye.stars) {
				let rel = wrap(a - center);
				if (mirror) rel = -rel;
				if (Math.abs(rel) >= half) continue;
				const sx = Math.min(W - 1, Math.max(0, Math.trunc(toX(rel))));
				const i = (sy * W + sx) * 4;
				px[i] = px[i + 1] = px[i + 2] = b;
			}
		};

		if (!blind && view === 'fwd') {
			stars(heading, false);
			/* Earth, night side */
			const ed = Math.hypot(x, y);
			const eh = Math.asin(Math.min(1, eye.R_EARTH / Math.max(ed, eye.R_EARTH)));
			const relE = wrap(Math.atan2(-y, -x) - heading);
			if (Math.abs(relE) < half + eh) {
				const rpx = angPx(eh), cx = toX(relE), cy = HY + rpx;
				const x0 = Math.max(0, Math.floor(cx - rpx)), x1 = Math.min(W, Math.ceil(cx + rpx) + 1);
				const y0 = Math.max(0, Math.floor(cy - rpx)), y1 = Math.min(H, Math.ceil(cy + rpx) + 1);
				for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
					const d = Math.hypot(xx - cx, yy - cy);
					if (d > rpx) continue;
					const i = (yy * W + xx) * 4;
					if (d > rpx - 3) { px[i] = 30; px[i + 1] = 55; px[i + 2] = 110; }
					else { px[i] = 8; px[i + 1] = 11; px[i + 2] = 22; }
				}
			}
			/* the target */
			const [tx, ty] = lvl.target;
			const md = Math.hypot(tx - x, ty - y);
			const relT = wrap(Math.atan2(ty - y, tx - x) - heading);
			glow(toX(relT), HY, Math.max(8, angPx(Math.asin(Math.min(1, lvl.R / Math.max(md, lvl.R))))), lvl.color);
			/* dark rocks, far ones first */
			const rocks = lvl.asteroids.map(([ax, ay, r]) => [ax, ay, r, Math.hypot(ax - x, ay - y)]).sort((a, b) => b[3] - a[3]);
			for (const [ax, ay, r, d] of rocks) {
				const ang = Math.asin(Math.min(1, r / Math.max(d, r)));
				const rel = wrap(Math.atan2(ay - y, ax - x) - heading);
				if (Math.abs(rel) < half + ang) disc(toX(rel), HY, Math.max(1, angPx(ang)), eye.AST_COLOR);
			}
			/* meteors in flight */
			for (const [x0, y0, vx, vy, t0, t1, r] of lvl.meteors) {
				if (t < t0 || t > t1) continue;
				const mx = x0 + vx * (t - t0), my = y0 + vy * (t - t0);
				const d = Math.hypot(mx - x, my - y);
				const ang = Math.asin(Math.min(1, r / Math.max(d, r)));
				const rel = wrap(Math.atan2(my - y, mx - x) - heading);
				if (Math.abs(rel) >= half + ang) continue;
				const k = Math.min(1, (eye.METEOR_FADE / Math.max(d, 1e-6)) ** 2);
				glow(toX(rel), HY, Math.max(3, angPx(ang)), lvl.meteor_color.map((c) => c * k), 12);
			}
		} else if (!blind) {
			/* landing camera: straight down, the pilot's left on the left */
			const [tx, ty] = lvl.target;
			const dvx = x - tx, dvy = y - ty, d = Math.hypot(dvx, dvy);
			const nx = dvx / d, ny = dvy / d, tvx = -ny, tvy = nx;
			const theta = Math.atan2(ny, nx);
			stars(theta + Math.PI, true);
			const aAng = Math.asin(Math.min(1, lvl.R / d)), aPx = angPx(aAng);
			const [l1, p1, l2, p2] = lvl.terrain;
			for (let xx = 0; xx < W; xx++) {
				const b = (W / 2 - xx) / (W / 2) * half;
				if (Math.abs(b) >= aAng) continue;
				const s = d * Math.cos(b) - Math.sqrt(Math.max(0, lvl.R ** 2 - (d * Math.sin(b)) ** 2));
				const hx = d * nx + s * (-nx * Math.cos(b) + tvx * Math.sin(b));
				const hy = d * ny + s * (-ny * Math.cos(b) + tvy * Math.sin(b));
				const arc = wrap(Math.atan2(hy, hx) - lvl.pad_phi) * lvl.R;
				const slope = Math.abs(arc) <= eye.PAD_R ? 0
					: eye.SLOPE_AMP * Math.abs(0.6 * Math.sin(arc / l1 + p1) + 0.4 * Math.sin(arc / l2 + p2));
				const shade = 1 - 0.45 * slope / eye.SLOPE_AMP;
				const c0 = Math.trunc(lvl.surface[0] * shade), c1 = Math.trunc(lvl.surface[1] * shade), c2 = Math.trunc(lvl.surface[2] * shade);
				const hh = Math.sqrt(Math.max(0, aPx * aPx - (xx - W / 2) ** 2));
				const y0 = Math.max(0, Math.ceil(HY - hh)), y1 = Math.min(H - 1, Math.floor(HY + hh));
				for (let yy = y0; yy <= y1; yy++) {
					const i = (yy * W + xx) * 4;
					px[i] = c0; px[i + 1] = c1; px[i + 2] = c2;
				}
			}
			const ppx = tx + lvl.R * Math.cos(lvl.pad_phi), ppy = ty + lvl.R * Math.sin(lvl.pad_phi);
			if (Math.cos(lvl.pad_phi - theta) > lvl.R / d) {
				const vx = ppx - x, vy = ppy - y, dist = Math.hypot(vx, vy);
				const bp = wrap(theta + Math.PI - Math.atan2(vy, vx));
				if (Math.abs(bp) < half + 0.2) glow(toX(bp), HY, Math.max(3, angPx(Math.atan(eye.PAD_R / Math.max(dist, 1e-6)))), eye.PAD_COLOR, 10);
			}
		}

		/* Light adaptation: the simulation scales linear light; in sRGB that is
		 * close to a gain^(1/2.2) multiply, which is plenty for a display. */
		if (gain < 0.999) {
			const k = Math.pow(gain, 1 / 2.2);
			for (let i = 0; i < px.length; i += 4) { px[i] *= k; px[i + 1] *= k; px[i + 2] *= k; }
		}
		ctx.putImageData(img, 0, 0);

		ctx.strokeStyle = 'rgba(224,38,43,0.55)';
		ctx.lineWidth = 2;
		ctx.beginPath();
		ctx.moveTo(W / 2, HY - 26); ctx.lineTo(W / 2, HY - 8);
		ctx.moveTo(W / 2, HY + 8); ctx.lineTo(W / 2, HY + 26);
		ctx.stroke();
		ctx.font = '600 22px ui-monospace, Menlo, Consolas, monospace';
		ctx.textAlign = 'left';
		ctx.fillStyle = 'rgba(255,255,255,0.7)';
		ctx.fillText(view === 'down' ? 'LANDING CAMERA' : 'WINDOW', 14, H - 16);
		if (blind) {
			ctx.fillStyle = 'rgba(224,38,43,0.9)';
			ctx.font = '700 28px ui-monospace, Menlo, Consolas, monospace';
			ctx.textAlign = 'center';
			ctx.fillText('WINDOW COVERED', W / 2, H / 2);
		}
	}

	return { setMission, draw };
}
