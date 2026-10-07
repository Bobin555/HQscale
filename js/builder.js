// Module builder: lets HR / HSE officers create a training module without editing JSON.
// Open a 360° photo or video, tap where hazards and objects are, write questions, preview the
// module as a learner, then save it as a module file.
//
// Media files picked from the computer are only referenced by name in the module
// ("media/<module-id>/<file>"); while building, they're shown from a local blob URL.

import { validateScenario } from './validate.js';
import { sprite, SPRITES, propElement, propTransform, sameMoment } from './placeholder.js';
import { HAZARDS, HAZARD_CATEGORIES } from './hazards.js';

const DRAFT_KEY = 'hqscale.builder.draft';
const STEP_INFO = {
  explore: { icon: '⚠', name: 'Hazard spots', help: 'Learners tap markers to learn about hazards and how to check them.' },
  find: { icon: '🎯', name: 'Find task', help: 'Learners look around and tap the right thing.' },
  quiz: { icon: '❓', name: 'Question', help: 'A multiple-choice question shown over the scene.' },
  info: { icon: '💬', name: 'Message', help: 'A short message, e.g. a welcome or instructions.' },
};
const RISKS = ['high', 'medium', 'low', 'info'];

const fmtTime = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
const slug = (s) => String(s || '').toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scene';
const clone = (o) => JSON.parse(JSON.stringify(o));

