import { PanoViewer, angularDistance } from './viewer.js';
import { paintPlaceholder } from './placeholder.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const isTouch = matchMedia('(pointer: coarse)').matches;

const ui = {
  stage: $('#stage'), topbar: $('#topbar'), banner: $('#banner'), card: $('#card'), restoreCard: $('#btn-restore-card'),
  home: $('#home'), results: $('#results'), resultsInner: $('#results-inner'), loading: $('#loading'), toast: $('#toast'),
  sceneTitle: $('#scene-title'), progress: $('#progress-fill'), stepCount: $('#step-count'), moduleList: $('#module-list'),
  name: $('#learner-name'), author: $('#author'),
  btnExit: $('#btn-exit'), btnGyro: $('#btn-gyro'), btnFs: $('#btn-fullscreen'), btnVideo: $('#btn-video'),
};

let viewer;
try {
  viewer = new PanoViewer(ui.stage);
} catch (err) {
  document.body.innerHTML = `<p style="padding:2rem">Sorry — this device or browser can't display 360° content (${esc(err.message)}).</p>`;
  throw err;
}

// ---------------------------------------------------------------- scenes

let currentSceneId = null;
let currentScenario = null;

async function mediaFor(scene) {
  const m = scene.media;
  if (m.type === 'placeholder') return { type: 'canvas', canvas: paintPlaceholder(m, viewer.maxTextureSize) };
  if (m.type === 'splat') throw new Error('Gaussian splat scenes are not supported yet — see README "Roadmap".');
  return m;
}

async function showScene(id, { force = false } = {}) {
  if (id === currentSceneId && !force) return;
  const scene = currentScenario.scenes[id];
  if (!scene) throw new Error(`Unknown scene "${id}"`);
  ui.loading.hidden = false;
  try {
    await viewer.load(await mediaFor(scene));
  } catch (err) {
    toast(`Couldn't load this scene: ${err.message}`, 'bad', 5000);
  } finally {
    ui.loading.hidden = true;
  }
  currentSceneId = id;
  viewer.setView({ yaw: 0, pitch: 0, fov: 75, ...(scene.initialView || {}) });
  ui.sceneTitle.textContent = scene.title || '';
  ui.btnVideo.hidden = scene.media.type !== 'video';
  preloadNext();
}

function preloadNext() {
  // Warm the browser cache for the next image-based scene so transitions feel instant.
  const next = currentScenario?.steps.slice(run?.index ?? 0).map((s) => currentScenario.scenes[s.scene]).find((s) => s && s.media.type === 'image' && s !== currentScenario.scenes[currentSceneId]);
  if (next) { const img = new Image(); img.src = next.media.src; }
}

// ---------------------------------------------------------------- UI helpers

let toastTimer;
function toast(msg, kind = '', ms = 1800) {
  ui.toast.textContent = msg;
  ui.toast.className = `toast ${kind}`;
  ui.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (ui.toast.hidden = true), ms);
}

function showBanner(html) {
  ui.banner.innerHTML = html;
  ui.banner.hidden = false;
  document.body.classList.add('has-banner');
}
function hideBanner() {
  ui.banner.hidden = true;
  ui.banner.innerHTML = '';
  document.body.classList.remove('has-banner');
}

function showCard(html, { collapsible = false } = {}) {
  ui.card.innerHTML = html;
  ui.card.hidden = false;
  ui.restoreCard.hidden = true;
  if (collapsible) {
    const btn = document.createElement('button');
    btn.className = 'btn secondary small';
    btn.textContent = '👁 Look around';
    btn.onclick = () => { ui.card.hidden = true; ui.restoreCard.hidden = false; };
    ui.card.querySelector('.card-tools')?.append(btn);
  }
  ui.card.scrollTop = 0;
}
function hideCard() { ui.card.hidden = true; ui.restoreCard.hidden = true; }
ui.restoreCard.onclick = () => { ui.card.hidden = false; ui.restoreCard.hidden = true; };

function ringMarker({ yaw, pitch }, label, reveal = false) {
  const el = document.createElement('div');
  el.className = `ring${reveal ? ' reveal' : ''}`;
  if (label) el.innerHTML = `<span class="ring-label">${esc(label)}</span>`;
  return viewer.addMarker({ yaw, pitch, el });
}

