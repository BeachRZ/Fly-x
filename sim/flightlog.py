"""Onboard computer: a short flight log and a cause, from telemetry only.

Every line is computed from what the simulation recorded -- its events (flip,
touchdown, collisions, the legs' sensor response), the trace (angle to the
target, lever, DNp20 firing, the eye's adaptation, fuel) and the closest passes
of every rock and meteor -- so the log is dry and deadpan but never invents
anything. No language model is involved.

    python flightlog.py fly-L1-s1          one mission, as text
    python flightlog.py --all              every fly and blind mission
    python flightlog.py --json fly-L1-s1   timestamped events, for the 3D viewer
"""
import json
import os
import sys
from pathlib import Path

RUNS = Path(os.environ.get("FLY_SPACE_RUNS", r"E:\test\fly\space-runs"))
LOCK_DEG = 5.0
NEAR_MISS = 5.0                  # a rock passing closer than this gets a line
SUCCESS = ("landed", "landed_off")

# "the Moon", but plain "Mars": the article belongs to the name, not to grammar.
ARTICLE = {"Moon": "the Moon"}


def target_name(level):
    return ARTICLE.get(level["name"], level["name"])


def side(deg):
    if abs(deg) < 1:
        return "dead centre"
    return f"{abs(deg):.0f}° {'left' if deg > 0 else 'right'}"


def num(v):
    return f"{v:,}"


def rows_of(d):
    return [dict(zip(d["trace_fields"], r)) for r in d["trace"]]


