# App documentation

Current state of the workout app: what's in it, how it works, and how to change it safely. Last updated: August 2026.

## What it is

A static, dependency-free web app (plain HTML/CSS/JS, no framework, no build step) that walks through workout programs, one exercise per screen, with automatic timers, rest countdowns, and audio cues. Workouts are markdown files in `workouts/` — the app fetches and parses them at boot. Hosted on Vercel as a static site; installed on iPhone as a home-screen PWA.

## Files

| File | Role |
|---|---|
| `index.html` | Shell: meta tags (iOS PWA), loads everything. No markup of its own — screens are rendered by JS. |
| `workouts/*.md` | **The programs.** One markdown file per workout — both the human-readable doc and the data the app runs. Format: `docs/workout-format.md`. |
| `workouts/index.json` | Manifest: array of workout filenames, in picker order. A workout must be listed here to exist. |
| `parse.js` | `parseWorkout(md, id)` — turns a workout markdown file into `{id, name, blocks, exercises}`. Throws with a message naming the offending exercise on format errors. Computes each block's ink (black/white) from its color's brightness (YIQ). |
| `app.js` | All behavior: workout loading, screen rendering, state machine, timers, audio, wake lock, viewport workaround. |
| `styles.css` | The design system. Swiss/International style: Helvetica Neue, hard grid, full-bleed block colors. |
| `keepawake.js` | Data URIs for the keep-awake micro-video (from NoSleep.js, MIT). No logic. |
| `sw.js` | Service worker: network-first fetch with cache fallback (fresh online, works offline). Precaches core assets plus every workout listed in `workouts/index.json`. **Bump `CACHE` on every change you deploy.** |
| `manifest.webmanifest` | PWA manifest (name, icons, standalone display). |
| `icons/` | App icons: black dumbbell on yellow (`#ffc800`). Generated as flat geometry; favicon.svg matches. |
| `docs/instructions.txt` | The trainer's original notes, untouched. |
| `docs/workout-format.md` | **The workout file format** — read this before writing or editing a workout. |

## Data model

The authoring format is documented in `docs/workout-format.md`. Parsed shape (what `app.js` consumes, per workout):

```js
{
  id: 'maksim',             // filename without .md — the last-used localStorage key
  name: 'Full body',        // from the file's # heading: home-screen title, picker row
  blocks: {                 // from ## headings, in file order; key = slugged name
    'warm-up': { name: 'Warm-up', color: '#0033e6', ink: '#ffffff' },
  },
  exercises: [{
    block: 'warm-up',       // key into blocks — sets screen colors and eyebrow
    name: 'Side planks',    // screen title (poster type)
    scheme: '2 × 30 sec per side', // bold line under the title
    reps: '2 × 15',         // rep exercises only: shown big in the timer slot
    restBefore: 30,         // from rest:; 0 when omitted
    segments: [             // timed exercises only
      { label: 'Set 1 · left', seconds: 30 },
      // segments auto-chain with a 10s "switch" countdown between them,
      // except continues: true (leading "+" in the file) — straight on
    ],
    description: '…',       // the prose paragraphs, joined
    trains: 'Obliques, …',  // small caps line under the description (optional)
  }],
}
```

