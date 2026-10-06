// Checks a training module (scenario JSON) for mistakes. Used by the app when a module loads,
// and by `npm run validate`, which additionally checks that media files exist.
// Returns a list of human-readable problems; an empty list means the module is OK.

const VALID_STEP_TYPES = ['info', 'find', 'quiz', 'explore'];
const VALID_MEDIA_TYPES = ['image', 'video', 'placeholder'];

export function validateScenario(s) {
  const problems = [];
  const add = (where, msg) => problems.push(`${where}: ${msg}`);
  if (!s || typeof s !== 'object') return ['the file is not a JSON object'];
  if (!s.title) add('module', 'needs a "title"');
  if (!s.scenes || typeof s.scenes !== 'object' || !Object.keys(s.scenes).length) add('module', 'needs at least one scene in "scenes"');
  if (!Array.isArray(s.steps) || !s.steps.length) add('module', 'needs at least one step in "steps"');
  if (s.passMark != null && !(s.passMark >= 0 && s.passMark <= 1)) add('module', '"passMark" must be between 0 and 1 (e.g. 0.8 for 80%)');

  for (const [id, scene] of Object.entries(s.scenes || {})) {
    const where = `scene "${id}"`;
    const m = scene?.media;
    if (!m) { add(where, 'needs "media"'); continue; }
    if (m.type === 'splat') add(where, 'Gaussian splat scenes are not supported yet');
    else if (!VALID_MEDIA_TYPES.includes(m.type)) add(where, `media "type" must be one of ${VALID_MEDIA_TYPES.join(', ')}`);
    if ((m.type === 'image' || m.type === 'video') && !m.src) add(where, 'media needs a "src" (e.g. "media/site/reception.jpg")');
    if (m.hfov != null && !(m.hfov > 0 && m.hfov <= 360)) add(where, 'media "hfov" must be between 1 and 360');
    if (m.vfov != null && !(m.vfov > 0 && m.vfov <= 180)) add(where, 'media "vfov" must be between 1 and 180');
    if (scene.initialView) checkPosition(scene.initialView, `${where} initialView`, add);
  }

  (s.steps || []).forEach((st, i) => {
    const where = `step ${i + 1}${st?.title ? ` ("${st.title}")` : ''}`;
    if (!VALID_STEP_TYPES.includes(st?.type)) { add(where, `"type" must be one of ${VALID_STEP_TYPES.join(', ')}`); return; }
    if (!s.scenes?.[st.scene]) add(where, `unknown scene "${st.scene}"`);
    if (st.type === 'info' && !st.title && !st.body) add(where, 'info step needs a "title" or "body"');
    if (st.type === 'find') {
      if (!st.prompt) add(where, 'find step needs a "prompt" telling people what to find');
      if (!st.targets?.length) add(where, 'find step needs at least one entry in "targets"');
      (st.targets || []).forEach((t, j) => {
        checkPosition(t, `${where} target ${j + 1}`, add);
        if (t.radius != null && !(t.radius > 0 && t.radius <= 90)) add(`${where} target ${j + 1}`, '"radius" must be between 1 and 90 degrees');
      });
      if (st.maxAttempts != null && !(st.maxAttempts >= 1)) add(where, '"maxAttempts" must be 1 or more');
    }
    if (st.type === 'quiz') {
      if (!st.question) add(where, 'quiz step needs a "question"');
      if (!Array.isArray(st.options) || st.options.length < 2) add(where, 'quiz step needs at least 2 "options"');
      else if (!(Number.isInteger(st.answer) && st.answer >= 0 && st.answer < st.options.length)) {
        add(where, `"answer" must be the position of the correct option, counting from 0 (0 to ${st.options.length - 1})`);
      }
    }
    if (st.type === 'explore') {
      if (!st.hotspots?.length) add(where, 'explore step needs at least one entry in "hotspots"');
      (st.hotspots || []).forEach((h, j) => {
        checkPosition(h, `${where} hotspot ${j + 1}`, add);
        if (!h.title) add(`${where} hotspot ${j + 1}`, 'needs a "title"');
      });
    }
  });
  return problems;
}

function checkPosition(p, where, add) {
  if (!(typeof p.yaw === 'number' && p.yaw >= -180 && p.yaw <= 180)) add(where, '"yaw" must be a number from -180 to 180');
  if (!(typeof p.pitch === 'number' && p.pitch >= -90 && p.pitch <= 90)) add(where, '"pitch" must be a number from -90 to 90');
}
