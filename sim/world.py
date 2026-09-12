"""World rules for FLY X: levels, the target, hazards, terrain and the pilot's window.

Everything the fly can see is drawn here and nothing else reaches its eyes. Every
rule is fixed per level and every flight of a level gets the same rules; a seed
only picks where the target, the rocks and the meteors are. Nothing reacts to how
the pilot is doing.

Two windows:
  forward  -- out of the nose, along the rocket's axis (ascent and cruise)
  down     -- the landing camera under the engines, used after the flip. Its
              picture is shown in the pilot's own frame, the way a periscope or
              a cockpit screen would show it: what lies to the pilot's left is
              on the left of the picture.

The world is an arcade scale, not the real solar system.
"""
import math

import numpy as np

# ---------------------------------------------------------------- window
W, H = 640, 480
FOV = math.radians(90)
HORIZON_Y = int(0.30 * H)        # keeps targets in the densely sampled band
_star_rng = np.random.default_rng(12345)
STAR_A = _star_rng.uniform(-math.pi, math.pi, 260)
STAR_Y = _star_rng.integers(int(0.05 * H), int(0.75 * H), 260)
STAR_B = _star_rng.integers(25, 70, 260).astype(np.uint8)

# ---------------------------------------------------------------- Earth
R_EARTH = 100.0
G0 = 9.8
GM_EARTH = G0 * R_EARTH ** 2
PAD = np.array([0.0, R_EARTH])   # launch pad, on the Earth's night side
# Air: denser near the ground, so the climb out of the atmosphere is slow.
DRAG_ATM = 2.0                   # 1/s at the ground
H_ATM = 12.0                     # scale height

# ---------------------------------------------------------------- rocket
ROCKET_L = 1.2                   # legs to nose; the 3D model is scaled to it
THRUST = 20.0                    # units/s^2 at full throttle
# Cruise assist (arcade, not physics): while the main engine burns on the way
# out, the flight computer keeps the velocity along the nose, so the path is
# decided by where the pilot points rather than by orbital mechanics. It is off
# during the flip and the landing, and when the fuel is gone the rocket coasts.
DRAG = 0.5                       # 1/s
MAX_TURN = math.radians(40)      # rad/s at full lever

# ---------------------------------------------------------------- landing computer
# It flips the rocket engines-first, brakes and holds the descent rate with the
# throttle -- things a real booster's computer does. It never knows where the
# pad is: sideways the rocket goes wherever the pilot's lever says.
FLIP_S = 2.0                     # time for a full 180 degree flip, engine off
A_BRAKE = 12.0                   # braking the computer plans for
FLIP_MARGIN = 20.0
K_ALT = 0.35                     # descent rate per unit of altitude
V_TD = 1.5                       # touchdown descent rate the computer aims for
K_VR = 2.0
V_LAT_MAX = 4.0                  # sideways speed at full lever
# Near the ground the computer scales the sideways speed down with height, as
# real landers do (the last metres are flown nearly vertically). Added after the
# first three fly landings all touched down sliding sideways at 3 units/s: the
# pad's angle in the camera grows as 1/height, so full sideways speed at low
# height turned every small correction into a swing.
LAT_ALT = 20.0                   # below this height sideways speed is limited
LAT_MIN = 0.15                   # ... down to this fraction of V_LAT_MAX
K_VT = 1.5
A_RCS = 4.0                      # sideways thrusters
TILT_VIS = math.radians(10)      # the hull leans into a sideways push

# ---------------------------------------------------------------- touchdown
PAD_R = 3.0                      # flat, lit landing pad
V_SOFT = 2.5                     # descent speed for a soft landing
V_CRASH = 6.0                    # above this the legs fail
VT_TIP = 2.0                     # sideways speed that tips the rocket over
SLOPE_MAX = 12.0                 # degrees the legs can stand on
SLOPE_AMP = 24.0

# ---------------------------------------------------------------- levels
LEVELS = {
    1: {"name": "Moon", "key": "moon", "dist": 1000.0, "radius": 40.0, "gm": 0.0123 * GM_EARTH,
        "color": (240, 238, 222), "surface": (112, 110, 104), "offset_deg": (15, 35),
        "fuel_s": 48.0, "mission_s": 70.0,
        "asteroids": 8, "ast_r": (2.0, 6.0), "ast_band": (0.15, 0.85), "ast_spread": 90.0,
        "meteors": 6, "meteor_k": 0.3},
    # New moon on the way to Mars: the Moon is dark, so Mars is the brightest
    # thing ahead -- and a much dimmer one than the full Moon was.
    2: {"name": "Mars", "key": "mars", "dist": 1700.0, "radius": 30.0, "gm": 0.04 * GM_EARTH,
        "color": (236, 132, 88), "surface": (118, 72, 52), "offset_deg": (10, 30),
        "fuel_s": 62.0, "mission_s": 95.0,
        "asteroids": 12, "ast_r": (2.0, 7.0), "ast_band": (0.35, 0.70), "ast_spread": 110.0,
        "meteors": 8, "meteor_k": 0.3},
}

