# App documentation

Current state of the workout app: what's in it, how it works, and how to change it safely. Last updated: August 2026.

## What it is

A static, dependency-free web app (plain HTML/CSS/JS, no framework, no build step) that walks through the workout program in `docs/workout.md`, one exercise per screen, with automatic timers, rest countdowns, and audio cues. Hosted on Vercel as a static site; installed on iPhone as a home-screen PWA.

## Files

| File | Role |
|---|---|
| `index.html` | Shell: meta tags (iOS PWA), loads everything. No markup of its own — screens are rendered by JS. |
| `workout.js` | **The program as data.** `BLOCKS` (names + colors) and `EXERCISES` (the 21 exercises, in order). Edit this to change the workout. |
| `app.js` | All behavior: screen rendering, state machine, timers, audio, wake lock, viewport workaround. |
| `styles.css` | The design system. Swiss/International style: Helvetica Neue, hard grid, full-bleed block colors. |
| `sw.js` | Service worker: network-first fetch with cache fallback (fresh online, works offline). **Bump `CACHE` on every change you deploy.** |
| `manifest.webmanifest` | PWA manifest (name, icons, standalone display). |
| `icons/` | App icons: black dumbbell on yellow (`#ffc800`). Generated as flat geometry; favicon.svg matches. |
| `docs/instructions.txt` | The trainer's original notes, untouched. |
| `docs/workout.md` | The full program with proper names and descriptions. Keep in sync with `workout.js` when editing exercises. |

## Data model (`workout.js`)

Each entry in `EXERCISES`:

```js
{
  block: 'core',            // key into BLOCKS — sets screen colors and eyebrow
  name: 'Side planks',      // screen title (poster type)
  scheme: '2 × 30 sec per side', // bold line under the title
  reps: '2 × 15',           // OPTIONAL — rep exercises only: shown big in the timer slot
  restBefore: 30,           // seconds of rest shown on this exercise's screen before work
  segments: [               // OPTIONAL — timed exercises only; omit for rep-based
    { label: 'Set 1 · left', seconds: 30 },
    // segments auto-chain with a 5s "switch" countdown between them
  ],
  description: '…',         // how to do it (2–3 sentences)
  trains: 'Obliques, …',    // small caps line under the description
}
```

Rules:
- **Timed exercise** = has `segments`. It runs itself: rest → each segment auto-starts → auto-advances to the next exercise.
- **Rep exercise** = no `segments`, has `reps`. After rest it waits ("Your pace — tap anywhere when done"); a tap advances.
- Order in the array **is** the program order (the trainer's sequencing matters). The home screen count, progress numbers, and flow all derive from this array — nothing else to update.

## Behavior (app.js)

- **Flow**: home → per-exercise screens → done. Every page change has an audio cue.
- **Tap model**: the whole screen is the tap surface; the hint line always says what a tap does — skip (rest), pause/resume (running timer), continue (rep exercise). Circular subway-style arrows bottom left/right go back / forward; ✕ opens the end-workout modal.
- **Pause** shows a full-screen overlay in the exercise's colors inverted; end-workout is an ink-black modal (red confirm), auto-pausing any running timer.
- **Audio**: all cues are synthesized (Web Audio, no files). Countdown ticks (3-2-1) and end cues are **pre-scheduled on the AudioContext clock** at timer start/resume so they land exactly on the second; pause/skip cancels them, natural completion lets them ring out. Cue vocabulary: tick = warning, single high beep = work starts, low-high = rest over, quick rising pair = page change, soft low blip = pause, triple beep = timer finished / workout done.
- **Wake lock**: acquired on first touch, re-acquired on foreground; screen never sleeps while the app is open (iOS 16.4+).
- **Viewport**: app height is driven by `--vh` set from `window.innerHeight` (listeners on resize/visualViewport/orientation + settle timers). This works around a known iOS standalone-PWA bug where CSS percentage chains and fixed shells pin to a stale small viewport. Don't replace it with `100vh`/`100dvh`/`position: fixed` shells — that's the bug it fixes.
- **Scroll**: html/body are `overflow: hidden` + `overscroll-behavior: none` (kills the iOS rubber-band); `#app` scrolls internally only if content overflows.

## Design system (styles.css)

- Type: Helvetica Neue, weight 800/900, uppercase display, tight tracking; tabular numerals for timers.
- Block colors (in `BLOCKS`): warmup `#0033e6`, legs `#e30613`, core `#ffc800` (black ink), upper `#0a0a0a`, stretch `#00764a`. Screens are full-bleed block color; `--bg`/`--fg` drive everything, so the arrows, buttons, and overlays recolor automatically.
- States: solid digits = work, translucent (35%) = rest, inverted colors = paused. (Outlined text was tried and abandoned — `-webkit-text-stroke` renders Helvetica/Inter's overlapping glyph contours badly.)
- Red appears only where it means something: Legs block, End workout.

## Common modifications

- **Change the program**: edit `workout.js` (see data model above), mirror the change in `docs/workout.md`, bump `CACHE` in `sw.js`, push.
- **Change durations**: `restBefore` per exercise; segment `seconds`; the switch lead-in is `SWITCH_SECONDS` in app.js (5s); the initial ready countdown is the `renderExercise(5)` call in the start handler.
- **Change sounds**: the `cue*` functions and `END_CUES` in app.js (frequency, duration, volume).
- **Change colors**: `BLOCKS` in workout.js (keep `ink` readable on `color`; yellow needs black ink).
- **New screen or interaction**: follow the pattern — a `render*()` function building `innerHTML`, whole-screen tap handler returning from `setupTimers`, `stopPropagation` on buttons.

## Deploy & install

- `git push` to `main` → Vercel deploys automatically. Local preview: `python3 -m http.server 8823`.
- **Always bump `CACHE` in `sw.js`** when deploying changes — installed PWAs refresh on next launch with connectivity (force-quit + reopen if it ever looks stale).
- iOS home-screen icon is captured at install time; after changing icons, delete and re-add the shortcut.
- iOS mutes Web Audio via the ring/silent switch — take the phone off silent for cues.