function missMarker(x, y) {
  const el = document.createElement('div');
  el.className = 'miss';
  el.textContent = '✕';
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  viewer.overlay.append(el);
  setTimeout(() => el.remove(), 900);
}

// ---------------------------------------------------------------- scenario runner

let run = null; // { scenario, index, results[], startedAt, name, cleanup }

// Single-file builds (see tools/bundle.mjs) embed the JSON files instead of fetching them.
const EMBEDDED = window.HQSCALE_EMBED || {};
async function fetchJson(url) {
  if (EMBEDDED[url]) return structuredClone(EMBEDDED[url]);
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Could not load ${url} (${res.status})`);
  return res.json();
}

async function loadScenario(url) {
  const s = await fetchJson(url);
  validateScenario(s);
  return s;
}

function validateScenario(s) {
  const problems = [];
  if (!s.scenes || !s.steps) problems.push('scenario needs "scenes" and "steps"');
  (s.steps || []).forEach((st, i) => {
    if (!s.scenes?.[st.scene]) problems.push(`step ${i + 1}: unknown scene "${st.scene}"`);
    if (st.type === 'quiz' && !(st.answer >= 0 && st.answer < (st.options || []).length)) problems.push(`step ${i + 1}: quiz "answer" must be an option index`);
    if (st.type === 'find' && !st.targets?.length) problems.push(`step ${i + 1}: find step needs "targets"`);
  });
  if (problems.length) throw new Error(`Scenario has problems:\n• ${problems.join('\n• ')}`);
}

async function startScenario(scenario) {
  currentScenario = scenario;
  currentSceneId = null;
  run = { scenario, index: 0, results: [], startedAt: Date.now(), name: ui.name.value.trim(), cleanup: null };
  try { localStorage.setItem('hqscale.name', run.name); } catch {}
  ui.home.hidden = true;
  ui.results.hidden = true;
  ui.topbar.hidden = false;
  await goToStep(0);
}

async function goToStep(i) {
  run.cleanup?.();
  run.cleanup = null;
  viewer.clearMarkers();
  hideBanner();
  hideCard();
  const steps = run.scenario.steps;
  if (i >= steps.length) return finish();
  run.index = i;
  const step = steps[i];
  ui.progress.style.width = `${(i / steps.length) * 100}%`;
  ui.stepCount.textContent = `${i + 1} / ${steps.length}`;
  await showScene(step.scene);
  const handler = STEP_TYPES[step.type];
  if (!handler) { toast(`Unknown step type "${step.type}" — skipping`, 'bad'); return goToStep(i + 1); }
  handler(step, (result) => {
    if (result) run.results.push({ step: i, type: step.type, title: step.title || step.question || step.prompt, ...result });
  });
}

const next = () => goToStep(run.index + 1);
const continueBtn = (label = 'Continue') => `<button class="btn" data-action="next">${label} →</button>`;
ui.card.addEventListener('click', (e) => { if (e.target.closest('[data-action="next"]')) next(); });
ui.banner.addEventListener('click', (e) => { if (e.target.closest('[data-action="next"]')) next(); });

const STEP_TYPES = {
  // Plain message over the 360 view.
  info(step) {
    showCard(`
      <div class="kicker">${esc(currentScenario.scenes[step.scene].title)}</div>
      <h2>${esc(step.title)}</h2>
      <p>${esc(step.body)}</p>
      <div class="card-actions"><span class="card-tools"></span>${continueBtn(run.index === run.scenario.steps.length - 1 ? 'See results' : 'Continue')}</div>`,
    { collapsible: true });
  },

  // Look around and tap on one or more things.
  find(step, record) {
    const targets = step.targets;
    const maxMisses = step.maxAttempts ?? 3;
    const found = new Set();
    let misses = 0, done = false;

    const render = () => {
      const multi = targets.length > 1;
      showBanner(`
        <div class="b-title">${esc(step.title || 'Find it')}</div>
        <div>${esc(step.prompt)}</div>
        <div class="b-row">
          <span class="b-meta">${multi ? `Found ${found.size} / ${targets.length} · ` : ''}${maxMisses - misses} ${maxMisses - misses === 1 ? 'try' : 'tries'} left</span>
          <button class="btn secondary small" data-giveup>I can't find it</button>
        </div>
        ${misses > 0 && step.hint ? `<div class="hint">💡 ${esc(step.hint)}</div>` : ''}`);
      ui.banner.querySelector('[data-giveup]').onclick = () => complete(false);
    };

    const complete = (success) => {
      if (done) return;
      done = true;
      unsub();
      const missed = targets.filter((_, i) => !found.has(i));
      missed.forEach((t) => ringMarker(t, t.label, true));
      if (missed.length) viewer.lookAt(missed[0]);
      hideBanner();
      record({ correct: success, detail: `${found.size}/${targets.length} found, ${misses} wrong tap${misses === 1 ? "" : "s"}` });
      showCard(`
        <h2 class="${success ? 'result-good' : 'result-bad'}">${success ? '✓ Well spotted!' : missed.length === targets.length ? 'Here it is' : 'You missed some'}</h2>
        ${step.explain ? `<p>${esc(step.explain)}</p>` : ''}
        <div class="card-actions"><span class="card-tools"></span>${continueBtn()}</div>`, { collapsible: true });
    };

    const unsub = viewer.onTap((tap) => {
      if (done) return;
      const hit = targets.findIndex((t) => angularDistance(tap, t) <= (t.radius ?? 8));
      if (hit >= 0 && found.has(hit)) { toast('Already found — keep looking'); return; }
      if (hit >= 0) {
        found.add(hit);
        ringMarker(targets[hit], targets[hit].label);
        if (found.size === targets.length) return complete(true);
        toast(`✓ ${targets[hit].label || 'Found one'}`, 'good');
        return render();
      }
      misses++;
      missMarker(tap.x, tap.y);
      if (misses >= maxMisses) return complete(false);
      toast('Not quite — try again', 'bad');
      render();
    });
    run.cleanup = unsub;
    render();
  },

  // Multiple-choice question with the 360 scene behind it.
  quiz(step, record) {
    const order = step.options.map((_, i) => i);
    if (step.shuffle) order.sort(() => Math.random() - 0.5);
    (step.markers || []).forEach((m) => ringMarker(m, m.label));
    showCard(`
      <div class="kicker">Question</div>
      <h2>${esc(step.question)}</h2>
      <div class="options">${order.map((oi, pos) => `
        <button class="option" data-opt="${oi}"><span class="letter">${'ABCDEFGH'[pos]}</span><span>${esc(step.options[oi])}</span></button>`).join('')}
      </div>
      <div class="feedback"></div>
      <div class="card-actions"><span class="card-tools"></span></div>`, { collapsible: true });

    ui.card.querySelectorAll('.option').forEach((btn) => {
      btn.onclick = () => {
        const chosen = Number(btn.dataset.opt);
        const correct = chosen === step.answer;
        ui.card.querySelectorAll('.option').forEach((b) => {
          b.disabled = true;
          if (Number(b.dataset.opt) === step.answer) b.classList.add('correct');
        });
        if (!correct) btn.classList.add('wrong');
        record({ correct, detail: `Answered: ${step.options[chosen]}` });
        ui.card.querySelector('.feedback').innerHTML = `
          <p><strong class="${correct ? 'result-good' : 'result-bad'}">${correct ? '✓ Correct.' : '✕ Not quite.'}</strong> ${esc(step.explain || '')}</p>`;
        ui.card.querySelector('.card-actions').insertAdjacentHTML('beforeend', continueBtn());
        ui.card.querySelector('[data-action="next"]').focus({ preventScroll: true });
      };
    });
  },

  // Hotspots to open and learn from (hazards, "how to check" checklists). Not scored.
  explore(step, record) {
    const viewed = new Set();
    const total = step.hotspots.length;
    const needed = step.requireAll === false ? 0 : total;
    const icons = { hazard: '⚠', check: '✓', info: 'i' };

    const render = () => showBanner(`
      <div class="b-title">${esc(step.title || 'Explore')}</div>
      <div>${esc(step.prompt || 'Tap the markers to learn more.')}</div>
      <div class="b-row"><span class="b-meta">Viewed ${viewed.size} / ${total}</span>
        ${viewed.size >= needed ? continueBtn() : ''}</div>`);

    step.hotspots.forEach((h, i) => {
      const el = document.createElement('button');
      el.className = `hotspot ${h.icon || 'hazard'}`;
      el.setAttribute('aria-label', h.title);
      el.innerHTML = `<span class="dot">${icons[h.icon] || '⚠'}</span>`;
      el.onclick = () => {
        viewed.add(i);
        el.classList.add('viewed');
        render();
        showCard(`
          <div class="kicker">${h.icon === 'check' ? 'Safety check' : 'Hazard'}${h.risk ? `<span class="risk ${esc(h.risk)}">${esc(h.risk.toUpperCase())}</span>` : ''}</div>
          <h2>${esc(h.title)}</h2>
          <p>${esc(h.body || '')}</p>
          ${h.checklist?.length ? `<strong>How to check</strong><ul class="checklist">${h.checklist.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>` : ''}
          <div class="card-actions"><button class="btn secondary" data-close>Close</button></div>`);
        ui.card.querySelector('[data-close]').onclick = hideCard;
      };
      viewer.addMarker({ yaw: h.yaw, pitch: h.pitch, el });
    });
    record(null);
    render();
  },
};

// ---------------------------------------------------------------- results

function finish() {
  run.cleanup?.();
  viewer.clearMarkers();
  hideBanner();
  hideCard();
  ui.topbar.hidden = true;
  const s = run.scenario;
  const scored = run.results.filter((r) => typeof r.correct === 'boolean');
  const correct = scored.filter((r) => r.correct).length;
  const pct = scored.length ? Math.round((correct / scored.length) * 100) : 100;
  const pass = pct / 100 >= (s.passMark ?? 0.8);
  const mins = Math.max(1, Math.round((Date.now() - run.startedAt) / 60000));
  const record = { module: s.id, title: s.title, name: run.name, date: new Date().toISOString(), score: pct, pass, minutes: mins, answers: scored };
  try {
    const hist = JSON.parse(localStorage.getItem('hqscale.history') || '[]');
    hist.push(record);
    localStorage.setItem('hqscale.history', JSON.stringify(hist.slice(-50)));
  } catch {}

  ui.resultsInner.innerHTML = `
    <div class="kicker muted">${esc(s.title)}${run.name ? ` · ${esc(run.name)}` : ''}</div>
    <div class="score-hero">
      <div class="big">${pct}%</div>
      <div class="verdict ${pass ? 'pass' : 'fail'}">${pass ? 'Passed' : 'Not passed yet'}</div>
      <div class="muted">${correct} of ${scored.length} correct · pass mark ${Math.round((s.passMark ?? 0.8) * 100)}% · about ${mins} min</div>
    </div>
    <ul class="result-list">${scored.map((r) => `
      <li><span class="mark ${r.correct ? 'good' : 'bad'}">${r.correct ? '✓' : '✕'}</span>
        <span><strong>${esc(r.title)}</strong><br><span class="muted">${esc(r.detail)}</span></span></li>`).join('')}
    </ul>
    <div class="actions-row">
      <button class="btn" id="res-retry">Try again</button>
      <button class="btn secondary" id="res-csv">Download record (CSV)</button>
      <button class="btn secondary" id="res-copy">Copy results</button>
      <button class="btn secondary" id="res-home">Back to modules</button>
    </div>`;
  ui.results.hidden = false;
  $('#res-retry').onclick = () => startScenario(s);
  $('#res-home').onclick = goHome;
  $('#res-csv').onclick = () => downloadCsv(record);
  // Some hosts (e.g. sandboxed embeds) block file downloads; builds for them set this flag.
  if (window.HQSCALE_NO_DOWNLOADS) $('#res-csv').hidden = true;
  $('#res-copy').onclick = async () => {
    const text = `${s.title}${run.name ? ` — ${run.name}` : ''}\nScore ${pct}% (${pass ? 'passed' : 'not passed'}) · ${record.date.slice(0, 10)}\n`
      + scored.map((r) => `${r.correct ? '✓' : '✕'} ${r.title} — ${r.detail}`).join('\n');
    try { await navigator.clipboard.writeText(text); toast('Results copied', 'good'); } catch { toast('Copy was blocked on this device', 'bad'); }
  };
}

function downloadCsv(r) {
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const rows = [['Module', 'Name', 'Date', 'Score %', 'Passed', 'Minutes'].map(q).join(','),
    [r.title, r.name, r.date, r.score, r.pass ? 'Yes' : 'No', r.minutes].map(q).join(','), '',
    ['Item', 'Correct', 'Detail'].map(q).join(','),
    ...r.answers.map((a) => [a.title, a.correct ? 'Yes' : 'No', a.detail].map(q).join(','))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([rows.join('\r\n')], { type: 'text/csv' }));
  a.download = `${r.module}-${(r.name || 'result').replace(/\W+/g, '-')}-${r.date.slice(0, 10)}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- home

async function goHome() {
  run?.cleanup?.();
  run = null;
  viewer.clearMarkers();
  hideBanner();
  hideCard();
  ui.topbar.hidden = true;
  ui.results.hidden = true;
  ui.home.hidden = false;
}

async function renderModules() {
  try { ui.name.value = localStorage.getItem('hqscale.name') || ''; } catch {}
  let list;
  try {
    list = (await fetchJson('scenarios/index.json')).modules;
  } catch {
    list = [{ file: 'scenarios/hq-induction.json', title: 'HQ Site Induction' }];
  }
  ui.moduleList.innerHTML = '';
  for (const m of list) {
    const btn = document.createElement('button');
    btn.className = 'module';
    btn.innerHTML = `<h3>${esc(m.title)}</h3><p>${esc(m.description || '')}</p>
      <span class="meta">${m.minutes ? `~${m.minutes} min · ` : ''}Start →</span>`;
    btn.onclick = () => openScenario(m.file);
    ui.moduleList.append(btn);
  }
}

async function openScenario(file) {
  try {
    ui.loading.hidden = false;
    const s = await loadScenario(file);
    await startScenario(s);
  } catch (err) {
    ui.loading.hidden = true;
    ui.home.hidden = false;
    toast(err.message, 'bad', 6000);
  }
}

// ---------------------------------------------------------------- chrome buttons

// In-page confirmation (native confirm() dialogs are blocked in some embedded viewers).
ui.btnExit.onclick = () => {
  const box = document.createElement('div');
  box.className = 'modal';
  box.innerHTML = `<div class="card modal-card" role="dialog" aria-modal="true" aria-labelledby="leave-title">
    <h2 id="leave-title">Leave this module?</h2><p>Your progress will be lost.</p>
    <div class="card-actions"><button class="btn secondary" data-stay>Stay</button><button class="btn" data-leave>Leave</button></div></div>`;
  box.querySelector('[data-stay]').onclick = () => box.remove();
  box.querySelector('[data-leave]').onclick = () => { box.remove(); goHome(); };
  document.body.append(box);
  box.querySelector('[data-stay]').focus();
};
ui.btnVideo.onclick = () => viewer.toggleVideo();

if (isTouch && PanoViewer.gyroSupported) ui.btnGyro.hidden = false;
ui.btnGyro.onclick = async () => {
  if (viewer.gyro) { viewer.disableGyro(); ui.btnGyro.classList.remove('on'); return; }
  const ok = await viewer.enableGyro();
  ui.btnGyro.classList.toggle('on', ok);
  toast(ok ? 'Move your phone to look around' : 'Motion access was not allowed', ok ? '' : 'bad');
};

if (document.fullscreenEnabled) ui.btnFs.hidden = false;
ui.btnFs.onclick = () => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => {}));

