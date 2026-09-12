"""FLY X: a real fly brain steers a rocket by what it sees.

Every brain step (one Doom tic of neural time, 1000/35 ms) the pilot's window
is rendered to an RGB frame, sampled by the fly's 3,335 inferred photoreceptors
and integrated through the full MaleCNS graph (DOOMFLY's native kernel). The
pilot's lever is DOOMFLY's own BCI readout -- right DNp20 minus left DNp20
firing -- minus a fixed bias measured once on an empty sky.

Who does what, stated once and never changed:
  the fly       the lever: on the way out it turns the rocket, in the landing it
                pushes the rocket sideways. Nothing else steers.
  the computer  throttle, the flip, braking and the descent rate, the landing
                camera, cutting the engine on touchdown. It never knows where
                the target or the pad is: it only reads its own altitude.
  the world     fixed rules per level (world.py): gravity, air, fuel, rocks,
                meteors, the pad and the ground round it.

Flies turn toward light, and the target is the brightest thing in a night sky.
Nothing here tells the rocket where it is except the picture.

When the legs touch the ground, their touch sensors drive the fly's real leg
mechanosensory neurons (2,522 cells of the leg nerves), through the same
stimulus path DOOMFLY uses for sugar, and the brain's response is recorded.

    python mission.py --calibrate                       measure the empty-sky bias
    python mission.py --mode fly --seed 3 [--level 1]   the fly steers
    python mission.py --mode blind --seed 3             same brain, window painted over
    python mission.py --mode straight --seed 3          nobody steers
    python mission.py --mode oracle --seed 3            perfect pilot (upper bound)
"""
import os
os.environ.setdefault("OPENBLAS_NUM_THREADS", "1")   # DOOMFLY's own perf finding

import argparse
import json
import math
import sys
import time
import types
from collections import deque
from pathlib import Path

import numpy as np

import world as wd
from world import (A_BRAKE, A_RCS, DRAG, DRAG_ATM, FLIP_MARGIN, FLIP_S, G0, H_ATM, K_ALT, K_VR,
                   K_VT, LAT_ALT, LAT_MIN, MAX_TURN, PAD, PAD_R, R_EARTH, ROCKET_L, SLOPE_MAX, THRUST, TILT_VIS,
                   V_CRASH, V_LAT_MAX, V_SOFT, V_TD, VT_TIP, World, wrap)

BRAIN_ROOT = Path(os.environ.get("FLY_BRAIN_ROOT", r"E:\test\fly\doomfly"))
RUNS = Path(os.environ.get("FLY_SPACE_RUNS", r"E:\test\fly\space-runs"))

COUNTDOWN_S = 1.0                # the fly watches the sky on the pad first
TIC_MS = 1000 / 35               # neural time per brain step
SUBSTEPS = 4
ATM_TOP = 3 * H_ATM              # "out of the dense air" for the log

# ---------------------------------------------------------------- steering
TAU_S = 1.0                      # smoothing of the DNp20 difference
GAIN = 1 / 6                     # full lever at 6 Hz away from the bias

# ---------------------------------------------------------------- eye
# Light adaptation. Real fly photoreceptors turn their gain down under bright
# light; the simplified LIF retina here has no such mechanism, so a target that
# fills the window floods both eyes and the left/right contrast the pilot steers
# by disappears. The eye's gain follows ADAPT_LUM / mean receptor luminance,
# never above 1, with a time constant -- it only ever dims, so a dark sky is
# untouched and the empty-sky bias calibration still holds. Same rule in every mode.
ADAPT_LUM = 0.06
ADAPT_TAU_S = 0.3

# ---------------------------------------------------------------- touchdown
TOUCH_S = 0.5                    # the legs' sensors fire for this long
POST_S = 1.0                     # standing (or falling over) afterwards
LEG_NERVES = ("ProLN", "MesoLN", "MetaLN")
LEG_CLASSES = ("mechanosensory_tactile", "mechanosensory_proprioceptive")

TRACE_FIELDS = ["t", "x", "y", "heading", "lever", "R_hz", "L_hz", "rel_deg", "eye_gain", "throttle",
                "fuel", "phase", "view", "alt", "vr", "vt", "g", "met_id", "met_rel", "met_k"]