AST_COLOR = (16, 15, 14)         # dark rock, faintly lit by the Earth
METEOR_R = 1.0
METEOR_FADE = 150.0              # inverse-square fade beyond this distance
PAD_COLOR = (255, 250, 235)


def wrap(a):
    return (a + math.pi) % (2 * math.pi) - math.pi


def to_linear(c):
    c = np.asarray(c, np.float64) / 255
    return np.where(c <= .04045, c / 12.92, ((c + .055) / 1.055) ** 2.4)


def to_srgb(lin):
    lin = np.clip(lin, 0, 1)
    return np.where(lin <= .0031308, lin * 12.92, 1.055 * np.power(lin, 1 / 2.4) - .055) * 255


class World:
    """One level with one seed: where everything is. Deterministic."""

    def __init__(self, level, seed):
        L = LEVELS[level]
        self.level, self.seed, self.L = level, seed, L
        self.name = L["name"]
        self.R = L["radius"]
        self.gm = L["gm"]
        self.color = L["color"]
        self.surface = np.asarray(L["surface"], np.float32)
        self.fuel_s = L["fuel_s"]
        self.mission_s = L["mission_s"]
        # the target: level 1 keeps the Moon placement of the first missions
        rng = np.random.default_rng(seed if level == 1 else [level, seed])
        lo, hi = L["offset_deg"]
        self.offset = math.radians(rng.uniform(lo, hi)) * (1 if rng.random() < 0.5 else -1)
        a = math.pi / 2 + self.offset
        self.target = np.array([L["dist"] * math.cos(a), L["dist"] * math.sin(a)])

        # dark asteroids scattered along the way, and bright meteors crossing it
        rng = np.random.default_rng([level, seed, 1])
        u = (self.target - PAD) / np.linalg.norm(self.target - PAD)
        nrm = np.array([-u[1], u[0]])
        span = np.linalg.norm(self.target - PAD)
        ast = []
        for _ in range(L["asteroids"]):
            f = rng.uniform(*L["ast_band"])
            p = PAD + u * f * span + nrm * rng.normal(0, L["ast_spread"])
            ast.append([p[0], p[1], rng.uniform(*L["ast_r"])])
        self.asteroids = np.array(ast, np.float64).reshape(-1, 3)
        met = []
        for _ in range(L["meteors"]):
            t0 = rng.uniform(4, 0.6 * self.mission_s)
            # it crosses near where a rocket would roughly be by then -- a fixed
            # guess from the clock, never from where this rocket actually is
            f = float(np.clip((t0 - 4) / 32 + rng.normal(0, 0.08), 0.1, 0.9))
            cross = PAD + u * f * span + nrm * rng.normal(0, 40)
            ang = math.atan2(nrm[1], nrm[0]) + rng.uniform(-0.7, 0.7) + (math.pi if rng.random() < 0.5 else 0)
            v = rng.uniform(15, 30) * np.array([math.cos(ang), math.sin(ang)])
            dur = 8.0
            p0 = cross - v * dur / 2
            met.append([p0[0], p0[1], v[0], v[1], t0, t0 + dur, METEOR_R])
        self.meteors = np.array(met, np.float64).reshape(-1, 7)
        # a meteor's glow is this fraction of the target's light (linear), at most
        self.meteor_color = to_srgb(to_linear(self.color) * L["meteor_k"])

        # the landing pad, on the side facing the launch site, and the ground round it
        rng = np.random.default_rng([level, seed, 2])
        base = math.atan2(PAD[1] - self.target[1], PAD[0] - self.target[0])
        self.pad_phi = base + math.radians(rng.uniform(-15, 15))
        self.terrain = [rng.uniform(1.2, 2.5), rng.uniform(0, 6.3), rng.uniform(3.0, 6.0), rng.uniform(0, 6.3)]

    # ---------------------------------------------------------------- queries
    def meteors_at(self, t):
        """(k, 3) array of x, y, r for meteors in flight at time t, and their ids."""
        m = self.meteors
        on = (t >= m[:, 4]) & (t <= m[:, 5])
        p = m[on, :2] + m[on, 2:4] * (t - m[on, 4])[:, None]
        return np.c_[p, m[on, 6]], np.flatnonzero(on)

    def pad_arc(self, phi):
        """Distance along the surface from the pad centre."""
        return abs(wrap(phi - self.pad_phi)) * self.R

    def slopes(self, phi):
        """Ground slope in degrees: the pad is flat, the rest is rough."""
        s = ((np.asarray(phi, np.float64) - self.pad_phi + math.pi) % (2 * math.pi) - math.pi) * self.R
        l1, p1, l2, p2 = self.terrain
        rough = SLOPE_AMP * np.abs(0.6 * np.sin(s / l1 + p1) + 0.4 * np.sin(s / l2 + p2))
        return np.where(np.abs(s) <= PAD_R, 0.0, rough)

    def slope_at(self, phi):
        return float(self.slopes(phi))

    def gravity(self, p):
        a = -GM_EARTH * p / np.linalg.norm(p) ** 3
        m = p - self.target
        return a - self.gm * m / np.linalg.norm(m) ** 3

    def export(self):
        return {"level": self.level, "name": self.name, "key": self.L["key"],
                "target": [float(self.target[0]), float(self.target[1])], "R": self.R,
                "color": list(self.color), "surface": [int(c) for c in self.surface],
                "offset_deg": round(math.degrees(self.offset), 1),
                "asteroids": [[round(float(v), 3) for v in a] for a in self.asteroids],
                "meteors": [[round(float(v), 3) for v in m] for m in self.meteors],
                "meteor_color": [round(float(c), 2) for c in self.meteor_color],
                "pad_phi": self.pad_phi, "terrain": self.terrain,
                "fuel_s": self.fuel_s, "mission_s": self.mission_s}