// ---------------------------------------------------------------- author mode

async function startAuthor() {
  const file = params.get('scenario') || 'scenarios/hq-induction.json';
  ui.home.hidden = true;
  let scenario;
  try {
    scenario = await loadScenario(file);
  } catch (err) {
    toast(err.message, 'bad', 6000);
    scenario = { scenes: {}, steps: [] };
  }
  currentScenario = scenario;
  const picks = [];
  const cross = document.createElement('div');
  cross.className = 'crosshair';
  document.body.append(cross);

  ui.author.hidden = false;
  ui.author.innerHTML = `
    <div class="row">
      <strong>Authoring</strong>
      <select id="au-scene" aria-label="Scene">${Object.entries(scenario.scenes).map(([id, s]) => `<option value="${esc(id)}">${esc(s.title || id)}</option>`).join('')}</select>
      <label class="btn secondary small">Open 360 photo/video…<input id="au-file" type="file" accept="image/*,video/*" hidden></label>
      <button class="btn secondary small" id="au-exit">Exit</button>
    </div>
    <div class="row"><span class="readout" id="au-view"></span></div>
    <div class="muted" style="font-size:13px">Tap anywhere in the view to capture its yaw/pitch. Dashed circles show the targets and hotspots already defined for this scene.</div>
    <pre id="au-out">[]</pre>
    <div class="row"><button class="btn small" id="au-copy">Copy</button><button class="btn secondary small" id="au-clear">Clear</button></div>`;

  $('#au-exit').onclick = () => {
    if (params.has('author')) location.href = './';
    else { history.replaceState(null, '', location.pathname + location.search); location.reload(); }
  };
  const out = $('#au-out');
  const refresh = () => (out.textContent = picks.length ? `[\n${picks.map((p) => `  { "yaw": ${p.yaw}, "pitch": ${p.pitch}, "radius": 8, "label": "" }`).join(',\n')}\n]` : '[]');

  const outlines = [];
  const drawOutlines = (id) => {
    outlines.forEach((m) => viewer.removeMarker(m));
    outlines.length = 0;
    scenario.steps.filter((s) => s.scene === id).forEach((s) => {
      [...(s.targets || []), ...(s.hotspots || []).map((h) => ({ ...h, label: h.title, radius: h.radius ?? 6 }))].forEach((t) => {
        const el = document.createElement('div');
        el.className = 'target-outline';
        el.innerHTML = `<span>${esc(t.label || '')}</span>`;
        el.dataset.r = t.radius ?? 8;
        outlines.push(viewer.addMarker({ yaw: t.yaw, pitch: t.pitch, el }));
      });
    });
  };
  // Keep outline sizes matched to the angular radius at the current zoom.
  viewer.onViewChange(({ fov }) => {
    $('#au-view').textContent = `view  yaw ${viewer.yaw.toFixed(1)}°  pitch ${viewer.pitch.toFixed(1)}°  fov ${fov.toFixed(0)}°`;
    const pxPerDeg = viewer.height / fov;
    outlines.forEach((m) => {
      const d = 2 * m.el.dataset.r * pxPerDeg;
      Object.assign(m.el.style, { width: `${d}px`, height: `${d}px`, marginLeft: `${-d / 2}px`, marginTop: `${-d / 2}px` });
    });
  });

  const sceneSel = $('#au-scene');
  sceneSel.onchange = async () => { await showScene(sceneSel.value); drawOutlines(sceneSel.value); };
  if (sceneSel.value) sceneSel.onchange();

  $('#au-file').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    currentSceneId = null;
    outlines.forEach((m) => viewer.removeMarker(m));
    outlines.length = 0;
    await viewer.load({ type: f.type.startsWith('video') ? 'video' : 'image', src: URL.createObjectURL(f) });
    viewer.setView({ yaw: 0, pitch: 0, fov: 75 });
    toast(`Previewing ${f.name}`);
  };

  viewer.onTap(({ yaw, pitch }) => {
    const p = { yaw: Math.round(yaw), pitch: Math.round(pitch) };
    picks.push(p);
    const el = document.createElement('div');
    el.className = 'pick';
    viewer.addMarker({ ...p, el });
    refresh();
    toast(`yaw ${p.yaw}°, pitch ${p.pitch}°`);
  });
  $('#au-copy').onclick = async () => {
    try { await navigator.clipboard.writeText(out.textContent); toast('Copied'); } catch { toast('Select the text and copy it manually'); }
  };
  $('#au-clear').onclick = () => {
    picks.length = 0;
    viewer.markers.filter((m) => m.el.classList.contains('pick')).forEach((m) => viewer.removeMarker(m));
    refresh();
  };
}

// ---------------------------------------------------------------- boot

// The authoring tool opens from ?author=1 or #author (hash links work in hosts that strip query strings).
window.addEventListener('hashchange', () => { if (location.hash === '#author') location.reload(); });
if (params.has('author') || location.hash === '#author') {
  startAuthor();
} else if (params.get('scenario')) {
  ui.home.hidden = true;
  openScenario(params.get('scenario'));
} else {
  renderModules();
}

// Offline support. Skipped in single-file builds, and guarded because sandboxed frames
// throw when navigator.serviceWorker is even accessed.
if (!window.HQSCALE_EMBED && location.protocol === 'https:') {
  try { navigator.serviceWorker?.register('sw.js').catch(() => {}); } catch {}
}

// Handy for debugging from the browser console and for automated tests.
window.hqscale = { viewer, get run() { return run; } };
