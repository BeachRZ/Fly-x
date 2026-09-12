# FLY-X on a server

What a flight costs, how the broadcast actually runs, and what would be needed to
put the brain live in the loop.

## What costs what

Measured on a Ryzen 5 2500U laptop:

| step | time |
|---|---|
| one brain step (28.6 ms of neural time, 166,700 neurons, 25.6M synapses) | 228 ms |
| the same step while the legs' sensors fire (2,522 neurons stimulated) | ~970 ms |
| the window frame (640×480) | 16 ms |
| the landing camera frame | 46 ms |
| sampling the 3,335 photoreceptors | 3 ms |

Real time would need 28.6 ms per step, so that laptop is about 8 times slower
than real time. A server core is roughly 2 to 3 times quicker, which puts one
flight at 2 to 4 minutes of compute.

The brain is deterministic: the same mission (level and number) gives the same
flight byte for byte. That property is what makes the whole design simple, and it
is what anyone checking the project relies on.

## How the broadcast runs

```
[runner.py]  ->  [runs/*.json]  ->  [export.py]  ->  [web/missions/*.json]  ->  browsers
 one flight       the raw flight     bundles for      index.json, live.json     render in 3D
 after another    and its trace      the viewer       crew.json                 themselves
```

* **runner.py** picks the next mission by a published rule: the campaign level, or
  the blind control on every tenth flight. Its state lives in `runs/campaign.json`,
  so a restart continues where it stopped. A single flight that fails cannot stop
  the broadcast.
* **The passenger list** is refreshed on its own clock, every 90 seconds, into
  `web/missions/crew.json`. The explorer being down costs the list nothing: the
  last good one stays.
* **The schedule** is a grid of ten-minute slots counted from the Unix epoch, in
  `live.json`. There is no `/now` endpoint and no server clock to agree with: every
  viewer computes the same slot from their own clock, and the page picks the newest
  flight that was ready before the slot began. That keeps the schedule ticking
  while the next flight is still being computed.
* **The browser** fetches a bundle and plays it locally. All 3D is on the viewer's
  side and the server renders nothing, so the cost per viewer is one static file of
  a few hundred kilobytes.

The page never pretends this is live: it carries the badge *REPLAY, the brain
computed this flight in N min*.

## Provable honesty

* The rules (`world.py`), the code, and the hash of the neural kernel binary are
  public; the kernel checks itself against `kernel.cpp` before every run.
* Every flight is defined by its level and number, so anyone can run
  `python mission.py --mode fly --seed N --level L` and get the same bundle.
* Blind control flights run in the same queue as the rest, so the page can always
  show "seeing fly: X landings of N, blind: 0 of M".

## What true real time would take

Only needed if viewers are to affect a flight while it happens. It is an eightfold
speedup away:

1. **The neural kernel on a GPU.** 25.6M synapses fit in about 200 MB of video
   memory, and an event-driven LIF model maps well onto CUDA: expect 2 to 5 ms per
   step, which is real time with headroom on one card. The biggest win and a
   project of its own, because the rewrite has to be checked against the CPU
   version step by step.
2. **A window with no raster.** Compute luminance analytically at the 3,335 retinal
   sample points instead of rendering 640×480. Saves 20 to 45 ms per step.
3. **A faster CPU** buys another 2 to 3 times. Not enough on its own.
4. **Do not enlarge the integration step.** That changes the brain model and makes
   every earlier result incomparable.