# ---------------------------------------------------------------- drawing
def to_x(rel):
    """Positive relative angle (counter-clockwise, the pilot's left) is on the left."""
    return W / 2 - rel / (FOV / 2) * (W / 2)


def ang_px(a):
    return a / (FOV / 2) * (W / 2)


def glow(frame, cx, cy, core_px, color, sigma_min=18.0):
    sigma = max(sigma_min, core_px * 2.5)
    rad = int(core_px + 3 * sigma)
    x0, x1 = max(0, int(cx - rad)), min(W, int(cx + rad) + 1)
    y0, y1 = max(0, int(cy - rad)), min(H, int(cy + rad) + 1)
    if x0 >= x1 or y0 >= y1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    d = np.hypot(xx - cx, yy - cy)
    val = np.where(d <= core_px, 1.0, 0.55 * np.exp(-((d - core_px) ** 2) / (2 * sigma ** 2)))
    region = frame[y0:y1, x0:x1].astype(np.float32)
    region += val[..., None] * np.asarray(color, np.float32)[None, None, :]
    frame[y0:y1, x0:x1] = np.clip(region, 0, 255).astype(np.uint8)


def disc(frame, cx, cy, r_px, color):
    x0, x1 = max(0, int(cx - r_px)), min(W, int(cx + r_px) + 1)
    y0, y1 = max(0, int(cy - r_px)), min(H, int(cy + r_px) + 1)
    if x0 >= x1 or y0 >= y1:
        return
    yy, xx = np.mgrid[y0:y1, x0:x1]
    mask = np.hypot(xx - cx, yy - cy) <= r_px
    frame[y0:y1, x0:x1][mask] = color


def stars(frame, center_angle, mirror=False):
    rel = (STAR_A - center_angle + math.pi) % (2 * math.pi) - math.pi
    if mirror:
        rel = -rel
    vis = np.abs(rel) < FOV / 2
    xs = np.clip(to_x(rel[vis]).astype(int), 0, W - 1)
    frame[STAR_Y[vis], xs] = STAR_B[vis, None]


