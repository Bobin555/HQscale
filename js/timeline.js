// A video timeline you can click or drag through. Used by the builder (with trim handles and
// pins for each step's moment) and by learners in "Watch video" steps.
//
//   const tl = createTimeline({ min, max, get, onSeek, trim?, pins?, limit? });
//   container.append(tl.el); tl.update();
//
//   min / max      seconds the track covers
//   get()          current time
//   onSeek(t)      called while clicking / dragging the track (async is fine; calls are coalesced)
//   trim           { start, end, onChange(start, end, done, 'start'|'end') }: draggable start/end handles
//   pins()         [{ t, label, active, title }]: markers that jump to their time when clicked
//   limit()        furthest time the learner may seek to (e.g. what they have watched so far)

import { fmtTime } from './viewer.js';

export function createTimeline({ min, max, get, onSeek, trim = null, pins = null, limit = null }) {
  const el = document.createElement('div');
  el.className = 'tl';
  el.innerHTML = `
    <div class="tl-track" tabindex="0" role="slider" aria-label="Video position" aria-valuemin="${min}" aria-valuemax="${max}">
      <div class="tl-rail"></div>
      ${trim ? '<div class="tl-out tl-out-l"></div><div class="tl-out tl-out-r"></div>' : ''}
      ${limit ? '<div class="tl-locked"></div>' : ''}
      <div class="tl-fill"></div>
      <div class="tl-pins"></div>
      <div class="tl-head"></div>
      ${trim ? '<div class="tl-h tl-h-start" data-h="start" title="Drag to set where the clip starts"></div><div class="tl-h tl-h-end" data-h="end" title="Drag to set where the clip ends"></div>' : ''}
      <div class="tl-tip" hidden></div>
    </div>`;
  const track = el.querySelector('.tl-track');
  const $ = (s) => el.querySelector(s);
  const span = () => Math.max(0.001, max - min);
  const pct = (t) => `${(100 * (Math.min(max, Math.max(min, t)) - min)) / span()}%`;
  const timeAt = (clientX) => {
    const r = track.getBoundingClientRect();
    return min + Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * span();
  };
  const clampToAllowed = (t) => {
    let lo = min, hi = max;
    if (trim) { lo = trim.start ?? min; hi = trim.end ?? max; }
    if (limit) hi = Math.min(hi, limit());
    return Math.min(hi, Math.max(lo, t));
  };

  // Coalesce seeks: while one is in progress, only the latest request is kept.
  let seeking = false, pending = null;
  const seek = async (t) => {
    pending = t;
    if (seeking) return;
    seeking = true;
    while (pending != null) {
      const next = pending;
      pending = null;
      await onSeek(next);
      update();
    }
    seeking = false;
  };

  function update() {
    const t = get();
    $('.tl-fill').style.width = pct(t);
    $('.tl-head').style.left = pct(t);
    track.setAttribute('aria-valuenow', t.toFixed(1));
    track.setAttribute('aria-valuetext', fmtTime(t));
    if (trim) {
      const s = trim.start ?? min, e = trim.end ?? max;
      $('.tl-out-l').style.width = pct(s);
      $('.tl-out-r').style.left = pct(e);
      $('.tl-h-start').style.left = pct(s);
      $('.tl-h-end').style.left = pct(e);
    }
    if (limit) $('.tl-locked').style.left = pct(limit());
    if (pins) {
      $('.tl-pins').innerHTML = pins().map((p) => `<button class="tl-pin${p.active ? ' on' : ''}" style="left:${pct(p.t)}" data-t="${p.t}" title="${p.title || ''}">${p.label}</button>`).join('');
    }
  }

  const tip = $('.tl-tip');
  const showTip = (t, x) => {
    tip.hidden = false;
    tip.textContent = fmtTime(t);
    tip.style.left = pct(t);
  };

  track.addEventListener('pointerdown', (e) => {
    const pin = e.target.closest('.tl-pin');
    if (pin) { e.preventDefault(); seek(clampToAllowed(Number(pin.dataset.t))); return; }
    e.preventDefault();
    track.setPointerCapture(e.pointerId);
    track.focus({ preventScroll: true });
    const handle = e.target.dataset.h;
    const move = (ev) => {
      const t = timeAt(ev.clientX);
      if (handle) {
        const s = trim.start ?? min, en = trim.end ?? max;
        if (handle === 'start') trim.start = Math.round(Math.min(t, en - 0.5) * 100) / 100;
        else trim.end = Math.round(Math.max(t, s + 0.5) * 100) / 100;
        trim.onChange(trim.start, trim.end, false, handle);
        showTip(handle === 'start' ? trim.start : trim.end);
        update();
      } else {
        const ct = clampToAllowed(t);
        showTip(ct);
        $('.tl-fill').style.width = pct(ct);
        $('.tl-head').style.left = pct(ct);
        seek(ct);
      }
    };
    const up = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', up);
      track.removeEventListener('pointercancel', up);
      tip.hidden = true;
      if (handle) trim.onChange(trim.start, trim.end, true, handle);
    };
    track.addEventListener('pointermove', move);
    track.addEventListener('pointerup', up);
    track.addEventListener('pointercancel', up);
    move(e);
  });

  track.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      seek(clampToAllowed(get() + (e.key === 'ArrowRight' ? step : -step)));
    }
  });

  return { el, update, set range([a, b]) { min = a; max = b; update(); } };
}
