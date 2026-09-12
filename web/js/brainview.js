/* The brain itself: where the firing happens in the fly's nervous system.
 *
 * The simulation records, for every trace row, which of a fixed sample of
 * neurons fired since the previous row. Each of those neurons has a real soma
 * coordinate from the MaleCNS connectome, so this is a map rather than a
 * decoration: x runs left-right across the body, z from the brain down the
 * nerve cord. A cell flashes when it fires and fades afterwards.
 */

const COLORS = {
	ol_intrinsic: [90, 150, 255], ol_sensory: [90, 150, 255], visual_projection: [120, 200, 255],
	visual_centrifugal: [120, 200, 255], cb_intrinsic: [235, 235, 235], cb_sensory: [235, 235, 235],
	descending_neuron: [224, 38, 43], ascending_neuron: [255, 180, 92],
	vnc_intrinsic: [180, 190, 210], vnc_motor: [78, 230, 168], vnc_sensory: [180, 190, 210],
};
const LEGEND = [
	['optic lobes', [90, 150, 255]],
	['central brain', [235, 235, 235]],
	['descending', [224, 38, 43]],
	['ascending', [255, 180, 92]],
	['nerve cord', [180, 190, 210]],
	['motor', [78, 230, 168]],
];

export function createBrainView(canvas) {
	const ctx = canvas.getContext('2d');
	const W = 552, H = 414;                 // twice the size it is shown at, for crisp dots
	canvas.width = W; canvas.height = H;
	let pts = null, spikes = null, lastRow = -1, fired = 0;

	function setMission(m) {
		const b = m.brain_activity;
		lastRow = -1;
		fired = 0;
		if (!b) { pts = null; spikes = null; return; }
		const { x, z, superclass } = b.cells;
		const minX = Math.min(...x), maxX = Math.max(...x);
		const minZ = Math.min(...z), maxZ = Math.max(...z);
		const scale = (H - 54) / (maxZ - minZ);
		pts = x.map((_, i) => ({
			/* x across the canvas, z down it: head at the top, nerve cord below */
			px: W * 0.38 + (x[i] - (minX + maxX) / 2) * scale,
			py: 34 + (z[i] - minZ) * scale,
			col: COLORS[superclass[i]] || [200, 200, 200],
			v: 0,
		}));
		spikes = b.spikes;
	}

	/* row: index of the current trace row; dt: seconds since the last draw */
	function draw(row, dt = 0.06) {
		ctx.fillStyle = '#03040a';
		ctx.fillRect(0, 0, W, H);
		if (!pts) {
			ctx.fillStyle = 'rgba(255,255,255,0.5)';
			ctx.font = '17px ui-monospace, Menlo, Consolas, monospace';
			ctx.textAlign = 'center';
			ctx.fillText('no brain recording for this flight', W / 2, H / 2);
			return;
		}
		for (const p of pts) p.v = Math.max(0, p.v - dt * 1.7);
		if (row !== lastRow) {
			fired = 0;
			/* the rows since the last draw, but never more than a few: jumping to
			 * the middle of a flight must not replay the whole recording at once */
			const from = lastRow < 0 || row - lastRow > 3 ? Math.max(0, row - 1) : lastRow + 1;
			for (let r = from; r <= row; r++) {
				const list = spikes[r];
				if (!list) continue;
				for (const i of list) { if (pts[i]) { pts[i].v = 1; fired++; } }
			}
			lastRow = row;
		}
		for (const p of pts) {
			const [r, g, b] = p.col;
			if (p.v > 0.02) {
				ctx.fillStyle = `rgba(${r},${g},${b},${0.3 + 0.6 * p.v})`;
				ctx.beginPath();
				ctx.arc(p.px, p.py, 3 + 7 * p.v, 0, Math.PI * 2);
				ctx.fill();
				ctx.fillStyle = `rgba(255,255,255,${0.65 * p.v})`;
				ctx.beginPath();
				ctx.arc(p.px, p.py, 2, 0, Math.PI * 2);
				ctx.fill();
			} else {
				ctx.fillStyle = `rgba(${r},${g},${b},0.28)`;
				ctx.fillRect(p.px - 1.1, p.py - 1.1, 2.2, 2.2);
			}
		}
		ctx.textAlign = 'left';
		ctx.font = '700 17px ui-monospace, Menlo, Consolas, monospace';
		ctx.fillStyle = 'rgba(255,255,255,0.85)';
		ctx.fillText(`${fired} OF ${pts.length} FIRING`, 14, 24);
		ctx.font = '14px ui-monospace, Menlo, Consolas, monospace';
		let y = 62;
		for (const [name, [r, g, b]] of LEGEND) {
			ctx.fillStyle = `rgb(${r},${g},${b})`;
			ctx.fillRect(W - 132, y - 9, 10, 10);
			ctx.fillStyle = 'rgba(255,255,255,0.7)';
			ctx.fillText(name, W - 116, y);
			y += 21;
		}
	}

	return { setMission, draw, get available() { return !!pts; } };
}
