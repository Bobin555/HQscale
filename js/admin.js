// Training records dashboard: who has started and completed each module, their office,
// score and when. Reads /api/attempts (admins only, enforced by the API and staticwebapp.config.json).

import { peopleRows, filterRows, summarize, toCsv } from './records.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtDate = (iso) => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const fmtMin = (sec) => (sec == null ? '' : sec < 60 ? `${sec}s` : `${Math.round(sec / 60)} min`);
const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '–');
const STATUS = { passed: ['✓', 'Passed'], failed: ['✕', 'Not passed'], started: ['…', 'Not finished'] };

let all = []; // people rows
let sort = { key: 'lastActivity', dir: -1 };
const open = new Set();

const filters = () => ({
  moduleId: $('#f-module').value, office: $('#f-office').value, status: $('#f-status').value,
  from: $('#f-from').value, to: $('#f-to').value, search: $('#f-search').value,
});

function notice(html, bad = false) {
  const n = $('#notice');
  n.hidden = !html;
  n.className = `notice${bad ? ' bad' : ''}`;
  n.innerHTML = html || '';
}

async function load() {
  notice('');
  let res;
  try {
    res = await fetch('api/attempts', { cache: 'no-store', credentials: 'same-origin' });
  } catch {
    return notice("Couldn't reach the results service. Check your connection and press Refresh.", true);
  }
  if (res.status === 401 || res.status === 403) {
    $('#people-body').innerHTML = '';
    return notice('This page is for training admins. <a href="/.auth/login/aad?post_login_redirect_uri=/admin.html">Sign in</a> with an admin account, or ask IT to give you the <strong>admin</strong> role.', true);
  }
  if (!res.ok) return notice(`The results service returned an error (${res.status}).`, true);
  const { attempts = [] } = await res.json();
  all = peopleRows(attempts);
  fillSelect($('#f-module'), [...new Map(all.map((r) => [r.moduleId, r.moduleTitle])).entries()]);
  fillSelect($('#f-office'), [...new Set(all.map((r) => r.office).filter(Boolean))].sort().map((o) => [o, o]));
  if (!attempts.length) notice('No one has started a module yet. Results appear here as soon as people begin the training.');
  render();
}

function fillSelect(sel, pairs) {
  const keep = sel.value;
  sel.length = 1;
  for (const [v, label] of pairs) sel.append(new Option(label, v));
  sel.value = pairs.some(([v]) => v === keep) ? keep : '';
}

function render() {
  const rows = filterRows(all, filters());
  const s = summarize(rows);
  $('#t-started').textContent = s.started;
  $('#t-completed').textContent = s.completed;
  $('#t-completed-sub').textContent = s.started ? `${pct(s.completed, s.started)} of those who started` : ' ';
  $('#t-passed').textContent = s.passed;
  $('#t-passed-sub').textContent = s.completed ? `${pct(s.passed, s.completed)} of those who completed` : ' ';
  $('#t-avg').textContent = s.avg == null ? '–' : `${s.avg}%`;
  renderOffices(s.offices);
  renderTable(rows);
}

function renderOffices(offices) {
  const box = $('#office-bars');
  if (!offices.length) { box.innerHTML = '<p class="muted">No records for these filters.</p>'; return; }
  const max = Math.max(...offices.map((o) => o.started));
  box.innerHTML = offices.map((o, i) => `
    <div class="bar-row" tabindex="0" data-i="${i}" aria-label="${esc(o.office)}: ${o.completed} of ${o.started} completed">
      <span class="name">${esc(o.office)}</span>
      <span class="track" style="width:${(o.started / max) * 100}%"><span class="fill" style="width:${(o.completed / o.started) * 100}%"></span></span>
      <span class="val">${o.completed} of ${o.started} completed${o.avg != null ? ` · avg ${o.avg}%` : ''}</span>
    </div>`).join('');
  const tip = $('#tip');
  const show = (el, x, y) => {
    const o = offices[el.dataset.i];
    tip.innerHTML = `<strong>${esc(o.office)}</strong><br>Started: ${o.started}<br>Completed: ${o.completed} (${pct(o.completed, o.started)})<br>Passed: ${o.passed}${o.avg != null ? `<br>Average score: ${o.avg}%` : ''}`;
    tip.hidden = false;
    const w = tip.offsetWidth;
    tip.style.left = `${Math.min(x + 14, innerWidth - w - 8)}px`;
    tip.style.top = `${y + 14}px`;
  };
  box.querySelectorAll('.bar-row').forEach((el) => {
    el.onmousemove = (e) => show(el, e.clientX, e.clientY);
    el.onfocus = () => { const r = el.getBoundingClientRect(); show(el, r.left + r.width / 2, r.bottom - 10); };
    el.onmouseleave = el.onblur = () => { tip.hidden = true; };
  });
}

