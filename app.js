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

  // Beeps are scheduled at absolute AudioContext time — sample-accurate,
  // immune to JS interval jitter and first-sound wake-up latency.
  let scheduledNodes = [];

  function beepAt(freq, dur, atTime, vol = 0.4, cancellable = false) {
    if (!audioCtx) return;
    const t = Math.max(atTime, audioCtx.currentTime + 0.005);
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
    if (cancellable) {
      scheduledNodes.push(osc);
      osc.onended = () => {
        const i = scheduledNodes.indexOf(osc);
        if (i >= 0) scheduledNodes.splice(i, 1);
      };
    }
  }

  function cancelScheduledBeeps() {
    for (const osc of scheduledNodes) {
      try { osc.onended = null; osc.stop(0); } catch (_) { /* already ended */ }
    }
    scheduledNodes = [];
  }

  const beep = (freq, dur, when = 0, vol = 0.4) => {
    if (audioCtx) beepAt(freq, dur, audioCtx.currentTime + when, vol);
  };

  const cueStart = () => beep(880, 0.18);
  const cueFinish = () => { beep(880, 0.12); beep(880, 0.12, 0.18); beep(1470, 0.4, 0.36); };
  const cuePage = () => { beep(988, 0.08); beep(1319, 0.12, 0.1); }; // quick rising pair on page change
  const cueGo = () => { beep(660, 0.12); beep(880, 0.35, 0.16); }; // rest over — go
  const cuePause = () => beep(440, 0.1, 0, 0.2); // single soft low blip

  // End-of-countdown cues, pre-scheduled on the audio clock (cancellable).
  const END_CUES = {
    start: (t) => beepAt(880, 0.18, t, 0.4, true),
    go: (t) => { beepAt(660, 0.12, t, 0.4, true); beepAt(880, 0.35, t + 0.16, 0.4, true); },
    finish: (t) => { beepAt(880, 0.12, t, 0.4, true); beepAt(880, 0.12, t + 0.18, 0.4, true); beepAt(1470, 0.4, t + 0.36, 0.4, true); },
  };

  // Schedule 3-2-1 ticks and the end cue for a countdown with `remaining`
  // seconds left, exactly on the beat.
  function scheduleCountdownBeeps(remaining, endCue) {
    if (!audioCtx) return;
    const end = audioCtx.currentTime + remaining;
    for (const s of [3, 2, 1]) {
      if (remaining > s + 0.05) beepAt(1320, 0.08, end - s, 0.3, true);
    }
    if (endCue && END_CUES[endCue]) END_CUES[endCue](end);
  }

  // ---------- wake lock ----------
  // Keep the screen awake the whole time the app is open. Acquired on the
  // first touch (needs a gesture on iOS) and re-acquired whenever the app
  // returns to the foreground.

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    } catch (_) { /* not critical */ }
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') requestWakeLock();
  });

  document.addEventListener('pointerdown', () => {
    if (!wakeLock || wakeLock.released) requestWakeLock();
  });

  // ---------- countdown engine ----------

  // endCue: name from END_CUES played exactly when the countdown hits zero.
  // Ticks and end cue are pre-scheduled on the audio clock at start/resume
  // so they land on the second, and cancelled on pause/stop.
  function makeTimer(seconds, { onSecond, onDone, onState }, endCue = null) {
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
      }
      if (remaining <= 0) {
        clear(false); // natural end: let the scheduled end cue ring out
        onDone();
      }
    }

    function clear(cancelBeeps = true) {
      running = false;
      if (cancelBeeps) cancelScheduledBeeps();
      if (interval) { clearInterval(interval); interval = null; }
    }

    return {
      start() {
        if (running || remaining <= 0) return;
        running = true;
        endsAt = Date.now() + remaining * 1000;
        scheduleCountdownBeeps(remaining, endCue);
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

  // Bold geometric arrow, MTA-style: straight stem, miter-joined head.
  const arrowSvg = (back) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="3" aria-hidden="true"><path d="${back
      ? 'M20.5 12H5M11.5 4.5 4 12l7.5 7.5'
      : 'M3.5 12H19M12.5 4.5 20 12l-7.5 7.5'}"/></svg>`;

  // ---------- screens ----------

  function setScene(bg, fg) {
    document.body.style.background = bg;
    document.querySelector('meta[name="theme-color"]').setAttribute('content', bg);
    $app.style.setProperty('--bg', bg);
    $app.style.setProperty('--fg', fg);
  }

  function renderHome() {
    stopActiveTimer();
    state.mode = 'home';
    setScene('#ffffff', '#0a0a0a');

    const rows = Object.values(BLOCKS).map((b) => `
      <li><span class="chip" style="--chip:${b.color}"></span>${esc(b.name)}</li>`).join('');

    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">Maksim &middot; Full body</span>
          <span class="spacer"></span>
          <span class="progress">${TOTAL} exercises</span>
        </header>
        <h1 class="home-title">Work<br>out</h1>
        <ul class="blocks">${rows}</ul>
        <div class="push"></div>
        <button class="action" id="start">Start workout</button>
      </section>`;

    document.getElementById('start').addEventListener('click', () => {
      ensureAudio();
      state.idx = 0;
      state.startedAt = Date.now();
      renderExercise(5); // short ready countdown before the first exercise
    });
  }

  function renderExercise(restSeconds = 0) {
    stopActiveTimer();
    state.mode = 'exercise';
    state.segIdx = 0;
    const ex = EXERCISES[state.idx];
    const block = BLOCKS[ex.block];
    setScene(block.color, block.ink);

    const timed = !!ex.segments;
    const timerHtml = `
      <div class="timerbox" id="timerbox">
        <div class="seg-label" id="seglabel"></div>
        <div class="digits" id="digits"></div>
        <div class="hint" id="hint"></div>
      </div>`;

    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">${esc(block.name)}</span>
          <span class="spacer"></span>
          <span class="progress">${pad(state.idx + 1)}/${pad(TOTAL)}</span>
          <button class="iconbtn" id="quit" aria-label="End workout">&#10005;</button>
        </header>
        <h1 class="title">${esc(ex.name)}</h1>
        <div class="scheme">${esc(ex.scheme)}</div>
        ${timerHtml}
        <p class="desc">${esc(ex.description)}</p>
        <p class="trains">${esc(ex.trains)}</p>
        <div class="push"></div>
        <div class="footrow">
          ${state.idx > 0
            ? `<button class="backbtn" id="back" aria-label="Previous exercise">${arrowSvg(true)}</button>`
            : '<span></span>'}
          <button class="nextbtn" id="next" aria-label="Next exercise">${arrowSvg(false)}</button>
        </div>
      </section>`;

    document.getElementById('quit').addEventListener('click', (e) => {
      e.stopPropagation();
      showQuitModal();
    });
    document.getElementById('next').addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAudio();
      goNext();
    });
    const $back = document.getElementById('back');
    if ($back) {
      $back.addEventListener('click', (e) => {
        e.stopPropagation();
        ensureAudio();
        goBack();
      });
    }

    // Whole screen is the tap surface; the hint line says what a tap does.
    const onTap = setupTimers(ex, timed, restSeconds);
    $app.querySelector('.screen').addEventListener('click', () => {
      ensureAudio();
      onTap();
    });
  }

  const SWITCH_SECONDS = 5; // lead-in between sides/sets to change position

  // Runs one exercise screen: optional rest, then timed segments (auto-
  // advancing to the next exercise) or a wait for rep work. Returns the
  // tap handler for the screen.
  function setupTimers(ex, timed, restSeconds) {
    const $label = document.getElementById('seglabel');
    const $digits = document.getElementById('digits');
    const $hint = document.getElementById('hint');
    let phase = 'idle'; // rest | transition | work | waiting

    function setHint(text, pulse) {
      $hint.textContent = text;
      $hint.classList.toggle('pulse', !!pulse);
    }

    function segLabel() {
      const seg = ex.segments[state.segIdx];
      const multi = ex.segments.length > 1;
      return seg.label || (multi ? `Part ${state.segIdx + 1}` : '');
    }

    const onState = (s) => {
      if (s === 'running') {
        $digits.classList.remove('paused');
        if (phase === 'work') setHint('Tap to pause', false);
      } else {
        $digits.classList.add('paused');
        setHint('Paused — tap to resume', true);
      }
    };

    function loadSegment(autoStart) {
      const seg = ex.segments[state.segIdx];
      phase = 'work';
      $label.textContent = segLabel();
      $digits.textContent = fmt(seg.seconds);
      $digits.classList.remove('paused');
      setHint('Tap to pause', false);

      activeTimer = makeTimer(seg.seconds, {
        onSecond: (s) => { $digits.textContent = fmt(s); },
        onDone: () => {
          activeTimer = null;
          if (state.segIdx + 1 < ex.segments.length) {
            state.segIdx += 1;
            startTransition();
          } else {
            goNext(true); // the scheduled finish fanfare is the page cue
          }
        },
        onState,
      }, 'finish');
      if (autoStart) activeTimer.start();
    }

    // Short countdown before the next side/set so there's time to switch.
    function startTransition() {
      const seg = ex.segments[state.segIdx];
      phase = 'transition';
      $label.textContent = segLabel();
      $digits.textContent = fmt(seg.seconds);
      $digits.classList.add('paused');
      setHint(`Switch — ${SWITCH_SECONDS}`, true);

      activeTimer = makeTimer(SWITCH_SECONDS, {
        onSecond: (s) => { setHint(`Switch — ${s}`, true); },
        onDone: () => {
          activeTimer = null;
          loadSegment(true);
        },
        onState,
      }, 'start');
      activeTimer.start();
    }

    // Rest runs inside the exercise screen: faded digits, then the work.
    function startRest() {
      phase = 'rest';
      $label.textContent = state.idx === 0 ? 'Ready' : 'Rest';
      $digits.textContent = fmt(restSeconds);
      $digits.classList.add('resting');
      setHint('Tap to skip', true);

      activeTimer = makeTimer(restSeconds, {
        onSecond: (s) => { $digits.textContent = fmt(s); },
        onDone: () => {
          activeTimer = null;
          endRest();
        },
      }, 'go');
      activeTimer.start();
    }

    function endRest() {
      $digits.classList.remove('resting');
      if (timed) loadSegment(true);
      else startWaiting();
    }

    // Rep-based work: no clock — the reps take the timer slot instead.
    function startWaiting() {
      phase = 'waiting';
      $label.textContent = 'Your pace';
      if (ex.reps) {
        $digits.textContent = ex.reps;
        $digits.classList.add('reps');
      } else {
        $digits.style.display = 'none';
      }
      setHint('Tap anywhere when done', true);
    }

    if (restSeconds > 0) startRest();
    else if (timed) loadSegment(true);
    else startWaiting();

    return function onTap() {
      if (phase === 'rest') {
        stopActiveTimer();
        cueGo();
        endRest();
      } else if (phase === 'transition') {
        stopActiveTimer();
        cueStart();
        loadSegment(true);
      } else if (phase === 'work') {
        if (!activeTimer) return;
        if (activeTimer.isRunning()) {
          cuePause();
          activeTimer.pause();
          showPauseOverlay();
        } else {
          cueStart();
          activeTimer.start();
        }
      } else if (phase === 'waiting') {
        goNext();
      }
    };
  }

  // ---------- overlays ----------

  function addOverlay(className, html) {
    const ov = document.createElement('div');
    ov.className = `overlay ${className}`;
    ov.innerHTML = html;
    $app.querySelector('.screen').appendChild(ov);
    return ov;
  }

  // Bold full-screen pause state: the exercise colors, inverted.
  function showPauseOverlay() {
    const ex = EXERCISES[state.idx];
    const block = BLOCKS[ex.block];
    const remaining = document.getElementById('digits')?.textContent || '';
    const ov = addOverlay('pause-overlay', `
      <header class="bar">
        <span class="eyebrow">${esc(block.name)}</span>
        <span class="spacer"></span>
        <span class="progress">${pad(state.idx + 1)}/${pad(TOTAL)}</span>
      </header>
      <h2 class="overlay-mega">Paused</h2>
      <div class="digits">${remaining}</div>
      <div class="push"></div>
      <div class="hint pulse">Tap to resume</div>`);
    ov.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAudio();
      ov.remove();
      cueStart();
      if (activeTimer) activeTimer.start();
    });
  }

  function showQuitModal() {
    const wasRunning = activeTimer && activeTimer.isRunning();
    if (wasRunning) activeTimer.pause();
    const ov = addOverlay('quit-modal', `
      <header class="bar"><span class="eyebrow">Maksim</span></header>
      <h2 class="overlay-mega">End the<br>workout?</h2>
      <div class="push"></div>
      <button class="action danger" id="m-end">End workout</button>
      <button class="action light" id="m-stay">Keep going</button>`);
    ov.addEventListener('click', (e) => e.stopPropagation());
    ov.querySelector('#m-end').addEventListener('click', () => {
      cuePage();
      renderHome();
    });
    ov.querySelector('#m-stay').addEventListener('click', () => {
      ov.remove();
      if (wasRunning && activeTimer) activeTimer.start();
    });
  }

  // Every page change gets audio feedback; pass alreadyCued when the
  // trigger played its own cue (e.g. the timer-end fanfare).
  function goNext(alreadyCued = false) {
    stopActiveTimer();
    if (state.idx + 1 >= TOTAL) {
      renderDone(alreadyCued);
      return;
    }
    if (!alreadyCued) cuePage();
    state.idx += 1;
    renderExercise(EXERCISES[state.idx].restBefore);
  }

  function goBack() {
    if (state.idx === 0) return;
    stopActiveTimer();
    cuePage();
    state.idx -= 1;
    renderExercise(0); // straight back in, no rest replay
  }

  function renderDone(alreadyCued = false) {
    stopActiveTimer();
    state.mode = 'done';
    setScene('#ffffff', '#0a0a0a');
    if (!alreadyCued) cueFinish();

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

  // ---------- viewport height (iOS standalone workaround) ----------
  // In home-screen mode iOS may report a stale small viewport to CSS on
  // first load; window.innerHeight + resize listeners track the truth.

  function setViewportVar() {
    document.documentElement.style.setProperty('--vh', window.innerHeight + 'px');
  }
  setViewportVar();
  window.addEventListener('resize', setViewportVar);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', setViewportVar);
  window.addEventListener('orientationchange', () => setTimeout(setViewportVar, 250));
  setTimeout(setViewportVar, 300);  // catch the post-launch settle
  setTimeout(setViewportVar, 1000);

  // ---------- boot ----------

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  renderHome();
})();
