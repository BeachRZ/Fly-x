# FLY X on a server: real time and optimisation

## What costs what (measured on this laptop, Ryzen 5 2500U)

| step | time |
|---|---|
| one brain step (28.6 ms of neural time, 166,700 neurons, 25.6M synapses) | 228 ms |
| the same step while the legs' sensors fire (2,522 neurons stimulated) | ~970 ms |
| the window frame (640×480) | 16 ms |
| the landing camera frame | 46 ms |
| sampling the 3,335 photoreceptors | 3 ms |

Real time needs 28.6 ms per step, so this laptop is about 8× slower than real time. One flight to the Moon (~37 s) takes ~5 minutes alone and ~13 minutes when three run side by side.

The brain is deterministic: the same mission (level + number) gives the same flight byte for byte. That property is what makes the server design simple.

## Broadcast architecture (recommended for launch)

An honest "live with delay": flights are computed ahead, the viewer watches a finished flight and sees the badge *REPLAY · the brain computed this flight in N min*.

```
[sim workers]        ->  [queue of finished flights]  ->  [broadcaster]  ->  [CDN static]  ->  browsers
 python mission.py       missions/*.json + index          which flight       html/js/three     render in 3D
 one process per core    (gzip ~200-400 KB)               is on now and      + flight bundles  themselves
                                                          from which second
```

- **Workers.** One `mission.py` process per physical core, taking jobs (level, number) from a queue (SQLite/Redis) and writing bundles through `export.py`.
- **Broadcaster.** A tiny service (FastAPI or Node) serving `/now`: the current flight and its start time by the server clock. Every viewer sees the same second of the same flight — one shared channel, one shared chat, shared reactions.
- **The browser** fetches the bundle from a CDN and plays it locally: all 3D is on the viewer's side, the server renders nothing. For 10,000 viewers you only need a CDN (~300 KB per flight per viewer).
- **Throughput.** A flight lasts 40-60 s on screen. A modern server core is roughly 2-3× faster than a 2500U core, so ~2-3 minutes of compute per flight. Eight cores give 3-4 flights per minute against the ~1 per minute a continuous channel needs. One modest dedicated box (8 cores, 16 GB) sustains a 24/7 channel and builds a buffer.

## Provable honesty

- Publish the rules (`world.py`), the code, and the hash of the neural kernel binary (DOOMFLY already verifies it against `kernel.cpp`).
- Every flight is defined by its level and number. Anyone can run `python mission.py --mode fly --seed N --level L` and get the same bundle.
- Blind control flights run in the same queue, so the page can always show "seeing fly: X landings of N, blind: 0 of M".

## True real time (the brain live in the loop)

Needed if viewers are to affect a flight as it happens (holders voting where to throw a meteor, say). It takes an 8× speedup:

1. **The neural kernel on a GPU.** 25.6M synapses fit in ~200 MB of video memory, and an event-driven LIF model maps well onto CUDA. Expect 2-5 ms per step — real time with headroom on a single card. The biggest win, and a project of its own: rewrite `kernel.cpp` and check it against the CPU version step by step.
2. **A window with no raster.** Compute luminance analytically at the 3,335 retinal sample points (stars, discs, glows) instead of rendering 640×480. Saves ~20-45 ms per step and removes the gap between the window and the landing camera.
3. **A fast CPU** (AVX-512, high clock) buys another 2-3×. Not enough on its own for real time.
4. **Do not** enlarge the integration step (0.1 ms → 0.25 ms). That changes the brain model and makes results incomparable.

## Token

- The top-10 holders come from a Solana RPC (Helius/Triton) before each launch; their addresses are the names on the seats. The site currently shows demo addresses and says so.
- The mission number and its outcome can be written into a memo transaction: a public flight log on chain.

## Order of work

1. Job queue plus a worker wrapper around `mission.py`, one exported bundle per flight.
2. The `/now` broadcaster and synchronised playback in `main.js`: broadcast time instead of the local clock.
3. Static hosting on a CDN, gzip for the bundles (they are plain JSON today).
4. Monitoring: flights in the buffer, compute time, outcome counters.
5. (Later) the GPU kernel for true real time.