# ---------------------------------------------------------------- brain
def load_brain():
    sys.path.insert(0, str(BRAIN_ROOT))
    try:
        import numba  # noqa: F401
    except ImportError:
        # The native kernel never calls the numba-compiled Python reference.
        stub = types.ModuleType("numba")
        stub.njit = lambda *a, **k: (a[0] if a and callable(a[0]) else (lambda f: f))
        sys.modules["numba"] = stub
    from doom.native import NativeBrain   # verifies the binary against kernel.cpp
    brain = NativeBrain(BRAIN_ROOT / "outputs/doom/malecns_v1/graph.npz")
    readouts = json.loads((BRAIN_ROOT / "outputs/doom/malecns_v1/manifest.json").read_text())["readouts"]

    def pick(typ, side):
        return [r["index"] for r in readouts if r["type"] == typ and r["side"] == side]

    return brain, pick("DNp20", "R"), pick("DNp20", "L")


def leg_sensors(brain=None):
    """Mechanosensory neurons entering through the six leg nerves, as graph indices."""
    cache = RUNS / "leg_sensors.json"
    if cache.exists():
        out = json.loads(cache.read_text())
    else:
        import pandas as pd
        root = BRAIN_ROOT / "connectome_data/malecns_v1"
        a = pd.read_feather(root / "annotations.feather", columns=["bodyId", "class", "subclass", "entryNerve"])
        n = pd.read_feather(root / "normalized/neurons.feather", columns=["node_index", "source_id"])
        m = a[a.entryNerve.isin(LEG_NERVES) & a["class"].isin(LEG_CLASSES)]
        m = m.merge(n, left_on="bodyId", right_on="source_id").sort_values("node_index")
        out = {"index": [int(i) for i in m.node_index], "body_id": [int(b) for b in m.bodyId],
               "by_subclass": {str(k): int(v) for k, v in m.subclass.value_counts().items()},
               "by_nerve": {str(k): int(v) for k, v in m.entryNerve.value_counts().items()},
               "selection": f"class in {LEG_CLASSES}, entry nerve in {LEG_NERVES}"}
        RUNS.mkdir(parents=True, exist_ok=True)
        cache.write_text(json.dumps(out))
    if brain is not None:
        idx = np.asarray(out["index"])
        if not np.array_equal(np.asarray(brain.ids)[idx], np.asarray(out["body_id"])):
            raise RuntimeError("leg sensor indices do not match the graph")
    return out


def neuron_table():
    import pandas as pd
    n = pd.read_feather(BRAIN_ROOT / "connectome_data/malecns_v1/normalized/neurons.feather",
                        columns=["node_index", "superclass", "cell_type"]).sort_values("node_index")
    return n.superclass.fillna("").to_numpy(), n.cell_type.fillna("").to_numpy()


def brain_step(brain, lum, touch=None):
    """One step; with touch, the leg sensors get DOOMFLY's stimulus drive instead of LB3c."""
    if touch is None:
        return brain.step(lum, TIC_MS)
    saved = brain.sugar
    brain.sugar = touch
    try:
        return brain.step(lum, TIC_MS, sugar=True)
    finally:
        brain.sugar = saved


def retinal_samples(rgb, uv):
    """Copied from doom/game.py (bilinear luminance at receptor samples);
    that module imports vizdoom, which is not needed here."""
    h, w = rgb.shape[:2]
    x = uv[:, 0] * (w - 1)
    y = uv[:, 1] * (h - 1)
    x0 = x.astype(int)
    y0 = y.astype(int)
    x1 = np.minimum(x0 + 1, w - 1)
    y1 = np.minimum(y0 + 1, h - 1)
    dx = x - x0
    dy = y - y0

    def luma(p):
        p = p.astype(np.float32) / 255
        p = np.where(p <= .04045, p / 12.92, ((p + .055) / 1.055) ** 2.4)
        return p @ np.asarray([.2126, .7152, .0722], dtype=np.float32)

    return ((1 - dx) * (1 - dy) * luma(rgb[y0, x0]) + dx * (1 - dy) * luma(rgb[y0, x1])
            + (1 - dx) * dy * luma(rgb[y1, x0]) + dx * dy * luma(rgb[y1, x1])).astype(np.float32)