def events_for(d):
    """[(t, text), ...] in time order, plus a one-line cause."""
    res, lvl = d["result"], d["level"]
    name = target_name(lvl)
    Name = "The " + name[4:] if name.startswith("the ") else name      # at the start of a sentence
    rows = rows_of(d)
    flight = [r for r in rows if r["t"] >= 0]
    fwd = [r for r in flight if r["view"] == "fwd"]
    down = [r for r in flight if r["view"] == "down"]
    blind = res["mode"] == "blind"
    evs = {e["type"]: e for e in d["events"]}
    ev = []

    if flight:
        ev.append((0.0, f"Liftoff. {Name} in the window: {side(flight[0]['rel_deg'])}. "
                        f"Fuel for {lvl['fuel_s']:.0f} s of burn."))
    if "out_of_air" in evs:
        e = evs["out_of_air"]
        ev.append((e["t"], f"Out of the dense air: altitude {e['alt']:.0f}, speed {e['speed']:.0f} u/s."))

    lock = next((r for r in fwd if abs(r["rel_deg"]) <= LOCK_DEG), None)
    if lock:
        ev.append((lock["t"], f"Target centred in the window ({lock['rel_deg']:+.0f}°). "
                              f"DNp20: right {lock['R_hz'] or 0:.0f} Hz, left {lock['L_hz'] or 0:.0f} Hz."))
    best, run, prev, best_end = 0.0, 0.0, None, None
    for r in fwd:
        if abs(r["rel_deg"]) <= LOCK_DEG and prev is not None:
            run += r["t"] - prev
        elif abs(r["rel_deg"]) > LOCK_DEG:
            run = 0.0
        if run > best:
            best, best_end = run, r["t"]
        prev = r["t"]
    if best >= 2:
        ev.append((best_end, f"Target held centred for {best:.1f} s without a break."))

    dimmed = next((r for r in fwd if (r.get("eye_gain") or 1.0) < 0.5), None)
    if dimmed:
        ev.append((dimmed["t"], f"{Name} is blinding. The retina turns its sensitivity down to "
                                f"{dimmed['eye_gain'] * 100:.0f}%."))

    # meteors: did the pilot turn to the light, and did the target slide away?
    lured = set()
    for mid in sorted({r["met_id"] for r in fwd if r.get("met_id") is not None}):
        seen = [r for r in fwd if r.get("met_id") == mid]
        k = max(r["met_k"] for r in seen)
        if k < 0.03:
            continue
        toward = [r for r in seen if r["lever"] * r["met_rel"] > 0 and abs(r["lever"]) > 0.3]
        worst = max(seen, key=lambda r: abs(r["rel_deg"]))
        start = abs(seen[0]["rel_deg"])
        tag = f"M-{mid + 1}"
        if len(toward) >= 3 and abs(worst["rel_deg"]) > start + 10:
            lured.add(mid)
            ev.append((toward[0]["t"], f"Meteor {tag} in the window ({side(toward[0]['met_rel'])}, "
                                       f"{k * 100:.0f}% of {name}'s light). The pilot turned toward its light: "
                                       f"the target slid to {side(worst['rel_deg'])}."))
        else:
            ev.append((seen[0]["t"], f"Meteor {tag} in the window ({side(seen[0]['met_rel'])}, "
                                     f"{k * 100:.0f}% of {name}'s light). The pilot held its course."))

    for i, (c, t) in enumerate(d["near"]["asteroids"]):
        if 0 <= c < NEAR_MISS:
            r = lvl["asteroids"][i][2]
            ev.append((t, f"Asteroid A-{i + 1} (radius {r:.0f}) passed {c:.1f} u from the hull."))
    for i, (c, t) in enumerate(d["near"]["meteors"]):
        if c is not None and 0 <= c < NEAR_MISS:
            ev.append((t, f"Meteor M-{i + 1} passed {c:.1f} u from the hull."))

    if "fuel_out" in evs:
        e = evs["fuel_out"]
        coast = " The rocket coasts." if not down or e["t"] < down[0]["t"] else ""
        ev.append((e["t"], "Fuel: 0%. Engine stopped." + coast))
    if "no_fuel_landing" in evs:
        e = evs["no_fuel_landing"]
        ev.append((e["t"], f"Flight computer: {e['alt']:.0f} to the ground, no fuel left to brake. Flip cancelled."))
    if "flip_start" in evs:
        e = evs["flip_start"]
        ev.append((e["t"], f"Flight computer: flip, engines first. Altitude {e['alt']:.0f}, closing "
                           f"{e['closing']:.0f} u/s. The pilot's lever is off for the manoeuvre."))
    if "flip_end" in evs:
        ev.append((evs["flip_end"]["t"], "Flip complete, landing burn. The pilot now looks through the landing "
                                         "camera; its lever moves the rocket sideways."))
    centred = next((r for r in down if abs(r["rel_deg"]) <= LOCK_DEG), None)
    if centred and "flip_end" in evs:
        ev.append((centred["t"], f"Pad centred in the landing camera ({centred['rel_deg']:+.0f}°), "
                                 f"altitude {centred['alt']:.0f}."))
    elif down and "flip_end" in evs:
        far = min(down, key=lambda r: abs(r["rel_deg"]))
        ev.append((far["t"], f"The pad never came to the centre of the camera: closest {side(far['rel_deg'])}."))

    lat_alt = d["world"].get("LAT_ALT")
    low = next((r for r in down if r["phase"] == "landing" and r["alt"] < lat_alt), None) if lat_alt else None
    if low:
        ev.append((low["t"], f"Flight computer: altitude {lat_alt:.0f}. Below this the sideways speed is limited "
                             f"in proportion to height; the direction stays the pilot's."))

    if "touchdown" in evs:
        e = evs["touchdown"]
        ev.append((e["t"], f"Touchdown: {e['v_down']:.1f} u/s down, {e['v_side']:.1f} u/s sideways, ground slope "
                           f"{e['slope']:.0f}°, {e['from_pad']:.1f} u from the centre of the pad."))
    if "engine_cut" in evs:
        ev.append((evs["engine_cut"]["t"], "Leg sensors: contact. Engine cut."))
    touch = d.get("touch")
    if "legs_felt" in evs and touch:
        label = lambda ty: "cells with no named type" if ty in ("", "?") else ty
        at = evs["touchdown"]["t"] if "touchdown" in evs else evs["legs_felt"]["t"]
        top = ", ".join(f"{label(x['type'])} (+{num(x['extra_spikes'])})" for x in touch["top_types"][:3])
        ev.append((at + touch["seconds"], f"The legs' signal reached {num(touch['stimulated'])} leg mechanosensory "
                                          f"neurons. In {touch['seconds']:.1f} s the ascending neurons (legs → brain) "
                                          f"fired {num(touch['an_spikes'])} spikes, against "
                                          f"{num(touch['an_spikes_before'])} before contact. "
                                          f"Strongest in the brain: {top}."))

    cause = cause_for(d, name, Name, blind, lured)
    ev.sort(key=lambda x: x[0])
    return ev, cause


