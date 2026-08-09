// Maksim — workout walkthrough. State machine:
// picker → home → (rest → exercise)* → done.
// Workouts are markdown files in workouts/ (see docs/workout-format.md),
// listed in workouts/index.json, fetched and parsed at boot by parse.js.

(() => {
  const $app = document.getElementById('app');
  const LAST_KEY = 'workout:last';

  let WORKOUTS = []; // parsed workouts (or {id, file, error}) in index.json order
  let W = null;      // current workout
  let TOTAL = 0;     // exercise count of the current workout

  function setWorkout(w) {
    W = w;
    TOTAL = w.exercises.length;
    try { localStorage.setItem(LAST_KEY, w.id); } catch (_) { /* private mode */ }
  }

  const state = {
    mode: 'picker', // picker | home | exercise | rest | done
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
    // iOS parks the context in 'interrupted' (not 'suspended') after a
    // lock/unlock — resume from any non-running state or sounds stay dead.
    if (audioCtx.state !== 'running') audioCtx.resume();
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

  // ---------- keep awake ----------
  // Two mechanisms, belt and braces. The Screen Wake Lock API is acquired
  // on first touch, re-acquired on foreground and whenever the system
  // releases it — but iOS standalone PWAs have a history of granting the
  // lock without honoring it. So during a workout we also play an
  // invisible looping micro-video (no audio track, data in keepawake.js),
  // which is what reliably pins the screen on iOS (the NoSleep.js trick).

  let keepAwakeVideo = null;

  async function requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => {
          // The system can drop the lock on its own (lock screen, tab
          // switch); take it back as soon as we're visible again.
          if (document.visibilityState === 'visible') requestWakeLock();
        });
      }
    } catch (_) { /* not critical */ }
  }

  function ensureKeepAwakeVideo() {
    if (keepAwakeVideo) return keepAwakeVideo;
    const v = document.createElement('video');
    v.setAttribute('title', 'Keep awake');
    v.setAttribute('playsinline', '');
    v.muted = true;
    v.style.cssText =
      'position:fixed;left:0;bottom:0;width:2px;height:2px;opacity:0.01;pointer-events:none;';
    for (const [type, src] of [['webm', KEEPAWAKE_WEBM], ['mp4', KEEPAWAKE_MP4]]) {
      const s = document.createElement('source');
      s.src = src;
      s.type = `video/${type}`;
      v.appendChild(s);
    }
    v.setAttribute('loop', '');
    // Belt and braces: also re-seek near the start so playback never
    // reaches the end (looping short data-URI videos is flaky on iOS).
    v.addEventListener('timeupdate', () => {
      if (v.currentTime > 0.5) v.currentTime = Math.random() * 0.4;
    });
    document.body.appendChild(v);
    keepAwakeVideo = v;
    return v;
  }

  // Call from a user gesture (video playback needs one on iOS).
  function startKeepAwake() {
    requestWakeLock();
    ensureKeepAwakeVideo().play().catch(() => { /* wake lock still tries */ });
  }

  function stopKeepAwake() {
    if (keepAwakeVideo) keepAwakeVideo.pause();
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    requestWakeLock();
    // Back from the lock screen / background: iOS may report a stale
    // viewport height and park the audio context — refresh both, and
    // restart the keep-awake video if a workout is running.
    refreshViewport();
    if (audioCtx && audioCtx.state !== 'running') audioCtx.resume();
    if (keepAwakeVideo && state.mode === 'exercise') {
      keepAwakeVideo.play().catch(() => {});
    }
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

  // Top level: pick a workout. Each row shows the workout's block colors.
  function renderPicker() {
    stopActiveTimer();
    stopKeepAwake();
    state.mode = 'picker';
    setScene('#ffffff', '#0a0a0a');

    const rows = WORKOUTS.map((w) => w.error
      ? `<li><button class="blockrow" disabled>
          <span class="wname">${esc(w.file)} &middot; parse error</span>
        </button></li>`
      : `<li><button class="blockrow" data-id="${esc(w.id)}">
          <span class="wname">${esc(w.name)}</span>
          <span class="chipset">${Object.values(w.blocks).map((b) =>
            `<span class="chip" style="--chip:${b.color}"></span>`).join('')}</span>
        </button></li>`).join('');

    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">Maksim</span>
        </header>
        <h1 class="home-title">Work<br>outs</h1>
        <ul class="blocks">${rows}</ul>
        <div class="push"></div>
      </section>`;

    $app.querySelectorAll('.blockrow[data-id]').forEach((btn) => {
      btn.addEventListener('click', () => {
        ensureAudio();
        cuePage();
        setWorkout(WORKOUTS.find((w) => w.id === btn.dataset.id));
        renderHome();
      });
    });
  }

  function renderHome() {
    stopActiveTimer();
    stopKeepAwake();
    state.mode = 'home';
    setScene('#ffffff', '#0a0a0a');

    const rows = Object.entries(W.blocks).map(([key, b]) => `
      <li><button class="blockrow" data-block="${key}">
        <span class="chip" style="--chip:${b.color}"></span>${esc(b.name)}
      </button></li>`).join('');

    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <button class="barbtn" id="pick">&larr; Workouts</button>
          <span class="spacer"></span>
          <span class="progress">${TOTAL} exercises</span>
        </header>
        <h1 class="home-title">${esc(W.name)}</h1>
        <ul class="blocks">${rows}</ul>
        <div class="push"></div>
        <button class="action" id="start">Start workout</button>
      </section>`;

    document.getElementById('pick').addEventListener('click', () => {
      ensureAudio();
      cuePage();
      renderPicker();
    });

    document.getElementById('start').addEventListener('click', () => {
      ensureAudio();
      startKeepAwake();
      state.idx = 0;
      state.startedAt = Date.now();
      renderExercise(5, true); // short ready countdown before the first exercise
    });

    // Each block row deep-links to the first exercise of that block.
    $app.querySelectorAll('.blockrow').forEach((btn) => {
      btn.addEventListener('click', () => {
        const first = W.exercises.findIndex((ex) => ex.block === btn.dataset.block);
        if (first < 0) return;
        ensureAudio();
        startKeepAwake();
        state.idx = first;
        state.startedAt = Date.now();
        renderExercise(5, true);
      });
    });
  }

  // `ready` labels the opening countdown "Ready" (fresh start from home)
  // instead of "Rest" (mid-workout flow).
  function renderExercise(restSeconds = 0, ready = false) {
    stopActiveTimer();
    state.mode = 'exercise';
    state.segIdx = 0;
    const ex = W.exercises[state.idx];
    const block = W.blocks[ex.block];
    setScene(block.color, block.ink);

    const timed = !!ex.segments;
    const timerHtml = `
      <div class="timerbox" id="timerbox">
        <div class="seg-label" id="seglabel"></div>
        <div class="digits" id="digits"></div>
        <div class="hintrow">
          <span class="hint" id="hint"></span>
          <button class="skipbtn" id="skip">Skip</button>
        </div>
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
        ${ex.description ? `<p class="desc">${esc(ex.description)}</p>` : ''}
        ${ex.trains ? `<p class="trains">${esc(ex.trains)}</p>` : ''}
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
    const onTap = setupTimers(ex, timed, restSeconds, ready);
    $app.querySelector('.screen').addEventListener('click', () => {
      ensureAudio();
      onTap();
    });
  }

  const SWITCH_SECONDS = 5; // lead-in between sides/sets to change position

  // Runs one exercise screen: optional rest, then timed segments (auto-
  // advancing to the next exercise) or a wait for rep work. Returns the
  // tap handler for the screen.
  function setupTimers(ex, timed, restSeconds, ready) {
    const $box = document.getElementById('timerbox');
    const $label = document.getElementById('seglabel');
    const $digits = document.getElementById('digits');
    const $hint = document.getElementById('hint');
    const $skip = document.getElementById('skip');
    let phase = 'idle'; // rest | transition | work | waiting
    let switchLeft = SWITCH_SECONDS; // last shown transition countdown value

    function setHint(text, pulse) {
      $hint.textContent = text;
      $hint.classList.toggle('pulse', !!pulse);
    }

    function showSkip(show) {
      $skip.style.display = show ? '' : 'none';
    }

    function segLabel() {
      const seg = ex.segments[state.segIdx];
      const multi = ex.segments.length > 1;
      return seg.label || (multi ? `Part ${state.segIdx + 1}` : '');
    }

    // Paused = the timer box inverts, everything else stays readable.
    const onState = (s) => {
      const paused = s === 'paused';
      $box.classList.toggle('boxpaused', paused);
      if (paused) {
        setHint('Paused — tap to resume', true);
        showSkip(false);
      } else if (phase === 'rest') {
        setHint('Tap to pause', false);
        showSkip(true);
      } else if (phase === 'transition') {
        setHint(`Switch — ${switchLeft}`, true);
        showSkip(true);
      } else {
        setHint('Tap to pause', false);
        showSkip(false);
      }
    };

    function loadSegment(autoStart) {
      const seg = ex.segments[state.segIdx];
      phase = 'work';
      $label.textContent = segLabel();
      $digits.textContent = fmt(seg.seconds);
      $digits.classList.remove('paused');
      setHint('Tap to pause', false);
      showSkip(false);

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
      switchLeft = SWITCH_SECONDS;
      $label.textContent = segLabel();
      $digits.textContent = fmt(seg.seconds);
      $digits.classList.add('paused');
      setHint(`Switch — ${SWITCH_SECONDS}`, true);
      showSkip(true);

      activeTimer = makeTimer(SWITCH_SECONDS, {
        onSecond: (s) => {
          switchLeft = s;
          setHint(`Switch — ${s}`, true);
        },
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
      $label.textContent = ready ? 'Ready' : 'Rest';
      $digits.textContent = fmt(restSeconds);
      $digits.classList.add('resting');
      setHint('Tap to pause', false);
      showSkip(true);

      activeTimer = makeTimer(restSeconds, {
        onSecond: (s) => { $digits.textContent = fmt(s); },
        onDone: () => {
          activeTimer = null;
          endRest();
        },
        onState,
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
      showSkip(false);
    }

    // Skip is its own small control; a tap anywhere else pauses/resumes.
    $skip.addEventListener('click', (e) => {
      e.stopPropagation();
      ensureAudio();
      if (phase === 'rest') {
        stopActiveTimer();
        cueGo();
        endRest();
      } else if (phase === 'transition') {
        stopActiveTimer();
        cueStart();
        loadSegment(true);
      }
    });

    if (restSeconds > 0) startRest();
    else if (timed) loadSegment(true);
    else startWaiting();

    return function onTap() {
      if (phase === 'rest' || phase === 'transition' || phase === 'work') {
        if (!activeTimer) return;
        if (activeTimer.isRunning()) {
          cuePause();
          activeTimer.pause();
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

  function showQuitModal() {
    const wasRunning = activeTimer && activeTimer.isRunning();
    if (wasRunning) activeTimer.pause();
    const ov = addOverlay('quit-modal', `
      <header class="bar"><span class="eyebrow">${esc(W.name)}</span></header>
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
    renderExercise(W.exercises[state.idx].restBefore);
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
    stopKeepAwake();
    state.mode = 'done';
    setScene('#ffffff', '#0a0a0a');
    if (!alreadyCued) cueFinish();

    const mins = Math.max(1, Math.round((Date.now() - state.startedAt) / 60000));
    $app.innerHTML = `
      <section class="screen">
        <header class="bar">
          <span class="eyebrow">${esc(W.name)}</span>
          <span class="spacer"></span>
          <span class="progress">${pad(TOTAL)}/${pad(TOTAL)}</span>
        </header>
        <h1 class="done-title">Done</h1>
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
  // In home-screen mode iOS may report a stale, too-small innerHeight on
  // first load and after unlock — the screen compresses upward (footer
  // buttons float high) and the body color peeks out below overlays.

  function setViewportVar() {
    let h = window.innerHeight;
    // Truth floor: a standalone portrait PWA covers the entire screen
    // (viewport-fit=cover), so the real height is exactly screen.height —
    // iOS's screen dimensions never rotate, so only apply it in portrait.
    const standalone = navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
    if (standalone && window.matchMedia('(orientation: portrait)').matches) {
      h = Math.max(h, window.screen.height);
    }
    document.documentElement.style.setProperty('--vh', h + 'px');
  }

  // Refresh now and over the next few seconds — iOS settles on the real
  // height (and sometimes un-shifts a scrolled page) well after the
  // launch/unlock/rotation moment that triggered us.
  let settleTimers = [];
  function refreshViewport() {
    for (const t of settleTimers) clearTimeout(t);
    const fix = () => {
      window.scrollTo(0, 0); // iOS can leave the page offset after unlock
      setViewportVar();
    };
    fix();
    settleTimers = [100, 300, 600, 1000, 2000, 3000].map((ms) => setTimeout(fix, ms));
  }

  refreshViewport();
  window.addEventListener('resize', setViewportVar);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', setViewportVar);
  window.addEventListener('orientationchange', refreshViewport);
  window.addEventListener('pageshow', refreshViewport);
  window.addEventListener('focus', refreshViewport);

  // ---------- boot ----------

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  // Fetch the manifest, then every workout file, and parse. A file that
  // fails to parse becomes an {error} entry — shown disabled in the picker
  // so one broken file never bricks the app.
  async function loadWorkouts() {
    const res = await fetch('workouts/index.json');
    if (!res.ok) throw new Error(`workouts/index.json: HTTP ${res.status}`);
    const files = await res.json();
    return Promise.all(files.map(async (file) => {
      const id = file.replace(/\.md$/, '');
      try {
        const r = await fetch(`workouts/${file}`);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return parseWorkout(await r.text(), id);
      } catch (err) {
        console.warn(`workouts/${file}:`, err);
        return { id, file, error: String((err && err.message) || err) };
      }
    }));
  }

  function renderLoadError(message) {
    setScene('#ffffff', '#0a0a0a');
    $app.innerHTML = `
      <section class="screen">
        <header class="bar"><span class="eyebrow">Maksim</span></header>
        <h1 class="home-title">Can't<br>load</h1>
        <p class="desc">${esc(message)}</p>
        <div class="push"></div>
        <button class="action" id="retry">Try again</button>
      </section>`;
    document.getElementById('retry').addEventListener('click', boot);
  }

  async function boot() {
    try {
      WORKOUTS = await loadWorkouts();
    } catch (err) {
      // Browsers block fetch() on file:// pages, so the workout files can
      // never load from a double-clicked index.html — needs a server.
      renderLoadError(location.protocol === 'file:'
        ? 'Workout files can’t be fetched from a file:// page. Serve the app instead: python3 -m http.server 8823, then open http://localhost:8823.'
        : String((err && err.message) || err));
      return;
    }
    // Land on the last-used workout; the picker is one tap up from home.
    let last = null;
    try { last = localStorage.getItem(LAST_KEY); } catch (_) { /* private mode */ }
    const ok = WORKOUTS.filter((w) => !w.error);
    const w = ok.find((x) => x.id === last) || (ok.length === 1 ? ok[0] : null);
    if (w) {
      setWorkout(w);
      renderHome();
    } else {
      renderPicker();
    }
  }

  boot();
})();
