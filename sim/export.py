"""Bundle finished missions for the 3D viewer.

Each bundle carries the trace, the rules, the level (target, rocks, meteors,
pad, ground), the result, the simulation's own events, the onboard log (from
flightlog.py, the single source of its wording) and everything the viewer needs
to redraw the pilot's window by the same rule the retina saw it.

    python export.py        -> web/missions/<id>.json and index.json
"""
import json
from pathlib import Path

import mission as M
import world as wd
from analyze import SUCCESS
from flightlog import events_for

OUT = Path(__file__).resolve().parents[1] / "web" / "missions"


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
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob("*.json"):
        old.unlink()
    index = []
    for p in sorted(M.RUNS.glob("*-L*-s*.json")):
        mode = p.name.split("-")[0]
        if mode not in ("fly", "blind"):
            continue
        b = bundle(p)
        (OUT / f"{p.stem}.json").write_text(json.dumps(b, ensure_ascii=False), encoding="utf-8")
        r = b["result"]
        index.append({"id": p.stem, "mode": mode, "level": r["level"], "target": r["target"], "seed": r["seed"],
                      "outcome": r["outcome"], "landed": b["landed"], "on_pad": b["on_pad"], "t": r["t"]})
    index.sort(key=lambda m: (m["level"], m["mode"] != "fly", m["seed"]))
    (OUT / "index.json").write_text(json.dumps(index, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"exported {len(index)} missions to {OUT}")


if __name__ == "__main__":
    main()