export function startBuilder(api) {
  const { viewer, toast, esc, loadScene, preview, listModules, loadModule } = api;
  const localUrls = {}; // sceneId -> blob URL of a file picked this session
  let draft = loadDraft() || emptyDraft();
  let sceneId = Object.keys(draft.scenes)[0] || null;
  let editing = null; // index of the step being edited
  let moving = null; // index of the point waiting to be moved by the next tap
  let markers = [];
  let libCat = HAZARD_CATEGORIES[0];
  let libQuery = '';
  let armed = null; // hazard picked from the library, placed by the next tap on the view

  document.body.classList.add('has-builder');
  const panel = document.createElement('aside');
  panel.className = 'builder';
  panel.setAttribute('aria-label', 'Module builder');
  document.body.append(panel);
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,video/*', hidden: true });
  const jsonInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
  document.body.append(fileInput, jsonInput);
  const vbar = document.createElement('div');
  vbar.className = 'bld-vbar';
  vbar.hidden = true;
  document.body.append(vbar);
  let pendingFileScene = null; // scene id to attach the next picked file to (null = new scene)

  // ------------------------------------------------------------ state helpers

  function emptyDraft() {
    return { id: '', title: '', description: '', estimatedMinutes: 5, passMark: 0.8, scenes: {}, steps: [] };
  }
  function loadDraft() {
    try { return JSON.parse(localStorage.getItem(DRAFT_KEY)); } catch { return null; }
  }
  function save() {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch {}
  }
  const step = () => (editing == null ? null : draft.steps[editing]);
  const points = (st) => (st?.type === 'find' ? st.targets : st?.type === 'explore' ? st.hotspots : null);
  const moduleId = () => draft.id || slug(draft.title) || 'my-module';

  /** The module as it will be saved: blank options removed, ids filled in. */
  function exportable() {
    const m = clone(draft);
    m.id = moduleId();
    for (const sc of Object.values(m.scenes)) {
      if (sc.media.file) sc.media.src = `media/${m.id}/${sc.media.file}`;
      delete sc.media.file;
    }
    for (const st of m.steps) {
      if (st.type === 'quiz') {
        const keep = st.options.map((o, i) => [o.trim(), i]).filter(([o]) => o);
        st.answer = keep.findIndex(([, i]) => i === st.answer);
        st.options = keep.map(([o]) => o);
      }
      if (st.type === 'explore') st.hotspots.forEach((h) => { h.checklist = (h.checklist || []).filter((c) => c.trim()); });
    }
    return m;
  }
  /** Same, but media pointing at the local files so it can be previewed right now. */
  function playable() {
    const m = exportable();
    for (const [id, sc] of Object.entries(m.scenes)) if (localUrls[id]) sc.media.src = localUrls[id];
    return m;
  }

  // ------------------------------------------------------------ scenes

  async function showScene(id) {
    sceneId = id;
    if (!id) return;
    const sc = playable().scenes[id];
    sc.media.autoplay = false; // videos stay paused while building so markers line up
    const info = await loadScene({ scenes: { [id]: sc } }, id);
    const st = step();
    if (st?.scene === id && typeof st.videoTime === 'number') await viewer.seekVideo(st.videoTime);
    const missing = !info && (draft.scenes[id].media.file && !localUrls[id]);
    if (missing) toast(`Open "${draft.scenes[id].media.file}" again to see this scene (files aren't kept after the page is closed).`, 'bad', 6000);
    else if (info?.warnings?.length) toast(info.warnings[0], 'bad', 7000);
    drawMarkers();
    renderVideoBar();
  }

  const isVideoScene = (id = sceneId) => draft.scenes[id]?.media.type === 'video';

  // ------------------------------------------------------------ video timeline
  // A 360 video moves, so each step shows the video frozen on one moment. Markers are placed
  // on that frame and learners see exactly the same frame.

  function renderVideoBar() {
    const show = !panel.hidden && isVideoScene() && viewer.video;
    vbar.hidden = !show;
    if (!show) return;
    const st = step();
    const dur = viewer.videoDuration;
    const t = viewer.videoTime;
    const onStep = st && st.scene === sceneId;
    const frozen = onStep && typeof st.videoTime === 'number';
    const matches = frozen && Math.abs(st.videoTime - t) < 0.05;
    vbar.innerHTML = `
      <button class="btn secondary small" data-v="play" aria-label="${viewer.isVideoPaused ? 'Play' : 'Pause'}">${viewer.isVideoPaused ? '▶' : '❚❚'}</button>
      <input type="range" min="0" max="${dur.toFixed(2)}" step="0.05" value="${t.toFixed(2)}" data-v="seek" aria-label="Video position">
      <span class="bld-vtime">${fmtTime(t)} / ${fmtTime(dur)}</span>
      ${onStep ? (matches
        ? `<span class="bld-vstat ok">📌 Step ${editing + 1} shows this moment</span>`
        : `<button class="btn small" data-v="use">📌 Use this moment for step ${editing + 1}</button>${frozen ? `<button class="btn secondary small" data-v="goto">Back to ${fmtTime(st.videoTime)}</button>` : ''}`) : ''}`;
  }
  vbar.addEventListener('input', (e) => {
    if (e.target.dataset.v !== 'seek') return;
    viewer.seekVideo(Number(e.target.value)).then(() => {
      vbar.querySelector('.bld-vtime').textContent = `${fmtTime(viewer.videoTime)} / ${fmtTime(viewer.videoDuration)}`;
      drawMarkers();
    });
  });
  vbar.addEventListener('change', (e) => { if (e.target.dataset.v === 'seek') renderVideoBar(); });
  vbar.addEventListener('click', async (e) => {
    const v = e.target.closest('[data-v]')?.dataset.v;
    const st = step();
    if (v === 'play') { viewer.toggleVideo(); renderVideoBar(); drawMarkers(); }
    if (v === 'use' && st) {
      viewer.pauseVideo();
      st.videoTime = Math.round(viewer.videoTime * 100) / 100;
      save();
      toast(`Step ${editing + 1} will show the video at ${fmtTime(st.videoTime)}`, 'good');
      render();
      renderVideoBar();
      drawMarkers();
    }
    if (v === 'goto' && st) { await viewer.seekVideo(st.videoTime); renderVideoBar(); drawMarkers(); }
  });
  // Keep the time readout moving while the video plays.
  setInterval(() => {
    if (vbar.hidden || viewer.isVideoPaused) return;
    const r = vbar.querySelector('[data-v="seek"]');
    if (r && document.activeElement !== r) r.value = viewer.videoTime;
    const tm = vbar.querySelector('.bld-vtime');
    if (tm) tm.textContent = `${fmtTime(viewer.videoTime)} / ${fmtTime(viewer.videoDuration)}`;
  }, 250);

  async function addMediaFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (['insp', 'insv', '360', 'heic'].includes(ext)) {
      toast(ext === 'heic' ? 'HEIC photos need converting to JPG first.' : 'This is a raw camera file. Export it from the camera app as a 360° JPG or MP4 first.', 'bad', 7000);
      return;
    }
    const type = file.type.startsWith('video') ? 'video' : 'image';
    let id = pendingFileScene;
    if (!id) {
      id = slug(file.name);
      while (draft.scenes[id]) id += '-2';
      draft.scenes[id] = { title: file.name.replace(/\.[^.]+$/, ''), initialView: { yaw: 0, pitch: 0 }, media: { type, file: file.name } };
    } else {
      draft.scenes[id].media = { ...draft.scenes[id].media, type, file: file.name };
      delete draft.scenes[id].media.src;
    }
    pendingFileScene = null;
    if (localUrls[id]) URL.revokeObjectURL(localUrls[id]);
    localUrls[id] = URL.createObjectURL(file);
    save();
    render();
    await showScene(id);
  }

  fileInput.onchange = () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) addMediaFile(f); };
  jsonInput.onchange = async () => {
    const f = jsonInput.files[0];
    jsonInput.value = '';
    if (!f) return;
    try { openModule(JSON.parse(await f.text())); } catch (e) { toast(`Couldn't read ${f.name}: ${e.message}`, 'bad', 6000); }
  };

  function openModule(m) {
    if (!m?.scenes || !m?.steps) throw new Error('this is not a module file');
    draft = { ...emptyDraft(), ...clone(m) };
    // Media already hosted with the site keeps its src; anything else will need re-opening.
    editing = null;
    save();
    render();
    showScene(Object.keys(draft.scenes)[0] || null);
  }

  // ------------------------------------------------------------ markers in the 360 view

  /**
   * On a 360 video, a step's markers and pictures only fit the frame they were placed on, so
   * outside the step being edited they're shown only when the video is paused on that moment.
   */
  function onScreenNow(s) {
    if (!isVideoScene(s.scene)) return true;
    return !!viewer.video && viewer.isVideoPaused && sameMoment(s.videoTime, viewer.videoTime);
  }

  function drawMarkers() {
    markers.forEach((m) => viewer.removeMarker(m));
    markers = [];
    const st = step();
    // Pictures placed in the scene. Those of the step being edited can be moved, resized and rotated.
    draft.steps.forEach((s, si) => {
      if (s.scene !== sceneId || (s !== st && !onScreenNow(s))) return;
      (points(s) || []).forEach((p, pi) => {
        const pe = p.prop?.kind && propElement(p.prop);
        if (!pe) return;
        const m = viewer.addMarker({ yaw: p.yaw, pitch: p.pitch, el: pe.el, size: pe.size, under: true });
        m.point = p;
        markers.push(m);
        if (s === st) makeEditable(m, p, pi, pe);
      });
    });
    const list = st ? [[st, editing]] : draft.steps.map((s, i) => [s, i]).filter(([s]) => s.scene === sceneId && onScreenNow(s));
    for (const [s, si] of list) {
      (points(s) || []).forEach((p, pi) => {
        const el = document.createElement('div');
        const isFind = s.type === 'find';
        el.className = `bld-point ${isFind ? 'find' : `hz ${p.icon || 'hazard'}`}${st ? '' : ' faded'}${moving === pi && st ? ' moving' : ''}${p.prop?.kind ? ' has-prop' : ''}`;
        const label = isFind ? p.label : p.title;
        el.innerHTML = `${isFind ? '' : `<span class="dot">${{ hazard: '⚠', check: '✓', info: 'i' }[p.icon || 'hazard']}</span>`}<span class="tag">${pi + 1}. ${esc(label || (isFind ? 'Target' : 'Hazard'))}</span>`;
        el.onclick = () => { if (!st) editStep(si); else panel.querySelector(`[data-point="${pi}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
        const r = p.radius ?? 8;
        const m = viewer.addMarker({ yaw: p.yaw, pitch: p.pitch, el, size: isFind ? [2 * r, 2 * r] : undefined });
        m.point = p;
        markers.push(m);
      });
    }
  }

  // ------------------------------------------------------------ moving, resizing and rotating pictures

  function makeEditable(m, p, pi, pe) {
    const el = m.el;
    el.classList.add('editable');
    el.title = 'Drag to move · corner to resize · top handle to rotate';
    el.insertAdjacentHTML('beforeend', '<span class="h-scale" title="Drag to resize"></span><span class="h-rot" title="Drag to rotate"></span>');
    const rect = () => viewer.container.getBoundingClientRect();
    const centre = () => {
      const sp = viewer.yawPitchToScreen(p.yaw, p.pitch);
      const r = rect();
      return sp ? { x: r.left + sp.x, y: r.top + sp.y } : null;
    };
    const follow = () => {
      for (const mk of markers) if (mk.point === p) { mk.yaw = p.yaw; mk.pitch = p.pitch; }
      viewer.dirty = true;
    };
    const resize = () => {
      const fresh = propElement(p.prop);
      m.size = fresh.size;
      pe.img.src = fresh.img.src;
      pe.img.style.transform = propTransform(p.prop);
      viewer.dirty = true;
    };
    el.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      const handle = e.target.classList.contains('h-scale') ? 'scale' : e.target.classList.contains('h-rot') ? 'rotate' : 'move';
      const c = centre();
      if (!c) return;
      freezeStepMoment(step());
      const start = { x: e.clientX, y: e.clientY, off: { x: c.x - e.clientX, y: c.y - e.clientY }, d: Math.hypot(e.clientX - c.x, e.clientY - c.y) || 1, scale: p.prop.scale ?? 1 };
      el.classList.add('dragging');
      const onMove = (ev) => {
        if (handle === 'move') {
          const yp = viewer.screenToYawPitch(ev.clientX + start.off.x, ev.clientY + start.off.y);
          p.yaw = Math.round(yp.yaw * 10) / 10;
          p.pitch = Math.round(yp.pitch * 10) / 10;
          follow();
        } else {
          const cc = centre();
          if (!cc) return;
          if (handle === 'scale') {
            p.prop.scale = Math.round(Math.min(5, Math.max(0.2, start.scale * (Math.hypot(ev.clientX - cc.x, ev.clientY - cc.y) / start.d))) * 100) / 100;
          } else {
            p.prop.rotate = Math.round((Math.atan2(ev.clientX - cc.x, -(ev.clientY - cc.y)) * 180) / Math.PI);
          }
          resize();
        }
      };
      const onUp = () => {
        el.removeEventListener('pointermove', onMove);
        el.removeEventListener('pointerup', onUp);
        el.removeEventListener('pointercancel', onUp);
        el.classList.remove('dragging');
        save();
        render();
        drawMarkers();
        panel.querySelector(`[data-point="${pi}"]`)?.scrollIntoView({ block: 'nearest' });
      };
      el.addEventListener('pointermove', onMove);
      el.addEventListener('pointerup', onUp);
      el.addEventListener('pointercancel', onUp);
    });
  }

  viewer.onTap(({ yaw, pitch }) => {
    if (panel.hidden) return;
    const p = { yaw: Math.round(yaw), pitch: Math.round(pitch) };
    if (armed) { const h = armed; armed = null; placeHazard(h, p); return; }
    const st = step();
    const list = points(st);
    if (!list) {
      toast(draft.steps.length ? 'Choose a "Hazard spots" or "Find task" step, then tap the view to place things.' : 'Add a "Hazard spots" or "Find task" step first, then tap the view to place things.');
      return;
    }
    if (st.scene !== sceneId) { toast('This step belongs to another scene.', 'bad'); return; }
    freezeStepMoment(st);
    if (moving != null && list[moving]) {
      Object.assign(list[moving], p);
      moving = null;
      toast('Moved');
    } else {
      list.push(st.type === 'find'
        ? { ...p, radius: 8, label: '' }
        : { ...p, icon: 'hazard', risk: 'medium', title: '', body: '', checklist: [] });
      toast(st.type === 'find' ? 'Target added — give it a name' : 'Hazard added — fill in the details');
    }
    save();
    render();
    const focusIdx = moving ?? list.length - 1;
    panel.querySelector(`[data-point="${focusIdx}"] input`)?.focus({ preventScroll: false });
  });

  /** On a video scene, a step's markers belong to the frame on screen: pause and remember it. */
  function freezeStepMoment(st) {
    if (!isVideoScene(st.scene) || !viewer.video) return;
    viewer.pauseVideo();
    if (typeof st.videoTime !== 'number') st.videoTime = Math.round(viewer.videoTime * 100) / 100;
    renderVideoBar();
  }

  // ------------------------------------------------------------ hazard library

  /** Adds a library hazard at a spot: to the step being edited, or to a "Hazard spots" step. */
  function placeHazard(h, at) {
    if (!sceneId) { toast('Add a 360° photo or video first.', 'bad'); return; }
    let st = step();
    if (!st || !points(st) || st.scene !== sceneId) {
      const idx = draft.steps.findLastIndex((x) => x.type === 'explore' && x.scene === sceneId);
      if (idx >= 0) editing = idx;
      else {
        draft.steps.push({ type: 'explore', scene: sceneId, title: 'Hazards in this area', prompt: 'Tap each marker to learn what to look for and how to check it.', hotspots: [], requireAll: true });
        editing = draft.steps.length - 1;
      }
      st = step();
    }
    freezeStepMoment(st);
    const prop = h.sprite ? { kind: h.sprite.kind, ...(h.sprite.opts ? { opts: h.sprite.opts } : {}), scale: 1 } : undefined;
    const list = points(st);
    if (st.type === 'find') {
      const spr = prop && sprite(prop.kind, prop.opts);
      const radius = spr ? Math.round(Math.min(20, Math.max(5, Math.max(...spr.size) / 2 + 1))) : 8;
      list.push({ ...at, radius, label: h.name, ...(prop ? { prop } : {}) });
      if (!st.title) st.title = `Find the ${h.name.toLowerCase()}`;
      if (!st.prompt) st.prompt = `Look around and tap on the ${h.name.toLowerCase()}.`;
    } else {
      list.push({ ...at, icon: h.type === 'check' ? 'check' : 'hazard', risk: h.risk, title: h.name, body: h.body, checklist: [...h.checklist], ...(prop ? { prop } : {}) });
    }
    moving = null;
    save();
    render();
    drawMarkers();
    toast(`${h.name} added${prop ? ' with a picture in the scene' : ''}. Edit the details if you need to.`, 'good');
    panel.querySelector(`[data-point="${list.length - 1}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  function libraryItems() {
    const q = libQuery.trim().toLowerCase();
    return HAZARDS.filter((h) => (q ? `${h.name} ${h.body} ${h.cat}`.toLowerCase().includes(q) : h.cat === libCat));
  }
  function renderLibraryGrid() {
    const items = libraryItems();
    return items.length ? items.map((h) => `
      <button class="bld-lib-item ${armed?.id === h.id ? 'armed' : ''}" draggable="true" data-hz="${h.id}" title="${esc(h.body)}">
        <span class="i">${h.icon}</span><span class="n">${esc(h.name)}</span>${h.sprite ? '<span class="pic" title="Adds a picture to the scene">🖼</span>' : ''}
      </button>`).join('') : '<p class="bld-muted">No matches.</p>';
  }
  function renderLibrary() {
    return `<details class="bld-lib" ${libraryOpen ? 'open' : ''}>
      <summary><strong>📚 Hazard library</strong> <em>drag onto the 360° view</em></summary>
      <p class="bld-muted small">Drag a hazard onto the scene, or tap one and then tap the scene. 🖼 = also puts a picture of it in the scene.</p>
      <div class="bld-lib-filters">
        <input type="search" data-lib="q" value="${esc(libQuery)}" placeholder="Search hazards" aria-label="Search hazards">
        <select data-lib="cat" aria-label="Category">${HAZARD_CATEGORIES.map((c) => `<option ${c === libCat ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select>
      </div>
      <div class="bld-lib-grid">${renderLibraryGrid()}</div>
    </details>`;
  }
  let libraryOpen = true;
  const adjustOpen = new Set(); // picture-adjust panels left open between re-renders

  // Drag and drop from the library onto the 360° view.
  const stage = viewer.container;
  stage.addEventListener('dragover', (e) => {
    if (panel.hidden || !e.dataTransfer.types.includes('text/plain')) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    stage.classList.add('drop-target');
  });
  stage.addEventListener('dragleave', () => stage.classList.remove('drop-target'));
  stage.addEventListener('drop', (e) => {
    stage.classList.remove('drop-target');
    const id = e.dataTransfer.getData('text/plain').replace(/^hqscale-hazard:/, '');
    const h = HAZARDS.find((x) => x.id === id);
    if (!h || panel.hidden) return;
    e.preventDefault();
    const yp = viewer.screenToYawPitch(e.clientX, e.clientY);
    placeHazard(h, { yaw: Math.round(yp.yaw), pitch: Math.round(yp.pitch) });
  });
  panel.addEventListener('dragstart', (e) => {
    const id = e.target.closest?.('[data-hz]')?.dataset.hz;
    if (!id) return;
    e.dataTransfer.setData('text/plain', `hqscale-hazard:${id}`);
    e.dataTransfer.effectAllowed = 'copy';
  });

  // ------------------------------------------------------------ steps

  function addStep(type) {
    if (!sceneId) { toast('Open a 360° photo or video first.', 'bad'); return; }
    const base = { type, scene: sceneId };
    const defaults = {
      info: { title: '', body: '' },
      find: { title: '', prompt: '', targets: [], maxAttempts: 3, hint: '', explain: '' },
      quiz: { question: '', options: ['', '', '', ''], answer: 0, explain: '', shuffle: true },
      explore: { title: 'Hazards in this area', prompt: 'Tap each marker to learn what to look for and how to check it.', hotspots: [], requireAll: true },
    };
    const moment = isVideoScene() && viewer.video ? { videoTime: Math.round(viewer.videoTime * 100) / 100 } : {};
    draft.steps.push({ ...base, ...defaults[type], ...moment });
    save();
    editStep(draft.steps.length - 1);
    if (type === 'find' || type === 'explore') toast('Now tap the view where the thing is');
  }

  async function editStep(i) {
    editing = i;
    moving = null;
    render();
    const st = step();
    if (st && st.scene !== sceneId) await showScene(st.scene);
    else {
      if (st && typeof st.videoTime === 'number' && isVideoScene()) await viewer.seekVideo(st.videoTime);
      drawMarkers();
      renderVideoBar();
    }
  }

  function moveStep(i, d) {
    const j = i + d;
    if (j < 0 || j >= draft.steps.length) return;
    [draft.steps[i], draft.steps[j]] = [draft.steps[j], draft.steps[i]];
    save();
    render();
  }

  function confirmBox(text, okLabel, onOk) {
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="card modal-card" role="dialog" aria-modal="true"><p>${esc(text)}</p>
      <div class="card-actions"><button class="btn secondary" data-no>Cancel</button><button class="btn" data-yes>${esc(okLabel)}</button></div></div>`;
    box.querySelector('[data-no]').onclick = () => box.remove();
    box.querySelector('[data-yes]').onclick = () => { box.remove(); onOk(); };
    document.body.append(box);
  }

  // ------------------------------------------------------------ rendering

  function render() {
    const st = step();
    panel.innerHTML = `
      <header class="bld-head">
        <button class="bld-collapse" data-act="collapse" aria-label="Show or hide the builder">▾</button>
        <strong>Module builder</strong>
        <span class="bld-head-actions">
          <button class="btn small" data-act="preview" ${draft.steps.length ? '' : 'disabled'}>▶ Preview</button>
          <button class="btn secondary small" data-act="save">Save</button>
          <button class="btn secondary small" data-act="menu" aria-label="More">⋯</button>
        </span>
      </header>
      <div class="bld-menu" hidden>
        <button data-act="open-json">Open a saved module file…</button>
        <select data-act="open-existing" aria-label="Edit an existing module"><option value="">Edit an existing module…</option></select>
        <button data-act="new">Start a new module</button>
        <button data-act="exit">Exit builder</button>
      </div>
      <div class="bld-body">
        ${st ? renderEditor(st) : renderOverview()}
      </div>`;
    if (!st) fillModuleSelect();
  }

  function renderOverview() {
    const scenes = Object.entries(draft.scenes);
    const problems = draft.steps.length ? validateScenario(exportable()) : [];
    return `
      <label class="bld-field"><span>Module name</span>
        <input data-scope="module" data-f="title" value="${esc(draft.title)}" placeholder="e.g. Bridge site safety walk"></label>
      <label class="bld-field"><span>Short description <em>(shown on the home screen)</em></span>
        <input data-scope="module" data-f="description" value="${esc(draft.description)}" placeholder="What learners will practise"></label>

      <h3 class="bld-h">1 · 360° scenes</h3>
      <div class="bld-scenes">
        ${scenes.map(([id, sc]) => `
          <div class="bld-scene ${id === sceneId ? 'on' : ''}">
            <button class="bld-scene-pick" data-act="scene" data-id="${esc(id)}">
              <span>${sc.media.type === 'video' ? '🎞' : sc.media.type === 'placeholder' ? '🧩' : '🖼'}</span>
              <span>${esc(sc.title || id)}</span>
              ${sc.media.file && !localUrls[id] ? '<span class="bld-warn" title="Open the file again">⚠ reopen file</span>' : ''}
            </button>
            ${id === sceneId ? `
              <div class="bld-scene-tools">
                <input data-scope="scene" data-f="title" value="${esc(sc.title || '')}" aria-label="Scene name" placeholder="Scene name">
                <button class="btn secondary small" data-act="start-view" title="Learners start looking in the direction you're facing now">Set start view</button>
                ${sc.media.file ? `<button class="btn secondary small" data-act="reopen" data-id="${esc(id)}">${localUrls[id] ? 'Replace file' : 'Reopen file'}</button>` : ''}
                <button class="btn secondary small danger" data-act="del-scene" data-id="${esc(id)}">Remove</button>
              </div>` : ''}
          </div>`).join('')}
      </div>
      <button class="btn secondary small" data-act="add-media">＋ Add 360° photo or video</button>

      <h3 class="bld-h">2 · Steps <em>(learners go through these in order)</em></h3>
      ${draft.steps.length ? `<ol class="bld-steps">${draft.steps.map((s, i) => `
        <li>
          <button class="bld-step" data-act="edit" data-i="${i}">
            <span class="ico">${STEP_INFO[s.type].icon}</span>
            <span class="txt"><strong>${esc(stepTitle(s))}</strong><small>${STEP_INFO[s.type].name} · ${esc(draft.scenes[s.scene]?.title || s.scene)}${countText(s)}</small></span>
          </button>
          <span class="bld-step-tools">
            <button data-act="up" data-i="${i}" aria-label="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
            <button data-act="down" data-i="${i}" aria-label="Move down" ${i === draft.steps.length - 1 ? 'disabled' : ''}>↓</button>
            <button data-act="del" data-i="${i}" aria-label="Delete step">✕</button>
          </span>
        </li>`).join('')}</ol>` : `<p class="bld-muted">${scenes.length ? 'No steps yet. Add one below.' : 'Add a 360° photo or video first.'}</p>`}
      <div class="bld-add">
        ${Object.entries(STEP_INFO).map(([t, s]) => `<button class="bld-add-btn" data-act="add" data-type="${t}" title="${esc(s.help)}" ${scenes.length ? '' : 'disabled'}><span>${s.icon}</span>${s.name}</button>`).join('')}
      </div>
      ${scenes.length ? renderLibrary() : ''}
      ${problems.length ? `<div class="bld-problems"><strong>To fix before saving:</strong><ul>${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul></div>` : draft.steps.length ? '<p class="bld-ok">✓ Module is ready to preview and save.</p>' : ''}`;
  }

  function stepTitle(s) {
    return (s.type === 'quiz' ? s.question : s.title) || `Untitled ${STEP_INFO[s.type].name.toLowerCase()}`;
  }
  function countText(s) {
    const p = points(s);
    return p ? ` · ${p.length} ${s.type === 'find' ? 'target' : 'marker'}${p.length === 1 ? '' : 's'}` : '';
  }

  function sceneSelect(st) {
    return `<label class="bld-field"><span>Scene</span><select data-scope="step" data-f="scene">
      ${Object.entries(draft.scenes).map(([id, sc]) => `<option value="${esc(id)}" ${id === st.scene ? 'selected' : ''}>${esc(sc.title || id)}</option>`).join('')}</select></label>`;
  }
  const field = (label, f, value, ph = '', tag = 'input', scope = 'step', extra = '') => tag === 'textarea'
    ? `<label class="bld-field"><span>${label}</span><textarea data-scope="${scope}" data-f="${f}" ${extra} placeholder="${esc(ph)}">${esc(value ?? '')}</textarea></label>`
    : `<label class="bld-field"><span>${label}</span><input data-scope="${scope}" data-f="${f}" ${extra} value="${esc(value ?? '')}" placeholder="${esc(ph)}"></label>`;

  function renderEditor(st) {
    const info = STEP_INFO[st.type];
    let body = '';
    if (st.type === 'info') {
      body = field('Title', 'title', st.title, 'e.g. Welcome to the bridge site')
        + field('Message', 'body', st.body, 'What learners should read', 'textarea');
    } else if (st.type === 'quiz') {
      body = field('Question', 'question', st.question, 'e.g. What should you do before crossing?', 'textarea')
        + `<div class="bld-field"><span>Answers <em>(select the correct one)</em></span>
            ${st.options.map((o, i) => `<div class="bld-opt"><input type="radio" name="bld-ans" data-scope="step" data-f="answer" value="${i}" ${st.answer === i ? 'checked' : ''} aria-label="Answer ${i + 1} is correct">
              <input data-scope="opt" data-i="${i}" value="${esc(o)}" placeholder="Answer ${'ABCD'[i] || i + 1}"></div>`).join('')}
            <button class="btn secondary small" data-act="add-opt" ${st.options.length >= 6 ? 'disabled' : ''}>＋ Add answer</button></div>`
        + field('Explanation <em>(shown after answering)</em>', 'explain', st.explain, 'Why the correct answer is right', 'textarea')
        + `<label class="bld-check"><input type="checkbox" data-scope="step" data-f="shuffle" ${st.shuffle ? 'checked' : ''}> Shuffle answer order</label>`;
    } else if (st.type === 'find') {
      body = field('Title', 'title', st.title, 'e.g. Spot the trip hazard')
        + field('Instruction', 'prompt', st.prompt, 'e.g. Look around and tap the trip hazard.')
        + pointList(st)
        + field('Hint <em>(after a wrong tap)</em>', 'hint', st.hint, 'e.g. Look down near the steps')
        + field('Explanation <em>(shown at the end)</em>', 'explain', st.explain, 'Why it matters', 'textarea')
        + field('Wrong taps allowed', 'maxAttempts', st.maxAttempts, '', 'input', 'step', 'type="number" min="1" max="10"');
    } else if (st.type === 'explore') {
      body = field('Title', 'title', st.title)
        + field('Instruction', 'prompt', st.prompt)
        + pointList(st)
        + `<label class="bld-check"><input type="checkbox" data-scope="step" data-f="requireAll" ${st.requireAll ? 'checked' : ''}> Learners must open every marker to continue</label>`;
    }
    return `
      <div class="bld-editor-head">
        <button class="btn secondary small" data-act="done">← All steps</button>
        <span>${info.icon} <strong>${info.name}</strong> · step ${editing + 1} of ${draft.steps.length}</span>
      </div>
      ${sceneSelect(st)}
      ${isVideoScene(st.scene) ? videoMomentField(st) : ''}
      ${points(st) ? renderLibrary() : ''}
      ${body}
      <div class="bld-editor-foot"><button class="btn small" data-act="done">Done</button></div>`;
  }

  function videoMomentField(st) {
    const canPlay = st.type === 'info' || st.type === 'quiz';
    const frozen = typeof st.videoTime === 'number';
    return `<div class="bld-moment"><span>🎞 ${frozen
      ? `Video is paused at <strong>${fmtTime(st.videoTime)}</strong> during this step. Change it with the video timeline.`
      : 'Video keeps playing during this step.'}</span>
      ${canPlay ? `<label class="bld-check"><input type="checkbox" data-scope="step" data-f="keepPlaying" ${frozen ? '' : 'checked'}> Keep the video playing (no markers in this step)</label>` : ''}
    </div>`;
  }

  function pointList(st) {
    const isFind = st.type === 'find';
    const list = points(st);
    return `<div class="bld-points">
      <div class="bld-tip">👆 <strong>Tap the 360° view</strong> where ${isFind ? 'the thing to find is' : 'each hazard is'} to add ${isFind ? 'a target' : 'a marker'}. Drag to look around first.</div>
      ${list.map((p, i) => `
        <div class="bld-point-card ${moving === i ? 'moving' : ''}" data-point="${i}">
          <div class="bld-point-head">
            <strong>${i + 1}.</strong>
            <input data-scope="point" data-i="${i}" data-f="${isFind ? 'label' : 'title'}" value="${esc(isFind ? p.label : p.title)}" placeholder="${isFind ? 'Name, e.g. Trailing cable' : 'Hazard name, e.g. Unguarded edge'}">
            <button class="btn secondary small" data-act="look" data-i="${i}" title="Turn the view to it">👁</button>
            <button class="btn secondary small" data-act="move" data-i="${i}" title="Tap the view to move it">${moving === i ? 'Tap view…' : 'Move'}</button>
            <button class="btn secondary small danger" data-act="del-point" data-i="${i}" aria-label="Remove">✕</button>
          </div>
          <div class="bld-row">
            <label>Picture in the scene <select data-scope="prop" data-i="${i}" data-f="kind">
              <option value="">None (it's already in the footage)</option>
              ${Object.entries(SPRITES).map(([k, n]) => `<option value="${k}" ${p.prop?.kind === k ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
          </div>
          ${p.prop?.kind ? `
          <details class="bld-adjust" ${adjustOpen.has(i) ? 'open' : ''} data-adjust="${i}">
            <summary>Adjust picture <em>(or drag it in the 360° view)</em></summary>
            <div class="bld-adjust-grid">
              ${[['scale', 'Size', 0.2, 5, 0.05, p.prop.scale ?? 1, (v) => `${Math.round(v * 100)}%`],
                ['rotate', 'Rotate', -180, 180, 1, p.prop.rotate ?? 0, (v) => `${v}°`],
                ['aspect', 'Width', 0.4, 2.5, 0.05, p.prop.aspect ?? 1, (v) => `${Math.round(v * 100)}%`],
                ['flat', 'Lie flat', 0, 80, 1, p.prop.flat ?? 0, (v) => (v > 0 ? `${v}°` : 'upright')]]
                .map(([f, l, mn, mx, stp, v, fmt]) => `<label>${l}<input type="range" min="${mn}" max="${mx}" step="${stp}" data-scope="prop" data-i="${i}" data-f="${f}" value="${v}"><output>${fmt(Number(v))}</output></label>`).join('')}
              <label class="bld-check"><input type="checkbox" data-scope="prop" data-i="${i}" data-f="flip" ${p.prop.flip ? 'checked' : ''}> Mirror</label>
              <button class="btn secondary small" data-act="reset-prop" data-i="${i}">Reset</button>
            </div>
          </details>` : ''}
          ${isFind ? `
            <label class="bld-range">Tap area <input type="range" min="3" max="25" data-scope="point" data-i="${i}" data-f="radius" value="${p.radius ?? 8}"> <span>${p.radius ?? 8}°</span></label>` : `
            <div class="bld-row">
              <label>Type <select data-scope="point" data-i="${i}" data-f="icon">
                ${[['hazard', '⚠ Hazard'], ['check', '✓ Safety check'], ['info', 'i Information']].map(([v, l]) => `<option value="${v}" ${p.icon === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
              <label>Risk <select data-scope="point" data-i="${i}" data-f="risk">
                ${RISKS.map((r) => `<option value="${r}" ${p.risk === r ? 'selected' : ''}>${r[0].toUpperCase() + r.slice(1)}</option>`).join('')}</select></label>
            </div>
            <label class="bld-sub">Description
              <textarea data-scope="point" data-i="${i}" data-f="body" placeholder="What's the hazard and why does it matter?">${esc(p.body)}</textarea></label>
            <label class="bld-sub">How to check <em>(one item per line)</em>
              <textarea data-scope="point" data-i="${i}" data-f="checklist" placeholder="e.g. Barrier in place and secure&#10;Warning sign visible">${esc((p.checklist || []).join('\n'))}</textarea></label>`}
        </div>`).join('')}
    </div>`;
  }

  async function fillModuleSelect() {
    const sel = panel.querySelector('[data-act="open-existing"]');
    if (!sel || sel.options.length > 1) return;
    try {
      for (const m of await listModules()) sel.append(new Option(m.title, m.file));
    } catch {}
  }

  // ------------------------------------------------------------ events

  panel.addEventListener('input', (e) => {
    const el = e.target;
    if (el.dataset.lib) {
      if (el.dataset.lib === 'q') libQuery = el.value; else { libCat = el.value; libQuery = ''; }
      const grid = panel.querySelector('.bld-lib-grid');
      if (grid) grid.innerHTML = renderLibraryGrid();
      if (el.dataset.lib === 'cat') { const q = panel.querySelector('[data-lib="q"]'); if (q) q.value = ''; }
      return;
    }
    const scope = el.dataset.scope;
    if (!scope) return;
    const st = step();
    const f = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || el.type === 'range' || el.type === 'radio') v = Number(v);
    if (scope === 'module') draft[f] = v;
    else if (scope === 'scene') {
      // Update the scene's label in place: re-rendering here would swallow the next click.
      draft.scenes[sceneId][f] = v;
      const chip = panel.querySelector('.bld-scene.on .bld-scene-pick span:nth-child(2)');
      if (chip) chip.textContent = v || sceneId;
    }
    else if (scope === 'step') {
      if (f === 'keepPlaying') {
        if (v) { delete st.videoTime; viewer.playVideo(); } else { viewer.pauseVideo(); st.videoTime = Math.round(viewer.videoTime * 100) / 100; }
        save(); render(); renderVideoBar(); return;
      }
      st[f] = v;
      if (f === 'scene') { delete st.videoTime; showScene(v); }
    } else if (scope === 'prop') {
      const p = points(st)[Number(el.dataset.i)];
      if (f === 'kind') {
        if (v) p.prop = { ...(p.prop?.kind === v ? p.prop : {}), kind: v, scale: p.prop?.scale ?? 1 };
        else delete p.prop;
        save(); render(); drawMarkers(); return;
      }
      p.prop[f] = v;
      const out = el.nextElementSibling;
      if (out?.tagName === 'OUTPUT') {
        out.textContent = f === 'rotate' ? `${v}°` : f === 'flat' ? (v > 0 ? `${v}°` : 'upright') : `${Math.round(v * 100)}%`;
      }
      drawMarkers();
    } else if (scope === 'opt') st.options[Number(el.dataset.i)] = v;
    else if (scope === 'point') {
      const p = points(st)[Number(el.dataset.i)];
      p[f] = f === 'checklist' ? v.split('\n') : v;
      if (f === 'radius') el.nextElementSibling.textContent = `${v}°`;
      if (f === 'radius' || f === 'icon' || f === 'title' || f === 'label') drawMarkers();
    }
    save();
  });

  panel.addEventListener('toggle', (e) => {
    if (e.target.classList?.contains('bld-lib')) libraryOpen = e.target.open;
    if (e.target.dataset?.adjust != null) { const k = Number(e.target.dataset.adjust); if (e.target.open) adjustOpen.add(k); else adjustOpen.delete(k); }
  }, true);
  panel.addEventListener('click', async (e) => {
    const hz = e.target.closest('[data-hz]');
    if (hz) {
      const h = HAZARDS.find((x) => x.id === hz.dataset.hz);
      armed = armed?.id === h.id ? null : h;
      panel.querySelectorAll('[data-hz]').forEach((b) => b.classList.toggle('armed', b.dataset.hz === armed?.id));
      if (armed) {
        toast(`Now tap the 360° view where the ${h.name.toLowerCase()} is`);
        if (window.matchMedia('(max-width: 760px)').matches) panel.classList.add('collapsed');
      }
      return;
    }
    const b = e.target.closest('[data-act]');
    if (!b || b.tagName === 'SELECT') return;
    const act = b.dataset.act;
    const i = Number(b.dataset.i);
    const st = step();
    const menu = panel.querySelector('.bld-menu');
    if (act !== 'menu') menu.hidden = true;
    switch (act) {
      case 'collapse': panel.classList.toggle('collapsed'); break;
      case 'menu': menu.hidden = !menu.hidden; break;
      case 'add-media': pendingFileScene = null; fileInput.click(); break;
      case 'reopen': pendingFileScene = b.dataset.id; fileInput.click(); break;
      case 'scene': await showScene(b.dataset.id); render(); break;
      case 'start-view':
        draft.scenes[sceneId].initialView = { yaw: Math.round(viewer.yaw), pitch: Math.round(viewer.pitch) };
        save(); toast('Learners will start facing this way'); break;
      case 'del-scene': {
        const used = draft.steps.filter((s) => s.scene === b.dataset.id).length;
        confirmBox(`Remove this scene${used ? ` and its ${used} step${used === 1 ? '' : 's'}` : ''}?`, 'Remove', () => {
          draft.steps = draft.steps.filter((s) => s.scene !== b.dataset.id);
          delete draft.scenes[b.dataset.id];
          save(); render(); showScene(Object.keys(draft.scenes)[0] || null);
        });
        break;
      }
      case 'add': addStep(b.dataset.type); break;
      case 'edit': editStep(i); break;
      case 'up': moveStep(i, -1); break;
      case 'down': moveStep(i, 1); break;
      case 'del': confirmBox(`Delete "${stepTitle(draft.steps[i])}"?`, 'Delete', () => { draft.steps.splice(i, 1); save(); render(); drawMarkers(); }); break;
      case 'done': editing = null; moving = null; adjustOpen.clear(); render(); drawMarkers(); renderVideoBar(); break;
      case 'add-opt': st.options.push(''); save(); render(); break;
      case 'look': viewer.lookAt(points(st)[i]); break;
      case 'move': moving = moving === i ? null : i; render(); drawMarkers(); if (moving != null) toast('Tap the view where it should go'); break;
      case 'del-point': points(st).splice(i, 1); moving = null; adjustOpen.clear(); save(); render(); drawMarkers(); break;
      case 'reset-prop': {
        const pr = points(st)[i].prop;
        points(st)[i].prop = { kind: pr.kind, ...(pr.opts ? { opts: pr.opts } : {}), scale: 1 };
        save(); render(); drawMarkers(); break;
      }
      case 'preview': startPreview(); break;
      case 'save': saveModule(); break;
      case 'open-json': jsonInput.click(); break;
      case 'new': confirmBox('Start a new module? The current one will be cleared from this browser (save it first if you need it).', 'Start new', () => {
        draft = emptyDraft(); editing = null; save(); render(); showScene(null); viewer.clearMarkers(); markers = [];
      }); break;
      case 'exit': location.hash = ''; location.href = location.pathname; break;
      default:
    }
  });
  panel.addEventListener('change', async (e) => {
    if (e.target.dataset.act !== 'open-existing' || !e.target.value) return;
    try { openModule(await loadModule(e.target.value)); } catch (err) { toast(err.message, 'bad', 6000); }
  });

  // ------------------------------------------------------------ preview & save

  function startPreview() {
    const problems = validateScenario(exportable());
    if (problems.length) { toast(`Fix ${problems.length} problem${problems.length === 1 ? '' : 's'} first (listed under the steps).`, 'bad', 5000); editing = null; render(); return; }
    panel.hidden = true;
    vbar.hidden = true;
    document.body.classList.remove('has-builder');
    markers.forEach((m) => viewer.removeMarker(m));
    markers = [];
    preview(playable(), async () => {
      panel.hidden = false;
      document.body.classList.add('has-builder');
      render();
      await showScene(sceneId);
    });
  }

  function saveModule() {
    const m = exportable();
    const problems = validateScenario(m);
    const json = `${JSON.stringify(m, null, 2)}\n`;
    const files = Object.values(draft.scenes).filter((s) => s.media.file).map((s) => s.media.file);
    const box = document.createElement('div');
    box.className = 'modal';
    box.innerHTML = `<div class="card modal-card bld-save" role="dialog" aria-modal="true" aria-labelledby="bld-save-title">
      <h2 id="bld-save-title">Save “${esc(m.title || 'Untitled module')}”</h2>
      ${problems.length ? `<div class="bld-problems"><strong>This module still has ${problems.length} problem${problems.length === 1 ? '' : 's'}.</strong> You can save it and fix them later.</div>` : ''}
      <p>Your work is kept in this browser automatically. To publish it for learners:</p>
      <ol>
        <li><button class="btn small" data-dl>Download ${esc(m.id)}.json</button> <button class="btn secondary small" data-copy>Copy</button></li>
        <li>On GitHub, upload it to the <code>scenarios/</code> folder${files.length ? `, and upload ${files.map((f) => `<code>${esc(f)}</code>`).join(', ')} to <code>media/${esc(m.id)}/</code>` : ''}.</li>
        <li>Add it to the home screen: in <code>scenarios/index.json</code> add <code>{ "file": "scenarios/${esc(m.id)}.json", "title": "${esc(m.title)}" }</code> to the list. Or just send the file to Claude to wire it up.</li>
      </ol>
      <div class="card-actions"><button class="btn secondary" data-close>Close</button></div></div>`;
    box.querySelector('[data-close]').onclick = () => box.remove();
    if (window.HQSCALE_NO_DOWNLOADS) box.querySelector('[data-dl]').hidden = true; // host blocks downloads; Copy still works
    box.querySelector('[data-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(json); toast('Module copied', 'good'); } catch { toast('Copy was blocked on this device', 'bad'); }
    };
    box.querySelector('[data-dl]').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
      a.download = `${m.id}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    document.body.append(box);
  }

  // ------------------------------------------------------------ boot

  render();
  if (sceneId) showScene(sceneId);
  else toast('Start by adding a 360° photo or video', '', 4000);
}
