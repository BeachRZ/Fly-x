"""Score finished missions from their results, without re-running any brain.

The outcome is decided inside the simulation by fixed rules (world.py):
  landed      soft touchdown on the lit pad
  landed_off  touchdown on open ground the legs could stand on
  tipped      touched down, then fell over (too steep, or sliding sideways)
  crash       touched down too fast: the legs failed
  impact      hit the target before the rocket could flip and brake
  collision   hit an asteroid or a meteor
  earth       fell back to Earth
  lost        still flying when the mission clock ran out

    python analyze.py            every mission in the runs folder
"""
import json
import os
from collections import Counter, defaultdict
from pathlib import Path

RUNS = Path(os.environ.get("FLY_SPACE_RUNS", r"E:\test\fly\space-runs"))
SUCCESS = ("landed", "landed_off")


def score(d):
    res = d["result"]
    return {"mode": res["mode"], "level": res["level"], "seed": res["seed"], "outcome": res["outcome"],
            "landed": res["outcome"] in SUCCESS, "on_pad": res["outcome"] == "landed",
            "t": res["t"], "closest": res["closest"], "fuel_left": res["fuel_left"]}


def main():
    rows = [score(json.loads(p.read_text())) for p in sorted(RUNS.glob("*-L*-s*.json"))]
    print(f"{'level':5} {'mode':8} {'seed':>4} {'outcome':11} {'t':>6} {'closest':>8} {'fuel':>5}")
    for r in sorted(rows, key=lambda r: (r["level"], r["mode"], r["seed"])):
        print(f"{r['level']:5d} {r['mode']:8} {r['seed']:4d} {r['outcome']:11} {r['t']:6.1f} "
              f"{r['closest']:8.1f} {r['fuel_left']:5.1f}")
    tally = defaultdict(Counter)
    for r in rows:
        tally[(r["level"], r["mode"])][r["outcome"]] += 1
    print()
    for (level, mode), c in sorted(tally.items()):
        n = sum(c.values())
        ok = c["landed"] + c["landed_off"]
        print(f"level {level} {mode:8} {n:3d} flights: landed {ok} (on the pad {c['landed']}) · "
              + ", ".join(f"{k} {v}" for k, v in c.most_common() if k not in SUCCESS))


if __name__ == "__main__":
    main()
