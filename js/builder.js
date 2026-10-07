// Module builder: lets HR / HSE officers create a training module without editing JSON.
// Open a 360° photo or video, tap where hazards and objects are, write questions, preview the
// module as a learner, then save it as a module file.
//
// Media files picked from the computer are only referenced by name in the module
// ("media/<module-id>/<file>"); while building, they're shown from a local blob URL.

import { validateScenario } from './validate.js';

const DRAFT_KEY = 'hqscale.builder.draft';
const STEP_INFO = {
  explore: { icon: '⚠', name: 'Hazard spots', help: 'Learners tap markers to learn about hazards and how to check them.' },
  find: { icon: '🎯', name: 'Find task', help: 'Learners look around and tap the right thing.' },
  quiz: { icon: '❓', name: 'Question', help: 'A multiple-choice question shown over the scene.' },
  info: { icon: '💬', name: 'Message', help: 'A short message, e.g. a welcome or instructions.' },
};
const RISKS = ['high', 'medium', 'low', 'info'];

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

  document.body.classList.add('has-builder');
  const panel = document.createElement('aside');
  panel.className = 'builder';
  panel.setAttribute('aria-label', 'Module builder');
  document.body.append(panel);
  const fileInput = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*,video/*', hidden: true });
  const jsonInput = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json', hidden: true });
  document.body.append(fileInput, jsonInput);
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
    const info = await loadScene({ scenes: { [id]: sc } }, id);
    const missing = !info && (draft.scenes[id].media.file && !localUrls[id]);
    if (missing) toast(`Open "${draft.scenes[id].media.file}" again to see this scene (files aren't kept after the page is closed).`, 'bad', 6000);
    else if (info?.warnings?.length) toast(info.warnings[0], 'bad', 7000);
    drawMarkers();
  }

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

  function drawMarkers() {
    markers.forEach((m) => viewer.removeMarker(m));
    markers = [];
    const st = step();
    const list = st ? [[st, editing]] : draft.steps.map((s, i) => [s, i]).filter(([s]) => s.scene === sceneId);
    for (const [s, si] of list) {
      (points(s) || []).forEach((p, pi) => {
        const el = document.createElement('div');
        const isFind = s.type === 'find';
        el.className = `bld-point ${isFind ? 'find' : `hz ${p.icon || 'hazard'}`}${st ? '' : ' faded'}${moving === pi && st ? ' moving' : ''}`;
        el.dataset.r = isFind ? (p.radius ?? 8) : 0;
        const label = isFind ? p.label : p.title;
        el.innerHTML = `${isFind ? '' : `<span class="dot">${{ hazard: '⚠', check: '✓', info: 'i' }[p.icon || 'hazard']}</span>`}<span class="tag">${pi + 1}. ${esc(label || (isFind ? 'Target' : 'Hazard'))}</span>`;
        el.onclick = () => { if (!st) editStep(si); else panel.querySelector(`[data-point="${pi}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); };
        markers.push(viewer.addMarker({ yaw: p.yaw, pitch: p.pitch, el }));
      });
    }
    sizeMarkers();
  }
  function sizeMarkers() {
    const pxPerDeg = viewer.height / viewer.fov;
    for (const m of markers) {
      const r = Number(m.el.dataset.r);
      if (!r) continue;
      const d = 2 * r * pxPerDeg;
      Object.assign(m.el.style, { width: `${d}px`, height: `${d}px`, marginLeft: `${-d / 2}px`, marginTop: `${-d / 2}px` });
    }
  }
  viewer.onViewChange(sizeMarkers);

  viewer.onTap(({ yaw, pitch }) => {
    if (panel.hidden) return;
    const p = { yaw: Math.round(yaw), pitch: Math.round(pitch) };
    const st = step();
    const list = points(st);
    if (!list) {
      toast(draft.steps.length ? 'Choose a "Hazard spots" or "Find task" step, then tap the view to place things.' : 'Add a "Hazard spots" or "Find task" step first, then tap the view to place things.');
      return;
    }
    if (st.scene !== sceneId) { toast('This step belongs to another scene.', 'bad'); return; }
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
    draft.steps.push({ ...base, ...defaults[type] });
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
    else drawMarkers();
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
      ${body}
      <div class="bld-editor-foot"><button class="btn small" data-act="done">Done</button></div>`;
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
    const scope = el.dataset.scope;
    if (!scope) return;
    const st = step();
    const f = el.dataset.f;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.type === 'number' || el.type === 'range' || el.type === 'radio') v = Number(v);
    if (scope === 'module') draft[f] = v;
    else if (scope === 'scene') draft.scenes[sceneId][f] = v;
    else if (scope === 'step') {
      st[f] = v;
      if (f === 'scene') { showScene(v); }
    } else if (scope === 'opt') st.options[Number(el.dataset.i)] = v;
    else if (scope === 'point') {
      const p = points(st)[Number(el.dataset.i)];
      p[f] = f === 'checklist' ? v.split('\n') : v;
      if (f === 'radius') el.nextElementSibling.textContent = `${v}°`;
      if (f === 'radius' || f === 'icon' || f === 'title' || f === 'label') drawMarkers();
    }
    save();
  });
  panel.addEventListener('change', (e) => { if (e.target.dataset.scope === 'module' || e.target.dataset.scope === 'scene') render(); });

  panel.addEventListener('click', async (e) => {
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
      case 'done': editing = null; moving = null; render(); drawMarkers(); break;
      case 'add-opt': st.options.push(''); save(); render(); break;
      case 'look': viewer.lookAt(points(st)[i]); break;
      case 'move': moving = moving === i ? null : i; render(); drawMarkers(); if (moving != null) toast('Tap the view where it should go'); break;
      case 'del-point': points(st).splice(i, 1); moving = null; save(); render(); drawMarkers(); break;
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
