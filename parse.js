// Workout markdown parser. Format spec: docs/workout-format.md.
// parseWorkout(text, id) → { id, name, blocks: {key: {name, color, ink}}, exercises: [...] }
// Throws on format errors with a message naming the offending exercise.

// Black or white ink, chosen by perceived brightness (YIQ) of the block color.
function autoInk(hex) {
  let h = hex.slice(1);
  if (h.length === 3) h = h.replace(/./g, (c) => c + c);
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return (299 * r + 587 * g + 114 * b) / 1000 >= 150 ? '#0a0a0a' : '#ffffff';
}

function parseSegments(value, where) {
  const items = value.split(',').map((s) => s.trim()).filter(Boolean);
  if (!items.length) throw new Error(`${where}: empty segments list`);
  const segs = items.map((item) => {
    const m = item.match(/^(\+)?\s*(\d+)(?:\s*·\s*(.+))?$/);
    if (!m) throw new Error(`${where}: bad segment "${item}" — expected "SECONDS" or "SECONDS · LABEL"`);
    // Leading "+": runs straight on from the previous segment, no switch countdown.
    return { seconds: parseInt(m[2], 10), label: (m[3] || '').trim(), continues: !!m[1] };
  });
  // Bare numbers: a single interval stays unlabelled, multiples become Set 1..N.
  if (segs.length > 1 && segs.every((s) => !s.label)) {
    segs.forEach((s, i) => { s.label = `Set ${i + 1}`; });
  }
  return segs;
}

function parseWorkout(text, id) {
  const wk = { id, name: id, blocks: {}, exercises: [] };
  let blockKey = null;
  let ex = null;
  let desc = [];

  const flushExercise = () => {
    if (!ex) return;
    const where = `"${ex.name}"`;
    ex.description = desc.join(' ').trim();
    if (!ex.scheme) throw new Error(`${where}: missing scheme:`);
    if (!!ex.segments === !!ex.reps) {
      throw new Error(`${where}: needs exactly one of segments: (timed) or reps: (self-paced)`);
    }
    wk.exercises.push(ex);
    ex = null;
    desc = [];
  };

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let m;

    if ((m = line.match(/^###\s+(.+)$/))) {
      flushExercise();
      if (!blockKey) throw new Error(`"${m[1].trim()}": exercise appears before any ## block`);
      ex = { block: blockKey, name: m[1].trim(), restBefore: 0 };
      continue;
    }
    if ((m = line.match(/^##\s+(.+?)\s+(#(?:[0-9a-f]{3}|[0-9a-f]{6}))\s*$/i))) {
      flushExercise();
      const name = m[1].trim();
      blockKey = name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
      wk.blocks[blockKey] = { name, color: m[2].toLowerCase(), ink: autoInk(m[2]) };
      continue;
    }
    if ((m = line.match(/^##\s/))) {
      throw new Error(`block line "${line}" — expected "## Name #hexcolor"`);
    }
    if ((m = line.match(/^#\s+(.+)$/))) {
      wk.name = m[1].trim();
      continue;
    }

    if (ex && (m = line.match(/^(scheme|reps|rest|segments|trains):\s*(.*)$/i))) {
      const key = m[1].toLowerCase();
      const value = m[2].trim();
      const where = `"${ex.name}"`;
      if (key === 'rest') {
        const n = parseInt(value, 10);
        if (Number.isNaN(n) || n < 0) throw new Error(`${where}: rest must be seconds, got "${value}"`);
        ex.restBefore = n;
      } else if (key === 'segments') {
        ex.segments = parseSegments(value, where);
      } else {
        ex[key] = value;
      }
      continue;
    }

    // Any other line inside an exercise is description prose; outside one
    // (between # and ##, or between ## and ###) it's ignored — free notes.
    if (ex) desc.push(line);
  }
  flushExercise();

  if (!wk.exercises.length) throw new Error(`${id}: no exercises found`);
  return wk;
}
