# Maksim Workout

A vanilla-JS PWA that runs workouts defined as markdown files. No build step, no dependencies.

## Key docs — read these first

- **`docs/workout-format.md`** — how workouts are defined. Each workout is one markdown file in `workouts/` (headings are the program structure, `key: value` lines are the exercise fields). Read this before creating or editing any workout file.
- **`docs/app.md`** — app architecture and modification guide.

## Workout changes

When adding a workout: write the `.md` file in `workouts/`, add its filename to `workouts/index.json`. After any change to workouts or app files: bump `CACHE` in `sw.js` so the service worker picks it up.