def dim(frame, gain):
    """The window as the adapted eye receives it (linear-light scaling), for display."""
    if gain >= 0.999:
        return frame
    p = frame.astype(np.float32) / 255
    lin = np.where(p <= .04045, p / 12.92, ((p + .055) / 1.055) ** 2.4) * gain
    srgb = np.where(lin <= .0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - .055)
    return np.clip(srgb * 255 + .5, 0, 255).astype(np.uint8)


def calibrate(seconds=4.0):
    """Mean right-minus-left DNp20 rate on an empty starry sky. Fixed and published."""
    brain, R, L = load_brain()
    frame = wd.render_forward(np.array([0.0, R_EARTH + 1]), math.pi / 2, None, 0.0)
    lum = retinal_samples(frame, brain.uv)
    step_s = TIC_MS / 1000
    for _ in range(round(0.5 / step_s)):
        brain.step(lum, TIC_MS)
    diffs = []
    for _ in range(round(seconds / step_s)):
        c, _ = brain.step(lum, TIC_MS)
        diffs.append((c[R].sum() - c[L].sum()) / step_s)
    out = {"bias_hz": float(np.mean(diffs)), "seconds": seconds,
           "frame": "empty starry sky, no target", "fov_deg": math.degrees(wd.FOV),
           "readout": "right DNp20 minus left DNp20 firing rate"}
    RUNS.mkdir(parents=True, exist_ok=True)
    (RUNS / "bias.json").write_text(json.dumps(out, indent=2))
    print(json.dumps(out))


# ---------------------------------------------------------------- geometry
def unit(a):
    return np.array([math.cos(a), math.sin(a)])


def seg_clearance(tail, nose, centers, radii):
    """Distance from the hull (a segment) to each circle's edge; < 0 is a hit."""
    if len(centers) == 0:
        return np.zeros(0)
    ab = nose - tail
    k = np.clip(((centers - tail) @ ab) / (ab @ ab), 0, 1)
    near = tail + k[:, None] * ab
    return np.hypot(*(near - centers).T) - radii


