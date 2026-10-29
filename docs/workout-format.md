# Workout file format

A workout is one markdown file in the `workouts/` directory. The file is both the human-readable program and the data the app runs — there is no separate data file to keep in sync. To add a workout: write the file, add its filename to `workouts/index.json`, bump `CACHE` in `sw.js`, push.

## Structure

The markdown structure *is* the program structure:

- `# Workout Name` — the first line. Becomes the workout's home-screen title and its name in the picker.
- `## Block Name #hexcolor` — a block (section) of the workout. The hex color paints every screen in that block full-bleed. Text ink (black or white) is chosen automatically from the color's brightness — light colors like yellow get black text, everything else white.
- `### Exercise Name` — one exercise. Order in the file is the program order; the app runs top to bottom.

Under each exercise heading:

- **`key: value` lines** set the exercise's fields (see below).
- **Everything else** is the exercise description — plain prose, one or more paragraphs, shown under the timer. Two or three sentences on how to do the movement.

## Exercise fields

| Key | Required | Meaning |
|---|---|---|
| `scheme:` | yes | The bold line under the title — what to do, in your words: `2 × 15 per side`, `45 sec`, `1 × 20 · 4 kg kettlebell`. Free text, not parsed. |
| `segments:` | one of these two | Makes it a **timed exercise**. Comma-separated work intervals in seconds (see below). The app runs them automatically with a 10-second switch countdown between them (skipped for intervals marked `+`, see below), then advances. |
| `reps:` | one of these two | Makes it a **rep exercise**. Shown big in the timer slot (e.g. `2 × 15`). After the rest, the app waits — you tap the screen when done. |
| `rest:` | no | Seconds of rest shown on this exercise's screen **before** the work starts. Defaults to `0` (no rest, straight in). |
| `trains:` | no | Small-caps line under the description — what it works: `Quads, glutes, balance`. |

Every exercise must have exactly one of `segments:` or `reps:` — that's what tells the app whether it's timed or self-paced.

## Segments syntax

Comma-separated list. Each item is a number of seconds, optionally followed by ` · ` and a label:

| You write | You get |
|---|---|
| `segments: 60` | One 60-second interval, no label. |
| `segments: 45, 45` | Two 45-second intervals, auto-labelled *Set 1*, *Set 2*. |
| `segments: 30 · Left leg, 30 · Right leg` | Two intervals with your labels. |
| `segments: 30 · Set 1 · left, 30 · Set 1 · right, 30 · Set 2 · left, 30 · Set 2 · right` | Four labelled intervals — everything after the first `·` is the label, so labels may themselves contain `·`. |
| `segments: 60 · Left · Stage 1, +60 · Left · Stage 2, 60 · Right · Stage 1, +60 · Right · Stage 2` | A leading `+` runs that interval straight on from the previous one — no switch countdown, just a start beep. Use it for stages held in the same position. |

The label is shown above the countdown while that interval runs.

## Complete example

```markdown
# Maksim's Program

## Warm-up #0033e6

### Jog in place, arms circling forward
scheme: 1 minute
segments: 60
trains: Shoulders, calves, pulse up

Quick small steps on your toes. Arms stretched out to the sides,
rotating in small forward circles the whole time.

### Single-leg hops, band in front
scheme: 30 sec per leg
rest: 10
segments: 30 · Left leg, 30 · Right leg
trains: Balance, calves, shoulders

Hop in place on the toes of one foot. Hold the band stretched
between both hands in front of you at shoulder height.

## Legs #e30613

### Bulgarian split squats
scheme: 2 × 15 per side
reps: 2 × 15
rest: 45
trains: Quads, glutes, balance

Back foot up on the couch behind you, front leg does the work.
Lower until the front thigh is parallel to the floor, then drive
up through the front heel. All reps one side, then switch.
```

## Rules & tips

- Anything between the `# Name` line and the first `##` block is ignored — free space for notes to yourself.
- Blocks can be any name and any color; nothing is predefined. Reusing colors across workouts (blue warm-up, green stretch, …) is just a convention worth keeping.
- Red (`#e30613`) is used by the app for "End workout" — fine to also use for a block (Legs does today), just know it's the one color with a second meaning.
- Order matters and is the only ordering: the home screen block list, progress numbers (`3 / 21`), and flow all derive from the file top to bottom.
- The workout's identity is its filename (`maksim.md` → id `maksim`) — used to remember the last-used workout. Renaming the file resets that, nothing else.
- After any edit: bump `CACHE` in `sw.js` and push, same as always.
