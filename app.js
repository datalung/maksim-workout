// Maksim — workout walkthrough. State machine: home → (rest → exercise)* → done.

(() => {
  const $app = document.getElementById('app');
  const TOTAL = EXERCISES.length;

  const state = {
    mode: 'home', // home | exercise | rest | done
    idx: 0,
    segIdx: 0,
    startedAt: null,
  };

  let activeTimer = null;
  let wakeLock = null;

  // ---------- audio (synthesized, no files) ----------

  let audioCtx = null;

  function ensureAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }

  function beep(freq, dur, when = 0, vol = 0.4) {
    if (!audioCtx || audioCtx.state !== 'running') return;
    const t = audioCtx.currentTime + when;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.linearRampToValueAtTime(vol, t + 0.01);
    gain.gain.setValueAtTime(vol, t + dur - 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  const cueStart = () => beep(880, 0.18);
  const cueTick = () => beep(1320, 0.08, 0, 0.3);
  const cueFinish = () => { beep(880, 0.12); beep(880, 0.12, 0.18); beep(1470, 0.4, 0.36); };
  const cueGo = () => { beep(660, 0.12); beep(880, 0.35, 0.16); };

  // ---------- wake lock ----------

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) { /* not critical */ }
  }

  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.mode !== 'home' && state.mode !== 'done') {
      requestWakeLock();
    }
  });

  // ---------- countdown engine ----------

  function makeTimer(seconds, { onSecond, onDone, onState }) {
    let remaining = seconds;
    let endsAt = null;
    let interval = null;
    let running = false;
    let lastWhole = null;

    function tick() {
      remaining = Math.max(0, (endsAt - Date.now()) / 1000);
      const whole = Math.ceil(remaining);
      if (whole !== lastWhole) {
        lastWhole = whole;
        onSecond(whole);
        if (whole >= 1 && whole <= 3) cueTick();
      }
      if (remaining <= 0) {
        clear();
        onDone();
      }
    }

    function clear() {
      running = false;
      if (interval) { clearInterval(interval); interval = null; }
    }

    return {
      start() {
        if (running || remaining <= 0) return;
        running = true;
        endsAt = Date.now() + remaining * 1000;
        interval = setInterval(tick, 100);
        onState && onState('running');
      },
      pause() {
        if (!running) return;
        remaining = Math.max(0, (endsAt - Date.now()) / 1000);
        clear();
        onState && onState('paused');
      },
      toggle() { running ? this.pause() : this.start(); },
      stop: clear,
      isRunning: () => running,
    };
  }

  function stopActiveTimer() {
    if (activeTimer) { activeTimer.stop(); activeTimer = null; }
  }

  function fmt(s) {
    const m = Math.floor(s / 60);
    const r = s % 60;
    return `${m}:${String(r).padStart(2, '0')}`;
  }

  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

  // ---------- screens ----------

  function setScene(bg, fg) {
    document.body.style.background = bg;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
    $app.style.setProperty('--bg', bg);
    $app.style.setProperty('--fg', fg);
  }

  function renderHome() {
    stopActiveTimer();
    releaseWakeLock();
    state.mode = 'home';
    setScene('#ffffff', '#0a0a0a');

    const counts = {};
    EXERCISES.forEach((e) => { counts[e.block] = (counts[e.block] || 0) + 1; });
    const rows = Object.entries(BLOCKS).map(([key, b]) => `
      <li><span class="chip" style="--chip:${b.color}"></span>${esc(b.name)}
      <span class="count">${counts[key] || 0}</span></li>`).join('');

    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">Maksim &middot; Full body</span>
          <span class="spacer"></span>
          <span class="progress">${TOTAL} exercises</span>
        </header>
        <h1 class="home-title">Work<br>out<span class="dot">.</span></h1>
        <ul class="blocks">${rows}</ul>
        <p class="home-meta">Band + 4 kg kettlebell &middot; sequence matters</p>
        <div class="push"></div>
        <button class="action" id="start">Start workout</button>
      </section>`;

    document.getElementById('start').addEventListener('click', () => {
      ensureAudio();
      state.idx = 0;
      state.startedAt = Date.now();
      requestWakeLock();
      renderExercise();
    });
  }

  function renderExercise(withRest = false) {
    stopActiveTimer();
    state.mode = 'exercise';
    state.segIdx = 0;
    const ex = EXERCISES[state.idx];
    const block = BLOCKS[ex.block];
    setScene(block.color, block.ink);

    const timed = !!ex.segments;
    const showBox = timed || withRest;
    const timerHtml = showBox ? `
      <button class="timerbox" id="timerbox" aria-label="Timer: tap to start or pause">
        <div class="seg-label" id="seglabel"></div>
        <div class="digits" id="digits"></div>
        <div class="hint" id="hint"></div>
      </button>` : '';

    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">${esc(block.name)}</span>
          <span class="spacer"></span>
          <span class="progress">${pad(state.idx + 1)}/${pad(TOTAL)}</span>
          <button class="iconbtn" id="quit" aria-label="End workout">&#10005;</button>
        </header>
        <div class="idx">${pad(state.idx + 1)}</div>
        <h1 class="title">${esc(ex.name)}</h1>
        <div class="scheme">${esc(ex.scheme)}</div>
        ${timerHtml}
        <p class="desc">${esc(ex.description)}</p>
        <p class="trains">${esc(ex.trains)}</p>
        <div class="push"></div>
        <button class="action" id="next">${state.idx + 1 < TOTAL ? 'Next' : 'Finish'}</button>
      </section>`;

    document.getElementById('quit').addEventListener('click', () => {
      if (confirm('End the workout?')) renderHome();
    });
    document.getElementById('next').addEventListener('click', () => {
      ensureAudio();
      goNext();
    });
    if (showBox) setupTimers(ex, timed, withRest);
  }

  const SWITCH_SECONDS = 5; // lead-in between sides/sets to change position

  function setupTimers(ex, timed, withRest) {
    const $label = document.getElementById('seglabel');
    const $digits = document.getElementById('digits');
    const $hint = document.getElementById('hint');
    const $box = document.getElementById('timerbox');
    let inTransition = false;
    let resting = false;

    function segLabel() {
      const seg = ex.segments[state.segIdx];
      const multi = ex.segments.length > 1;
      return seg.label || (multi ? `Part ${state.segIdx + 1}` : '');
    }

    function loadSegment(autoStart) {
      const seg = ex.segments[state.segIdx];
      inTransition = false;
      $label.textContent = segLabel();
      $digits.textContent = fmt(seg.seconds);
      $digits.classList.remove('paused');
      $hint.textContent = 'Tap to start';
      $hint.classList.add('pulse');

      activeTimer = makeTimer(seg.seconds, {
        onSecond: (s) => { $digits.textContent = fmt(s); },
        onDone: () => {
          activeTimer = null;
          cueFinish();
          if (state.segIdx + 1 < ex.segments.length) {
            state.segIdx += 1;
            startTransition();
          } else {
            $digits.textContent = fmt(0);
            $hint.textContent = 'Done — hit next';
            $hint.classList.add('pulse');
          }
        },
        onState: (s) => {
          if (s === 'running') {
            $digits.classList.remove('paused');
            $hint.textContent = 'Tap to pause';
            $hint.classList.remove('pulse');
          } else {
            $digits.classList.add('paused');
            $hint.textContent = 'Paused — tap to resume';
            $hint.classList.add('pulse');
          }
        },
      });
      if (autoStart) activeTimer.start();
    }

    // Short countdown before the next side/set so there's time to switch.
    function startTransition() {
      const seg = ex.segments[state.segIdx];
      inTransition = true;
      $label.textContent = segLabel();
      $digits.textContent = fmt(seg.seconds);
      $digits.classList.add('paused');
      $hint.textContent = `Switch — ${SWITCH_SECONDS}`;
      $hint.classList.add('pulse');

      activeTimer = makeTimer(SWITCH_SECONDS, {
        onSecond: (s) => { $hint.textContent = `Switch — ${s}`; },
        onDone: () => {
          activeTimer = null;
          cueStart();
          loadSegment(true);
        },
      });
      activeTimer.start();
    }

    // Rest runs inside the exercise screen: hollow digits, then the work timer.
    function startRest() {
      resting = true;
      $label.textContent = 'Rest';
      $digits.textContent = fmt(ex.restBefore);
      $digits.classList.add('hollow');
      $hint.textContent = 'Tap to skip';
      $hint.classList.add('pulse');

      activeTimer = makeTimer(ex.restBefore, {
        onSecond: (s) => { $digits.textContent = fmt(s); },
        onDone: () => {
          activeTimer = null;
          cueGo();
          endRest();
        },
      });
      activeTimer.start();
    }

    function endRest() {
      resting = false;
      $digits.classList.remove('hollow');
      if (timed) {
        loadSegment(true);
      } else {
        $box.style.display = 'none';
      }
    }

    $box.addEventListener('click', () => {
      ensureAudio();
      if (resting) {
        stopActiveTimer();
        endRest();
        return;
      }
      if (inTransition) {
        // Skip the lead-in and go now.
        stopActiveTimer();
        cueStart();
        loadSegment(true);
        return;
      }
      if (!activeTimer) return;
      if (!activeTimer.isRunning()) cueStart();
      activeTimer.toggle();
    });

    if (withRest) startRest();
    else loadSegment(true);
  }

  function goNext() {
    stopActiveTimer();
    if (state.idx + 1 >= TOTAL) {
      renderDone();
      return;
    }
    state.idx += 1;
    renderExercise(EXERCISES[state.idx].restBefore > 0);
  }

  function renderDone() {
    stopActiveTimer();
    releaseWakeLock();
    state.mode = 'done';
    setScene('#ffffff', '#0a0a0a');
    cueFinish();

    const mins = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">Maksim &middot; Full body</span>
          <span class="spacer"></span>
          <span class="progress">${pad(TOTAL)}/${pad(TOTAL)}</span>
        </header>
        <h1 class="done-title">Done<span style="color:#e30613">.</span></h1>
        <div class="done-stats">
          ${TOTAL} exercises<br>
          ${mins} min<br>
          Every block, every side
        </div>
        <div class="push"></div>
        <button class="action" id="home">Back to start</button>
      </section>`;

    document.getElementById('home').addEventListener('click', renderHome);
  }

  // ---------- boot ----------

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderHome();
})();
