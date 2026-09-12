# FLY X — a fly flies the rocket

A real fruit fly brain (MaleCNS v1.0 connectome: 166,700 neurons, 25.6 million synapses, DOOMFLY's native kernel) flies a rocket to the Moon and to Mars by nothing but what its eyes see. The seeing fly runs against a blind one (window painted over) — that control is the proof, and it is always kept.

## What is in this repository

| path | what |
|---|---|
| `sim/` | the simulation: world rules, the mission loop, the onboard log, scoring, export |
| `web/` | the viewer: a three.js webcast page, with the finished flights in `web/missions/` |
| `tools/` | Playwright screenshots of the viewer |
| `SERVER.md` | how this runs as a broadcast, and what true real time would take |

The finished flights are committed on purpose: open the page and you see exactly
the flights the numbers below describe, and anyone can recompute any of them
from its level and number and compare the result.

## Who does what

| who | what |
|---|---|
| **the fly** | the lever = right DNp20 minus left (minus a fixed bias measured once on an empty sky). On the way out the lever turns the rocket; in the landing it moves the rocket sideways. Nothing else steers. |
| **the flight computer** | throttle, the flip engines-first, braking, descent rate, the landing camera, cutting the engine on the legs' signal, and near the ground a limit on sideways speed. It never knows where the target or the pad is — it reads only its own altitude. |
| **the world** | fixed rules per level (`sim/world.py`): gravity, air, fuel, rocks, meteors, the pad and the ground round it. The mission number only picks where things are. |

On touchdown the leg sensors drive 2,522 leg mechanosensory neurons of the fly (the same stimulus path DOOMFLY uses for sugar). The brain's answer goes into the log.

## Levels

1. **Moon** — 8 dark asteroids along the way, 6 meteors (up to 30% of the Moon's light, fading with distance), fuel for 48 s of burn.
2. **Mars** — new moon, Mars much dimmer than the Moon, a belt of 12 asteroids, 8 meteors, fuel for 62 s.

## Outcomes (decided by the simulation)

`landed` on the pad · `landed_off` on open ground · `tipped` over (slope > 12° or sliding > 2 u/s) · `crash` (> 6 u/s down) · `impact` with the surface before the flip · `collision` with a rock or a meteor · `earth` fell back · `lost` missed.

## Results so far (2026-09-12)

| level | pilot | flights | landed | what happened |
|---|---|---|---|---|
| 1 Moon | fly | 12 | 7 (3 on the pad) | 3 asteroid collisions, 2 tipped over |
| 1 Moon | blind (control) | 3 | 0 | 3 missed |
| 2 Mars | fly | 3 | 1 (on the pad) | 1 collision, 1 tipped over |
| 2 Mars | blind (control) | 2 | 0 | 2 missed |
| 1 Moon | perfect autopilot (upper bound) | 20 | 14 | 6 asteroid collisions |

## Running it

Heavy data and runs live on `E:\test\fly` (venv, DOOMFLY, `space-runs`).

```
cd sim
E:\test\fly\.venv\Scripts\python.exe mission.py --calibrate                   # empty-sky bias (once)
E:\test\fly\.venv\Scripts\python.exe mission.py --mode fly --seed 3 --level 1 # one flight (~5-15 min)
E:\test\fly\.venv\Scripts\python.exe mission.py --mode blind --seed 3         # control: window covered
E:\test\fly\.venv\Scripts\python.exe mission.py --mode oracle --seed 3        # perfect pilot (seconds)
E:\test\fly\.venv\Scripts\python.exe analyze.py                               # tally of outcomes
E:\test\fly\.venv\Scripts\python.exe flightlog.py fly-L1-s3                   # the onboard log
E:\test\fly\.venv\Scripts\python.exe export.py                                # bundles for the site
```

The site: from the repository root run `py -3.11 -m http.server 8090`, then open `http://127.0.0.1:8090/web/index.html`.
Query parameters: `?mission=fly-L1-s3&t=30&cam=landing&paused=1&auto=0` (cameras: `chase`, `pilot`, `cockpit`, `cabin`, `landing`, `overview`).
The pilot, cockpit, cabin and landing cameras are free: drag to turn, wheel to zoom.

Screenshots: `C:\pyprojects\venv\Scripts\python.exe tools/shoot_space.py <dir> [shot ...]`.

## Rule changes (all public)

- **Sideways speed near the ground** (`LAT_ALT`, `LAT_MIN` in `world.py`). The first four fly landings all tipped over, touching down at about 3 u/s sideways: the pad's angle in the camera grows as 1/height, so full sideways speed close to the ground turned every small correction into a swing. Below 20 units the computer limits sideways speed in proportion to height, the way real landers fly the last stretch nearly vertically. The direction stays the fly's. Runs from before the change are kept in `space-runs/pre-latlimit/`.

Server and real time: see [SERVER.md](SERVER.md).
