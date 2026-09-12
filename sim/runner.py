"""The broadcast: fly one mission after another, for ever.

Missions are picked by a published rule, not by hand:

  * every mission is a level and a number; the number only ever goes up, so
    nobody can pick a lucky seed -- mission 37 of level 1 is the same world for
    everyone who runs it;
  * the campaign starts at the Moon. Land, and the next flight goes one level
    further; fail twice in a row, and it drops back a level;
  * every tenth flight is the blind control -- the same brain with the window
    painted over -- flown at the current level. It never changes the campaign,
    it only keeps the scoreboard honest.

State lives in runs/campaign.json, so a restart continues where it stopped.

    python runner.py                 fly for ever
    python runner.py --once          one mission, then stop
    python runner.py --keep 120      how many flights stay published
"""
import argparse
import json
import subprocess
import sys
import threading
import time
from pathlib import Path

import export as ex
import mission as M
import world as wd
from analyze import SUCCESS

HERE = Path(__file__).resolve().parent
STATE = M.RUNS / "campaign.json"
BLIND_EVERY = 10
KEEP_DEFAULT = 120
SLOT_S = 600                     # a launch goes out every ten minutes, on the clock
CREW_S = 90                      # how often the passenger list is re-read from the chain


def load_state():
    if STATE.exists():
        return json.loads(STATE.read_text())
    return {"flights": 0, "level": 1, "fails_in_row": 0, "next_seed": 1}


def save_state(s):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(s, indent=1))


def log(msg):
    line = f"{time.strftime('%Y-%m-%d %H:%M:%S')} {msg}"
    print(line, flush=True)
    with (M.RUNS / "runner.log").open("a", encoding="utf-8") as f:
        f.write(line + "\n")


def next_mission(s):
    """What to fly now: the campaign level, or the blind control every tenth."""
    blind = (s["flights"] + 1) % BLIND_EVERY == 0
    return ("blind" if blind else "fly"), s["level"], s["next_seed"]


def advance(s, mode, outcome):
    s["flights"] += 1
    s["next_seed"] += 1
    if mode == "blind":
        return s                                   # the control never moves the campaign
    if outcome in SUCCESS:
        s["fails_in_row"] = 0
        if s["level"] + 1 in wd.LEVELS:
            s["level"] += 1
            log(f"campaign: landed, moving up to level {s['level']} ({wd.LEVELS[s['level']]['name']})")
    else:
        s["fails_in_row"] += 1
        if s["fails_in_row"] >= 2 and s["level"] > 1:
            s["level"] -= 1
            s["fails_in_row"] = 0
            log(f"campaign: two failures, dropping back to level {s['level']} ({wd.LEVELS[s['level']]['name']})")
    return s


def prune(keep_runs):
    """Old flights leave the disk: at three minutes a flight this grows for ever.

    By the same rule the page uses, so the opening missions survive here too: it
    would be pointless to pin them in the index and then delete the files."""
    runs = sorted(M.RUNS.glob("*-L*-s*.json"), key=lambda p: p.stat().st_mtime)
    kept = {p.name for p in ex.select(runs, keep_runs)}
    gone = [p for p in runs if p.name not in kept]
    for old in gone:
        old.unlink()
    if gone:
        log(f"pruned {len(gone)} old flights, {len(kept)} kept on disk")


def publish(keep):
    """Rebuild the bundles the site serves, keeping the newest `keep` flights."""
    out = subprocess.run([sys.executable, str(HERE / "export.py"), "--keep", str(keep)],
                         cwd=HERE, capture_output=True, text=True)
    if out.returncode != 0:
        log(f"export failed: {out.stderr.strip()[:400]}")
    else:
        log(out.stdout.strip() or "exported")


def announce(mission_id):
    """The broadcast schedule.

    Launches go out on a grid of slots counted from the unix epoch, so every
    viewer's clock agrees: at 00:00, 00:10, 00:20 and so on, the same flight
    starts for everybody. Which flight a slot shows is decided by the page from
    the index -- the newest one that was finished before the slot began -- so
    the schedule keeps ticking even while the next flight is still being
    computed. The flight itself was computed earlier; the page says so."""
    web = HERE.parent / "web" / "missions"
    web.mkdir(parents=True, exist_ok=True)
    (web / "live.json").write_text(json.dumps({
        "interval_s": SLOT_S,
        "epoch": 0,
        "latest": mission_id,
        "generated": int(time.time()),
    }), encoding="utf-8")


def crew_loop(every_s=CREW_S):
    """Keep `web/missions/crew.json` current: the token's top holders now.

    The passengers are not part of a flight. There is one list, it is whoever
    holds the token at this moment, and every flight on the page -- today's and
    last week's -- shows it. So it lives in its own small file that the page
    re-reads while it plays, and it is written here, on its own clock, rather
    than at flight boundaries: a flight takes minutes and the seats should not
    wait for one to end.

    The explorer refusing must never stop the broadcast, so a failure leaves the
    last good list in place and is only written to the log."""
    web = HERE.parent / "web" / "missions"
    import holders
    while True:
        try:
            c = holders.crew()
            web.mkdir(parents=True, exist_ok=True)
            (web / "crew.json").write_text(json.dumps(c), encoding="utf-8")
            log(f"crew: top {len(c['seats'])} of {c['token']['symbol']}, "
                f"{c['token']['holders']:,} addresses hold it")
        except Exception as e:
            log(f"crew: not read ({type(e).__name__}: {str(e)[:140]}); keeping the last list")
        time.sleep(every_s)


def fly_one(keep):
    s = load_state()
    mode, level, seed = next_mission(s)
    log(f"flight {s['flights'] + 1}: {mode} mission {seed}, level {level} ({wd.LEVELS[level]['name']})")
    t0 = time.time()
    result = M.fly_mission(mode, seed, level, save_frames=False)
    log(f"  -> {result['outcome']} at T+{result['t']:.1f} in {time.time() - t0:.0f}s wall")
    save_state(advance(s, mode, result["outcome"]))
    prune(keep * 5)                                 # keep more on disk than on the page
    publish(keep)
    announce(f"{mode}-L{level}-s{seed}")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--once", action="store_true")
    ap.add_argument("--keep", type=int, default=KEEP_DEFAULT)
    a = ap.parse_args()
    log(f"runner started (keeping the newest {a.keep} flights published)")
    if not a.once:
        threading.Thread(target=crew_loop, daemon=True).start()
    while True:
        try:
            fly_one(a.keep)
        except Exception as e:                      # a bad flight must not stop the broadcast
            log(f"flight failed: {type(e).__name__}: {e}")
            time.sleep(20)
        if a.once:
            return


if __name__ == "__main__":
    main()