def render_forward(pos, heading, world, t, blind=False, with_target=True):
    """The window out of the nose: exactly the frame the retina samples."""
    f = np.zeros((H, W, 3), np.uint8)
    if blind:
        return f
    stars(f, heading)
    # Earth: a dark night-side disc with a faint blue limb, so it never outshines the target.
    d = -pos
    dist = math.hypot(*d)
    half = math.asin(min(1.0, R_EARTH / max(dist, R_EARTH)))
    rel_e = wrap(math.atan2(d[1], d[0]) - heading)
    if abs(rel_e) < FOV / 2 + half:
        r_px = ang_px(half)
        cx = to_x(rel_e)
        yy, xx = np.mgrid[0:H, 0:W]
        dd = np.hypot(xx - cx, yy - (HORIZON_Y + r_px))
        f[dd <= r_px] = (8, 11, 22)
        f[(dd > r_px - 3) & (dd <= r_px)] = (30, 55, 110)
    if world is None:
        return f
    if with_target:
        d = world.target - pos
        dist = math.hypot(*d)
        rel_m = wrap(math.atan2(d[1], d[0]) - heading)
        core = max(8.0, ang_px(math.asin(min(1.0, world.R / max(dist, world.R)))))
        glow(f, to_x(rel_m), HORIZON_Y, core, world.color)
    # dark rocks in front of everything behind them, far ones first
    a = world.asteroids
    if len(a):
        dv = a[:, :2] - pos
        dist = np.hypot(dv[:, 0], dv[:, 1])
        for i in np.argsort(-dist):
            r = a[i, 2]
            ang = math.asin(min(1.0, r / max(dist[i], r)))
            rel = wrap(math.atan2(dv[i, 1], dv[i, 0]) - heading)
            if abs(rel) < FOV / 2 + ang:
                disc(f, to_x(rel), HORIZON_Y, max(1.0, ang_px(ang)), AST_COLOR)
    # meteors: glowing, dimmer than the target, fading with distance
    m, _ = world.meteors_at(t)
    for x, y, r in m:
        dv = np.array([x, y]) - pos
        dist = math.hypot(*dv)
        ang = math.asin(min(1.0, r / max(dist, r)))
        rel = wrap(math.atan2(dv[1], dv[0]) - heading)
        if abs(rel) < FOV / 2 + ang:
            k = min(1.0, (METEOR_FADE / max(dist, 1e-6)) ** 2)
            glow(f, to_x(rel), HORIZON_Y, max(3.0, ang_px(ang)), world.meteor_color * k, sigma_min=12.0)
    return f


def render_down(pos, world, blind=False):
    """The landing camera, looking straight down at the surface, in the pilot's frame."""
    f = np.zeros((H, W, 3), np.uint8)
    if blind:
        return f
    dv = pos - world.target
    d = math.hypot(*dv)
    n = dv / d
    tv = np.array([-n[1], n[0]])                 # the pilot's left
    theta = math.atan2(n[1], n[0])
    # beta: angle from straight down toward the pilot's left; ray angle = theta + pi - beta
    stars(f, theta + math.pi, mirror=True)
    a_ang = math.asin(min(1.0, world.R / d))
    a_px = ang_px(a_ang)
    x = np.arange(W)
    beta = (W / 2 - x) / (W / 2) * (FOV / 2)
    hit = np.abs(beta) < a_ang
    if hit.any():
        b = beta[hit]
        s = d * np.cos(b) - np.sqrt(np.maximum(0.0, world.R ** 2 - (d * np.sin(b)) ** 2))
        hx = d * n[0] + s * (-n[0] * np.cos(b) + tv[0] * np.sin(b))
        hy = d * n[1] + s * (-n[1] * np.cos(b) + tv[1] * np.sin(b))
        phi = np.arctan2(hy, hx)
        shade = (1 - 0.45 * world.slopes(phi) / SLOPE_AMP).astype(np.float32)
        cols = np.clip(world.surface[None, :] * shade[:, None], 0, 255).astype(np.uint8)
        half = np.sqrt(np.maximum(0.0, a_px ** 2 - (x[hit] - W / 2) ** 2))
        yy = np.arange(H)[:, None]
        inside = np.abs(yy - HORIZON_Y) <= half[None, :]
        cols_img = np.broadcast_to(cols[None, :, :], (H, len(cols), 3))
        sub = f[:, hit]
        sub[inside] = cols_img[inside]
        f[:, hit] = sub
    # the pad's lights, if the pad is on the side facing the camera
    pp = world.target + world.R * np.array([math.cos(world.pad_phi), math.sin(world.pad_phi)])
    if math.cos(world.pad_phi - theta) > world.R / d:
        v = pp - pos
        dist = math.hypot(*v)
        beta_p = wrap(theta + math.pi - math.atan2(v[1], v[0]))
        if abs(beta_p) < FOV / 2 + 0.2:
            core = max(3.0, ang_px(math.atan(PAD_R / max(dist, 1e-6))))
            glow(f, to_x(beta_p), HORIZON_Y, core, PAD_COLOR, sigma_min=10.0)
    return f


def pad_angle_down(pos, world):
    """Where the pad is in the landing camera, radians, + = pilot's left."""
    dv = pos - world.target
    theta = math.atan2(dv[1], dv[0])
    pp = world.target + world.R * np.array([math.cos(world.pad_phi), math.sin(world.pad_phi)])
    v = pp - pos
    return wrap(theta + math.pi - math.atan2(v[1], v[0]))