# ---------------------------------------------------------------- mission
def fly_mission(mode, seed, level=1, save_frames=True):
    w = World(level, seed)
    T = w.target
    heading = math.pi / 2
    pos = PAD + unit(heading) * (ROCKET_L / 2 + 0.02)        # centre of mass, legs on the pad
    vel = np.zeros(2)
    fuel = w.fuel_s
    brain = R = L = legs = None
    cells = cell_idx = cell_acc = None
    bias = 0.0
    if mode in ("fly", "blind"):
        brain, R, L = load_brain()
        bias = json.loads((RUNS / "bias.json").read_text())["bias_hz"]
        legs = leg_sensors(brain)
        leg_idx = np.asarray(legs["index"], np.int32)
        # a fixed sample of neurons with soma coordinates, recorded so the viewer
        # can show the firing where it actually happens in the nervous system
        cells = json.loads((RUNS / "brain_cells.json").read_text())
        cell_idx = np.asarray(cells["index"], np.int32)
        cell_acc = np.zeros(len(cell_idx), np.int32)
        superclass, cell_type = neuron_table()
        is_an = superclass == "ascending_neuron"
        is_dn = superclass == "descending_neuron"
        # the brain's own response to touch: leave out sensory cells and the optic
        # lobes, whose firing follows the picture rather than the legs
        visual = {"ol_intrinsic", "visual_projection", "visual_centrifugal", "ol_sensory"}
        central = np.array([("sensory" not in s) and (s not in visual) for s in superclass])
    step_s = TIC_MS / 1000
    diff_s = bias
    eye_gain = 1.0
    throttle = 0.0
    g_load = 1.0
    lever = 0.0
    phase = "pad"
    outcome, detail = None, {}
    events = []
    t = -COUNTDOWN_S
    closest, closest_t = math.inf, 0.0
    n_ast, n_met = len(w.asteroids), len(w.meteors)
    ast_clear = np.full(n_ast, math.inf)
    ast_clear_t = np.zeros(n_ast)
    met_clear = np.full(n_met, math.inf)
    met_clear_t = np.zeros(n_met)
    trace, frames_saved, rel_log = [], [], []
    spikes = []
    before = deque(maxlen=round(TOUCH_S / step_s))
    touch_sum = None
    touch_t = tip_dir = None
    foot = None
    out_of_air = False
    wall0 = time.perf_counter()
    k = 0

    def ev(event_type, **kw):
        events.append({"t": round(max(t, 0.0), 2), "type": event_type,
                       **{a: (round(b, 2) if isinstance(b, float) else b) for a, b in kw.items()}})

    def radial(p, v):
        d = p - T
        dist = math.hypot(*d)
        n = d / dist
        tv = np.array([-n[1], n[0]])
        return dist, n, tv, float(v @ n), float(v @ tv)

    def hull_hits(p, hdg, tt):
        """Earth, the target (before the landing) and every rock and meteor."""
        nonlocal outcome, detail
        dvec = unit(hdg) * ROCKET_L / 2
        tail, nose = p - dvec, p + dvec
        spd = float(np.linalg.norm(vel))
        if tt > 2 and min(np.linalg.norm(tail), np.linalg.norm(nose)) < R_EARTH:
            outcome, detail = "earth", {"speed": round(spd, 1)}
            return True
        if phase in ("ascent", "cruise", "flip") and \
                min(np.linalg.norm(tail - T), np.linalg.norm(nose - T)) < w.R:
            outcome, detail = "impact", {"speed": round(spd, 1)}
            return True
        c = seg_clearance(tail, nose, w.asteroids[:, :2], w.asteroids[:, 2])
        better = c < ast_clear
        ast_clear[better], ast_clear_t[better] = c[better], tt
        if (c < 0).any():
            i = int(np.argmin(c))
            outcome, detail = "collision", {"kind": "asteroid", "id": i, "r": round(float(w.asteroids[i, 2]), 1),
                                            "speed": round(spd, 1)}
            return True
        m, ids = w.meteors_at(tt)
        if len(m):
            c = seg_clearance(tail, nose, m[:, :2], m[:, 2])
            better = c < met_clear[ids]
            met_clear[ids[better]], met_clear_t[ids[better]] = c[better], tt
            if (c < 0).any():
                j = int(np.argmin(c))
                rv = w.meteors[ids[j], 2:4] - vel
                outcome, detail = "collision", {"kind": "meteor", "id": int(ids[j]),
                                                "speed": round(float(np.linalg.norm(rv)), 1)}
                return True
        return False

    while t < w.mission_s and outcome in (None, "landed", "landed_off", "tipped"):
        dist, n, tv, vr, vt = radial(pos, vel)
        down_view = phase in ("landing", "touch", "post")
        if down_view:
            rel = wd.pad_angle_down(pos, w)
        else:
            rel = wrap(math.atan2(T[1] - pos[1], T[0] - pos[0]) - heading)
        # the brightest meteor in the forward window, for the log
        met_id, met_rel, met_k = None, None, None
        if not down_view and t >= 0:
            m, ids = w.meteors_at(t)
            best = 0.0
            for (mx, my, _), i in zip(m, ids):
                d = math.hypot(mx - pos[0], my - pos[1])
                r_ = wrap(math.atan2(my - pos[1], mx - pos[0]) - heading)
                kk = min(1.0, (wd.METEOR_FADE / max(d, 1e-6)) ** 2) * w.L["meteor_k"]
                if abs(r_) < wd.FOV / 2 and kk > best:
                    best, met_id, met_rel, met_k = kk, int(i), r_, kk
        r_hz = l_hz = None
        touching = phase == "touch"
        if brain is not None:
            if down_view:
                frame = wd.render_down(pos, w, blind=(mode == "blind"))
            else:
                frame = wd.render_forward(pos, heading, w, max(t, 0.0), blind=(mode == "blind"))
            lum = retinal_samples(frame, brain.uv)
            mlum = float(lum.mean())
            target = min(1.0, ADAPT_LUM / mlum) if mlum > 0 else 1.0
            eye_gain += (1 - math.exp(-step_s / ADAPT_TAU_S)) * (target - eye_gain)
            c, _ = brain_step(brain, lum * eye_gain, leg_idx if touching else None)
            r_hz, l_hz = c[R].sum() / step_s, c[L].sum() / step_s
            cell_acc += c[cell_idx]
            diff_s += (1 - math.exp(-step_s / TAU_S)) * ((r_hz - l_hz) - diff_s)
            signal = (diff_s - bias) * GAIN          # > 0: the right side fires more, steer right
            lever = -max(-1.0, min(1.0, signal))      # > 0: left (counter-clockwise)
            if touching:
                touch_sum = c.astype(np.int64) if touch_sum is None else touch_sum + c
            elif phase in ("landing",):
                before.append(c.astype(np.int32))
            if save_frames and mode == "fly" and (k % 175 == 0 or (down_view and k % 35 == 0)):
                from PIL import Image
                p = RUNS / "frames" / f"{mode}-L{level}-s{seed}-t{max(t, 0):04.1f}{'-down' if down_view else ''}.png"
                p.parent.mkdir(parents=True, exist_ok=True)
                Image.fromarray(dim(frame, eye_gain)).save(p)
                frames_saved.append(p.name)
        elif mode == "oracle":
            lever = max(-1.0, min(1.0, 3 * rel))
        else:
            lever = 0.0

        if t >= 0:
            if phase == "pad":
                phase = "ascent"
                ev("liftoff", fuel_s=fuel)
            dt = step_s / SUBSTEPS
            if phase in ("ascent", "cruise"):
                heading = wrap(heading + lever * MAX_TURN * step_s)
                d_hat = unit(heading)
                for _ in range(SUBSTEPS):
                    h_e = np.linalg.norm(pos) - R_EARTH
                    engine = fuel > 0
                    drag = (DRAG if engine else 0.0) + DRAG_ATM * math.exp(-max(h_e, 0.0) / H_ATM)
                    grav = w.gravity(pos)
                    a = grav - drag * vel + (THRUST * d_hat if engine else 0.0)
                    g_load = float(np.linalg.norm(a - grav)) / G0
                    vel = vel + a * dt
                    pos = pos + vel * dt
                    if engine:
                        fuel = max(0.0, fuel - dt)
                        if fuel == 0.0:
                            ev("fuel_out")
                    throttle = 1.0 if engine else 0.0
                    if hull_hits(pos, heading, t):
                        break
                if outcome is None:
                    h_e = np.linalg.norm(pos) - R_EARTH
                    if not out_of_air and h_e > ATM_TOP:
                        out_of_air = True
                        phase = "cruise"
                        ev("out_of_air", alt=float(h_e), speed=float(np.linalg.norm(vel)))
                    # the flip: when the ground is closer than the time to turn and brake
                    dist, n, tv, vr, vt = radial(pos, vel)
                    alt = dist - w.R - ROCKET_L / 2
                    closing = -vr
                    need = max(closing, 0.0) * FLIP_S + max(closing, 0.0) ** 2 / (2 * A_BRAKE) + FLIP_MARGIN
                    if alt <= need and (closing > 0 or alt < FLIP_MARGIN):
                        if fuel > 0:
                            phase = "flip"
                            ev("flip_start", alt=float(alt), closing=float(closing), fuel_s=fuel)
                        elif not any(e["type"] == "no_fuel_landing" for e in events):
                            ev("no_fuel_landing", alt=float(alt))
            elif phase == "flip":
                throttle = 0.0
                g_load = 0.0
                for _ in range(SUBSTEPS):
                    dist, n, tv, vr, vt = radial(pos, vel)
                    want = math.atan2(n[1], n[0])
                    err = wrap(want - heading)
                    heading = wrap(heading + max(-1.0, min(1.0, err / (math.pi / FLIP_S * dt))) * math.pi / FLIP_S * dt)
                    vel = vel + w.gravity(pos) * dt
                    pos = pos + vel * dt
                    if hull_hits(pos, heading, t):
                        break
                dist, n, tv, vr, vt = radial(pos, vel)
                if outcome is None and abs(wrap(math.atan2(n[1], n[0]) - heading)) < math.radians(1):
                    phase = "landing"
                    ev("flip_end", alt=float(dist - w.R - ROCKET_L / 2), closing=float(-vr))
            elif phase == "landing":
                for _ in range(SUBSTEPS):
                    dist, n, tv, vr, vt = radial(pos, vel)
                    alt = dist - w.R - ROCKET_L / 2
                    grav = w.gravity(pos)
                    vr_cmd = -max(V_TD, min(K_ALT * alt, math.sqrt(2 * A_BRAKE * max(alt, 0.0))))
                    t_r = min(THRUST, max(0.0, K_VR * (vr_cmd - vr) - float(grav @ n))) if fuel > 0 else 0.0
                    v_lat = V_LAT_MAX * max(LAT_MIN, min(1.0, alt / LAT_ALT))
                    a_t = max(-A_RCS, min(A_RCS, K_VT * (lever * v_lat - vt)))
                    a = grav + t_r * n + a_t * tv
                    g_load = float(np.linalg.norm(a - grav)) / G0
                    vel = vel + a * dt
                    pos = pos + vel * dt
                    throttle = t_r / THRUST
                    if fuel > 0:
                        fuel = max(0.0, fuel - throttle * dt)
                        if fuel == 0.0:
                            ev("fuel_out")
                    dist, n, tv, vr, vt = radial(pos, vel)
                    heading = math.atan2(n[1], n[0]) + max(-1.0, min(1.0, a_t / A_RCS)) * TILT_VIS
                    if hull_hits(pos, heading, t):
                        break
                    tail_alt = dist - w.R - ROCKET_L / 2 * math.cos(heading - math.atan2(n[1], n[0]))
                    if tail_alt <= 0:
                        phi = math.atan2(n[1], n[0])
                        slope = w.slope_at(phi)
                        arc = w.pad_arc(phi)
                        v_down, v_side = -vr, abs(vt)
                        td = {"v_down": round(v_down, 2), "v_side": round(v_side, 2), "slope": round(slope, 1),
                              "from_pad": round(arc, 1), "on_pad": arc <= PAD_R, "fuel_s": round(fuel, 1)}
                        if v_down > V_CRASH:
                            outcome, detail = "crash", td
                        elif slope > SLOPE_MAX or v_side > VT_TIP:
                            outcome, detail = "tipped", td
                            tip_dir = (1 if vt > 0 else -1) if v_side > 0.05 else 1
                        else:
                            outcome, detail = ("landed" if arc <= PAD_R else "landed_off"), td
                        ev("touchdown", **td)
                        foot = T + n * w.R
                        heading = phi
                        pos = foot + n * ROCKET_L / 2
                        vel = np.zeros(2)
                        throttle = 0.0
                        if outcome != "crash":
                            phase, touch_t = "touch", t
                            ev("engine_cut")
                        break
            elif phase in ("touch", "post"):
                since = t - touch_t
                if outcome == "tipped":
                    # it goes over about the feet; the flight ends when it hits the ground
                    up = math.atan2(*(foot - T)[::-1])
                    ang = min(math.pi / 2, 0.5 * 3.0 * since ** 2)
                    heading = up + tip_dir * ang
                    pos = foot + unit(heading) * ROCKET_L / 2
                if phase == "touch" and since >= TOUCH_S:
                    phase = "post"
                if since >= TOUCH_S + POST_S:
                    break
            dist = math.hypot(*(T - pos))
            if dist - w.R < closest:
                closest, closest_t = dist - w.R, t
            rel_log.append(abs(rel))

        every = 7 if phase in ("pad", "ascent", "cruise") else 3
        if k % every == 0 or outcome not in (None, "landed", "landed_off", "tipped"):
            dist, n, tv, vr, vt = radial(pos, vel)
            trace.append([round(t, 3), round(float(pos[0]), 3), round(float(pos[1]), 3),
                          round(heading, 4), round(lever, 3),
                          None if r_hz is None else round(float(r_hz), 1),
                          None if l_hz is None else round(float(l_hz), 1),
                          round(math.degrees(rel), 1), round(eye_gain, 3), round(throttle, 3),
                          round(fuel, 2), phase, "down" if down_view else "fwd",
                          round(dist - w.R - ROCKET_L / 2, 2), round(vr, 2), round(vt, 2), round(g_load, 2),
                          met_id, None if met_rel is None else round(math.degrees(met_rel), 1),
                          None if met_k is None else round(met_k, 3)])
            if cell_acc is not None:
                spikes.append([int(i) for i in np.flatnonzero(cell_acc)])
                cell_acc[:] = 0
        t += step_s
        k += 1

    if outcome is None:
        outcome = "lost"
    if trace and outcome != "lost":
        t = trace[-1][0]          # the end is the last recorded moment, not the step after it
    if outcome in ("earth", "impact", "collision", "crash"):
        ev("explosion", **{kk: vv for kk, vv in detail.items() if not isinstance(vv, bool)})
    elif outcome == "tipped":
        ev("explosion", cause="tipped")

    touch = None
    if touch_sum is not None and brain is not None:
        n_steps = round(TOUCH_S / step_s)
        base = np.sum(before, axis=0) if before else np.zeros_like(touch_sum)
        delta = touch_sum - base
        rows = {}
        for i in np.flatnonzero(central & (delta > 0)):
            ty = cell_type[i] or "?"
            rows[ty] = rows.get(ty, 0) + int(delta[i])
        top = sorted(rows.items(), key=lambda kv: -kv[1])[:6]
        touch = {"seconds": TOUCH_S, "steps": n_steps, "stimulated": len(leg_idx),
                 "by_subclass": legs["by_subclass"],
                 "leg_spikes": int(touch_sum[leg_idx].sum()), "leg_spikes_before": int(base[leg_idx].sum()),
                 "an_spikes": int(touch_sum[is_an].sum()), "an_spikes_before": int(base[is_an].sum()),
                 "dn_spikes": int(touch_sum[is_dn].sum()), "dn_spikes_before": int(base[is_dn].sum()),
                 "top_types": [{"type": a, "extra_spikes": b} for a, b in top]}
        ev("legs_felt", stimulated=len(leg_idx), leg_spikes=touch["leg_spikes"],
           an_spikes=touch["an_spikes"], an_before=touch["an_spikes_before"])

    result = {
        "mode": mode, "level": level, "seed": seed, "target": w.name,
        "offset_deg": round(math.degrees(w.offset), 1),
        "outcome": outcome, "detail": detail, "t": round(t, 2),
        "closest": round(closest, 1), "closest_t": round(closest_t, 2), "fuel_left": round(fuel, 1),
        "mean_abs_angle_deg": round(math.degrees(float(np.mean(rel_log))), 1) if rel_log else 0.0,
        "bias_hz": round(bias, 2), "wall_s": round(time.perf_counter() - wall0, 1),
    }
    near = {"asteroids": [[round(float(c), 2), round(float(tt), 2)] for c, tt in zip(ast_clear, ast_clear_t)],
            "meteors": [[round(float(c), 2) if math.isfinite(c) else None, round(float(tt), 2)]
                        for c, tt in zip(met_clear, met_clear_t)]}
    RUNS.mkdir(parents=True, exist_ok=True)
    (RUNS / f"{mode}-L{level}-s{seed}.json").write_text(json.dumps({
        "result": result, "frames": frames_saved, "events": events, "touch": touch, "near": near,
        "brain_activity": None if cells is None else {
            "cells": {k: cells[k] for k in ("superclass", "type", "x", "y", "z")},
            "note": cells["note"], "spikes": spikes},
        "trace_fields": TRACE_FIELDS, "trace": trace, "level": w.export(),
        "world": {"R_EARTH": R_EARTH, "ROCKET_L": ROCKET_L, "THRUST": THRUST, "DRAG": DRAG,
                  "DRAG_ATM": DRAG_ATM, "H_ATM": H_ATM, "MAX_TURN_deg": math.degrees(MAX_TURN),
                  "TAU_S": TAU_S, "GAIN": GAIN, "FOV_deg": math.degrees(wd.FOV),
                  "ADAPT_LUM": ADAPT_LUM, "ADAPT_TAU_S": ADAPT_TAU_S, "FLIP_S": FLIP_S,
                  "A_BRAKE": A_BRAKE, "V_TD": V_TD, "V_LAT_MAX": V_LAT_MAX, "LAT_ALT": LAT_ALT, "LAT_MIN": LAT_MIN, "A_RCS": A_RCS,
                  "PAD_R": PAD_R, "V_SOFT": V_SOFT, "V_CRASH": V_CRASH, "VT_TIP": VT_TIP,
                  "SLOPE_MAX": SLOPE_MAX, "G0": G0, "TOUCH_S": TOUCH_S},
    }))
    print(json.dumps(result), flush=True)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--mode", choices=["fly", "blind", "straight", "oracle"], default="fly")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--level", type=int, default=1)
    ap.add_argument("--calibrate", action="store_true")
    ap.add_argument("--no-frames", action="store_true")
    a = ap.parse_args()
    if a.calibrate:
        calibrate()
    else:
        fly_mission(a.mode, a.seed, a.level, save_frames=not a.no_frames)
