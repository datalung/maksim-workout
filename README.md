# Maksim — Workout

A guided walkthrough of my full-body workout program. Static web app, no build step, no dependencies.

- **Program**: see [docs/workout.md](docs/workout.md) (derived from the trainer's original notes in `docs/instructions.txt`)
- **App architecture & modification guide**: see [docs/app.md](docs/app.md)
- **Data**: `workout.js` — exercises, sets/reps, timer segments, and rest periods. Edit this file to change the program.
- **App**: `index.html` + `styles.css` + `app.js`. Timed exercises run and advance themselves with synthesized audio cues (start, 3-2-1 countdown, finish); rest countdowns run inside the next exercise's screen. The whole screen is the tap surface — the hint line says what a tap does (skip rest, pause/resume, continue after reps) and the arrow bottom-right always advances manually. Screen wake lock keeps the phone awake mid-workout, and a service worker makes it work offline.

## Run locally

```sh
python3 -m http.server 8823
# open http://localhost:8823
```

## Deploy

Push to `main` — Vercel deploys the repo as a static site (no configuration needed).

## Install on iPhone

Open the deployed URL in Safari → Share → **Add to Home Screen**. It launches fullscreen as a standalone app.

Note: on iOS the audio cues respect the ring/silent switch — if the beeps are missing, take the phone off silent and check the volume.