def cause_for(d, name, Name, blind, lured=()):
    res = d["result"]
    o, det = res["outcome"], res.get("detail") or {}
    if o == "landed":
        soft = det["v_down"] <= d["world"]["V_SOFT"]
        return (f"LANDED ON THE PAD, T+{res['t']:.1f}. {det['v_down']:.1f} u/s down — "
                + ("soft." if soft else "hard, but the legs held.") + " The crew is fine.")
    if o == "landed_off":
        return (f"LANDED OFF THE PAD, {det['from_pad']:.0f} u from it. Slope {det['slope']:.0f}°, the legs held. "
                f"The crew is fine.")
    if o == "tipped":
        why = (f"ground slope {det['slope']:.0f}°, above the {d['world']['SLOPE_MAX']:.0f}° the legs can stand on"
               if det["slope"] > d["world"]["SLOPE_MAX"]
               else f"{det['v_side']:.1f} u/s sideways: the pilot did not stop the rocket over the ground")
        return f"CAUSE: the rocket tipped over after touchdown — {why}. The pad was {det['from_pad']:.0f} u away."
    if o == "crash":
        tail = " Fuel ran out on the way down." if det.get("fuel_s", 1) <= 0 else ""
        return f"CAUSE: hit the ground at {det['v_down']:.0f} u/s, the legs failed.{tail}"
    if o == "impact":
        return (f"CAUSE: hit {name} at {det['speed']:.0f} u/s — the rocket did not flip in time to brake.")
    if o == "collision":
        if det["kind"] == "asteroid":
            return (f"CAUSE: collision with asteroid A-{det['id'] + 1} (radius {det['r']:.0f}) at "
                    f"{det['speed']:.0f} u/s. A dark rock on a dark sky.")
        own = " The pilot turned toward its light itself." if det["id"] in lured else ""
        return f"CAUSE: collision with meteor M-{det['id'] + 1}, closing at {det['speed']:.0f} u/s.{own}"
    if o == "earth":
        return "CAUSE: fell back to Earth — the rocket turned too steeply and lost height."
    if res["closest"] < 300:
        return (f"CAUSE: missed — passed {res['closest']:.0f} u from {name}, not enough fuel for another approach.")
    return (f"CAUSE: target lost. Mean angle to {name} {res['mean_abs_angle_deg']:.0f}°, course not held."
            + (" The pilot could not see the target." if blind else ""))


def text_log(d):
    res = d["result"]
    pilot = "fly (window covered)" if res["mode"] == "blind" else "fly"
    ev, cause = events_for(d)
    name = target_name(d["level"])
    lines = [f"FLIGHT LOG · {name} · mission {res['seed']} · pilot: {pilot}"]
    lines += [f"T+{t:<5.1f} {text}" for t, text in ev]
    lines.append(cause)
    return "\n".join(lines)


def main():
    args = sys.argv[1:]
    as_json = "--json" in args
    args = [a for a in args if a != "--json"]
    if args == ["--all"]:
        paths = sorted(p for p in RUNS.glob("*-L*-s*.json") if p.name.split("-")[0] in ("fly", "blind"))
    else:
        paths = [RUNS / f"{a}.json" for a in args]
    for p in paths:
        d = json.loads(p.read_text())
        if as_json:
            ev, cause = events_for(d)
            print(json.dumps({"events": [{"t": round(t, 2), "text": x} for t, x in ev], "cause": cause},
                             ensure_ascii=False))
        else:
            print(text_log(d))
            print()


if __name__ == "__main__":
    main()