Rules:
- **Timed exercise** = has `segments`. It runs itself: rest → each segment auto-starts → auto-advances to the next exercise.
- **Rep exercise** = no `segments`, has `reps`. After rest it waits ("Your pace — tap anywhere when done"); a tap advances.
- Order in the file **is** the program order (the trainer's sequencing matters). The home screen block list, exercise count, progress numbers, and flow all derive from it — nothing else to update.

## Behavior (app.js)

- **Loading**: boot fetches `workouts/index.json`, then every listed file, parsing each with `parse.js`. A file that fails to parse shows as a disabled "parse error" row in the picker (one broken file never bricks the app); if the manifest itself won't load, an error screen with a retry button appears.
- **Landing**: the app opens on the last-used workout's home screen (`workout:last` in localStorage; the sole workout counts as last-used when nothing is stored). "← Workouts" in the home bar goes up to the picker; picker rows show each workout's block colors as an overlapping chip cluster.
- **Flow**: picker → home → per-exercise screens → done. Every page change has an audio cue. Home block rows deep-link to the first exercise of that block (with the 5s ready countdown).
- **Tap model**: the whole screen is the tap surface — a tap pauses/resumes any running countdown (rest, switch, or work) and advances rep exercises. Skipping a rest/switch countdown is the small outlined "Skip" button in the timer box (hidden during work, waiting, and pause). Circular subway-style arrows bottom left/right go back / forward; ✕ opens the end-workout modal.
- **Pause** inverts only the timer box (full-bleed band in the exercise's colors, inverted) so the description and trains lines stay readable; end-workout is an ink-black modal (red confirm), auto-pausing any running timer.
- **Audio**: all cues are synthesized (Web Audio, no files). Countdown ticks (3-2-1) and end cues are **pre-scheduled on the AudioContext clock** at timer start/resume so they land exactly on the second; pause/skip cancels them, natural completion lets them ring out. Cue vocabulary: tick = warning, single high beep = work starts, low-high = rest over, quick rising pair = page change, soft low blip = pause, triple beep = timer finished / workout done.
- **Keep awake**: two mechanisms. The Screen Wake Lock API is acquired on first touch and re-acquired on foreground and on system release — but iOS standalone PWAs don't always honor it. So during a workout an invisible looping micro-video with no audio track (`keepawake.js`, data URIs from NoSleep.js, MIT) also plays; started on the Start/deep-link tap (needs a gesture), paused on home/done, restarted on foreground.
- **Foreground recovery** (single `visibilitychange` handler): re-request wake lock, refresh `--vh` (stale after unlock → misplaced footer), resume the AudioContext if not `running` (iOS parks it in `interrupted` after a lock, which is why sounds used to die), restart the keep-awake video mid-workout.
- **No flash on launch**: iOS shows a white launch screen for PWAs, so the whole boot chain stays white — inline `html{background:#fff}` in index.html, white body default in styles.css, white initial theme-color. `setScene` recolors everything once a screen renders. Don't reintroduce a dark pre-render default.
- **Viewport**: app height is driven by `--vh` set from `window.innerHeight`. This works around a known iOS standalone-PWA bug where a stale, too-small height gets reported on first load and after unlock (symptom: footer buttons float high, body color peeks below overlays). Two defenses in `setViewportVar`/`refreshViewport`: a truth floor (standalone portrait covers the whole screen, so `--vh` is clamped to at least `screen.height` — iOS screen dims never rotate, hence the portrait check) and a settle cascade (re-read + `scrollTo(0,0)` at 0/100/300/600/1000/2000/3000ms) run on load, foreground, pageshow, focus, and orientation change. Don't replace with `100vh`/`100dvh`/`position: fixed` shells — that's the bug this fixes.
- **Scroll**: html/body are `overflow: hidden` + `overscroll-behavior: none` (kills the iOS rubber-band); `#app` scrolls internally only if content overflows.

## Design system (styles.css)

- Type: Helvetica Neue, weight 800/900, uppercase display, tight tracking; tabular numerals for timers.
- Block colors come from each workout file's `##` headings; the conventional palette is warm-up `#0033e6`, legs `#e30613`, core `#ffc800` (black ink), upper `#0a0a0a`, stretch `#00764a`. Screens are full-bleed block color; `--bg`/`--fg` drive everything, so the arrows, buttons, and overlays recolor automatically.
- States: solid digits = work, translucent (35%) = rest, inverted timer box = paused. (Outlined text was tried and abandoned — `-webkit-text-stroke` renders Helvetica/Inter's overlapping glyph contours badly.)
- Buttons: full-width actions are 56px pills (radius 28px) — same vertical size as the back/next circles.
- Red appears only where it means something: Legs block, End workout.

## Common modifications

- **Change a program**: edit its file in `workouts/` (format: `docs/workout-format.md`), bump `CACHE` in `sw.js`, push. No other file needs touching.
- **Add a workout**: create `workouts/<id>.md`, add `"<id>.md"` to `workouts/index.json`, bump `CACHE`, push. The picker, offline caching, and landing logic pick it up automatically.
- **Change durations**: `rest:` per exercise; segment seconds; the switch lead-in is `SWITCH_SECONDS` in app.js (10s); the initial ready countdown is the `renderExercise(5)` call in the start handler.
- **Change sounds**: the `cue*` functions and `END_CUES` in app.js (frequency, duration, volume).
- **Change colors**: the `##` heading hex in the workout file — ink (black/white text) follows automatically from brightness.
- **New screen or interaction**: follow the pattern — a `render*()` function building `innerHTML`, whole-screen tap handler returning from `setupTimers`, `stopPropagation` on buttons.

## Deploy & install

- `git push` to `main` → Vercel deploys automatically. Local preview: `python3 -m http.server 8823`.
- **Always bump `CACHE` in `sw.js`** when deploying changes — installed PWAs refresh on next launch with connectivity (force-quit + reopen if it ever looks stale).
- iOS home-screen icon is captured at install time; after changing icons, delete and re-add the shortcut.
- iOS mutes Web Audio via the ring/silent switch — take the phone off silent for cues.
