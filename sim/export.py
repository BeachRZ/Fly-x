"""Bundle finished missions for the 3D viewer.

Each bundle carries the trace, the rules, the level (target, rocks, meteors,
pad, ground), the result, the simulation's own events, the onboard log (from
flightlog.py, the single source of its wording) and everything the viewer needs
to redraw the pilot's window by the same rule the retina saw it.

    python export.py        -> web/missions/<id>.json and index.json
"""
import argparse
import json
from pathlib import Path

import mission as M
import world as wd
from analyze import SUCCESS
from flightlog import events_for

OUT = Path(__file__).resolve().parents[1] / "web" / "missions"
FIRST_KEPT = 20                  # the opening flights of the campaign, never dropped


def seed_of(path):
    """The mission number out of a run's name: fly-L3-s41 -> 41."""
    return int(path.stem.rsplit("-s", 1)[1])


def select(runs, keep, first=FIRST_KEPT):
    """Which flights stay published.

    The newest `keep`, and on top of them the first `first` missions of the
    campaign, always. The broadcast runs for ever, so without a cap the page
    would grow without end; but dropping the oldest first would quietly delete
    the beginning -- the first flight to the Moon, the first landing, the
    flights the numbers in the README were measured on. Those are the ones worth
    keeping longest, so they are pinned by mission number rather than by age."""
    if not keep:
        return list(runs)
    newest = sorted(runs, key=lambda p: p.stat().st_mtime)[-keep:]
    opening = sorted(runs, key=seed_of)[:first]
    chosen = {p.name for p in newest} | {p.name for p in opening}
    return [p for p in runs if p.name in chosen]


def bundle(path):
    d = json.loads(path.read_text())
    res = d["result"]
    ev, cause = events_for(d)
    return {
        "id": path.stem,
        "result": res,
        "landed": res["outcome"] in SUCCESS,
        "on_pad": res["outcome"] == "landed",
        "world": d["world"],
        "level": d["level"],
        "trace_fields": d["trace_fields"],
        "trace": d["trace"],
        "events": d["events"],
        "touch": d.get("touch"),
        "brain_activity": d.get("brain_activity"),
        "log": [{"t": round(t, 2), "text": text} for t, text in ev],
        "cause": cause,
        "eye": {
            "W": wd.W, "H": wd.H, "FOV": wd.FOV, "HORIZON_Y": wd.HORIZON_Y, "R_EARTH": wd.R_EARTH,
            "AST_COLOR": list(wd.AST_COLOR), "PAD_COLOR": list(wd.PAD_COLOR),
            "METEOR_FADE": wd.METEOR_FADE, "METEOR_K": wd.LEVELS[res["level"]]["meteor_k"],
            "SLOPE_AMP": wd.SLOPE_AMP, "PAD_R": wd.PAD_R,
            "stars": [[round(float(a), 6), int(y), int(b)]
                      for a, y, b in zip(wd.STAR_A, wd.STAR_Y, wd.STAR_B)],
        },
        "brain": {"dataset": "MaleCNS v1.0", "neurons": 166700, "edges": 25582938,
                  "readout": "DNp20 right - left", "bias_hz": res["bias_hz"]},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keep", type=int, default=0,
                    help="publish only the newest N flights (0 = all of them)")
    ap.add_argument("--first", type=int, default=FIRST_KEPT,
                    help="besides those, always publish the first N missions of the campaign")
    a = ap.parse_args()
    keep, first = a.keep, a.first
    OUT.mkdir(parents=True, exist_ok=True)
    # The flight bundles are rebuilt from scratch; the broadcast's own files are
    # not flights and are written by the runner on their own clocks.
    keep_files = {"live.json", "crew.json"}
    for old in OUT.glob("*.json"):
        if old.name not in keep_files:
            old.unlink()
    runs = sorted(M.RUNS.glob("*-L*-s*.json"))
    if keep:
        runs = select(runs, keep, first)
    index = []
    for p in sorted(runs):
        mode = p.name.split("-")[0]
        if mode not in ("fly", "blind"):
            continue
        b = bundle(p)
        (OUT / f"{p.stem}.json").write_text(json.dumps(b, ensure_ascii=False), encoding="utf-8")
        r = b["result"]
        index.append({"id": p.stem, "mode": mode, "level": r["level"], "target": r["target"], "seed": r["seed"],
                      "outcome": r["outcome"], "landed": b["landed"], "on_pad": b["on_pad"], "t": r["t"],
                      # when the flight became available: the broadcast picks, for
                      # each slot, the newest flight that was ready before it began
                      "published": int(p.stat().st_mtime)})
    index.sort(key=lambda m: (m["level"], m["mode"] != "fly", m["seed"]))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"exported {len(index)} missions to {OUT}")


if __name__ == "__main__":
    main()