const COLUMNS = [
  ['name', 'Name'], ['email', 'Email'], ['office', 'Office'], ['moduleTitle', 'Module'], ['status', 'Status'],
  ['score', 'Score', 'num'], ['completedAt', 'Completed'], ['durationSec', 'Time', 'num'], ['attempts', 'Attempts', 'num'],
];

function renderTable(rows) {
  $('#people-head').innerHTML = COLUMNS.map(([k, label, cls]) =>
    `<th data-k="${k}" class="${cls || ''}" ${sort.key === k ? `aria-sort="${sort.dir > 0 ? 'ascending' : 'descending'}"` : ''} tabindex="0">${label}</th>`).join('');
  $('#people-head').querySelectorAll('th').forEach((th) => {
    th.onclick = th.onkeydown = (e) => {
      if (e.type === 'keydown' && e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault?.();
      sort = { key: th.dataset.k, dir: sort.key === th.dataset.k ? -sort.dir : 1 };
      render();
    };
  });
  const val = (r) => r[sort.key] ?? (sort.key === 'score' || sort.key === 'durationSec' ? -1 : '');
  rows.sort((a, b) => {
    const x = val(a), y = val(b);
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y))) * sort.dir;
  });
  $('#people-count').textContent = `${rows.length} ${rows.length === 1 ? 'row' : 'rows'}`;
  if (!rows.length) { $('#people-body').innerHTML = '<tr><td colspan="9" class="muted">No one matches these filters.</td></tr>'; return; }
  $('#people-body').innerHTML = rows.map((r) => {
    const [icon, label] = STATUS[r.status];
    const row = `<tr data-key="${esc(r.key)}" aria-expanded="${open.has(r.key)}">
      <td>${esc(r.name)}${r.verified ? '' : '<span class="tag" title="Typed name, not a verified sign-in">unverified</span>'}</td>
      <td>${esc(r.email)}</td><td>${esc(r.office)}</td><td>${esc(r.moduleTitle)}</td>
      <td><span class="status ${r.status}">${icon} ${label}</span></td>
      <td class="num">${r.score == null ? '' : `${r.score}%`}</td>
      <td>${esc(fmtDate(r.completedAt))}</td>
      <td class="num">${fmtMin(r.durationSec)}</td>
      <td class="num">${r.attempts}</td></tr>`;
    return open.has(r.key) ? row + detail(r) : row;
  }).join('');
  $('#people-body').querySelectorAll('tr[data-key]').forEach((tr) => {
    tr.onclick = () => { open.has(tr.dataset.key) ? open.delete(tr.dataset.key) : open.add(tr.dataset.key); render(); };
  });
}

function detail(r) {
  const answers = r.best.answers?.length
    ? `<ul>${r.best.answers.map((a) => `<li class="${a.correct ? '' : 'bad'}">${a.correct ? '✓' : '✕'} ${esc(a.title)}${a.detail ? ` <span class="muted">— ${esc(a.detail)}</span>` : ''}</li>`).join('')}</ul>`
    : '<p class="muted">No answers recorded (not finished).</p>';
  const attempts = r.all.map((a) => `<li>${esc(fmtDate(a.startedAt))} · ${a.status === 'completed' ? `${a.score}% ${a.passed ? 'passed' : 'not passed'}` : 'not finished'} · ${esc(a.office)} · ${esc(a.device || '')}</li>`).join('');
  return `<tr class="detail"><td colspan="9">
    <strong>Answers${r.status === 'started' ? '' : ' (best attempt)'}</strong>${answers}
    <strong>All attempts</strong><ul>${attempts}</ul></td></tr>`;
}

function downloadCsv() {
  const rows = filterRows(all, filters());
  const blob = new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `training-records-${new Date().toISOString().slice(0, 10)}.csv` });
  document.body.append(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

for (const id of ['#f-module', '#f-office', '#f-status', '#f-from', '#f-to']) $(id).addEventListener('change', render);
$('#f-search').addEventListener('input', render);
$('#btn-refresh').onclick = load;
$('#btn-csv').onclick = downloadCsv;

fetch('/.auth/me', { cache: 'no-store' }).then((r) => r.json()).then((d) => {
  const p = d?.clientPrincipal;
  $('#who').innerHTML = p ? `Signed in as ${esc(p.userDetails)} · <a href="./">Training</a> · <a href="/.auth/logout">Sign out</a>` : '<a href="./">Back to training</a>';
}).catch(() => { $('#who').innerHTML = '<a href="./">Back to training</a>'; });

load();
