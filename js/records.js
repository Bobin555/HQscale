// Turns raw training attempts into what the admin dashboard shows. No DOM here, so it's unit-tested.

/** A person is identified by their sign-in (or typed name when there's no sign-in). */
export const personKey = (a) => a.userId || `name:${(a.name || '').toLowerCase()}`;

/**
 * One row per person and module: their best completed attempt (highest score, then earliest),
 * or their latest attempt if they never finished.
 */
export function peopleRows(attempts) {
  const groups = new Map();
  for (const a of attempts) {
    const k = `${personKey(a)}|${a.moduleId}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(a);
  }
  const rows = [];
  for (const list of groups.values()) {
    const done = list.filter((a) => a.status === 'completed');
    const best = done.length
      ? done.reduce((b, a) => (a.score > b.score || (a.score === b.score && a.completedAt < b.completedAt) ? a : b))
      : list.reduce((b, a) => (a.startedAt > b.startedAt ? a : b));
    const latest = list.reduce((b, a) => (a.startedAt > b.startedAt ? a : b));
    rows.push({
      key: `${personKey(best)}|${best.moduleId}`,
      name: best.name || '', email: best.email || '', verified: !!best.verified,
      office: latest.office || best.office || '',
      moduleId: best.moduleId, moduleTitle: best.moduleTitle || best.moduleId,
      status: !done.length ? 'started' : best.passed ? 'passed' : 'failed',
      score: done.length ? best.score : null,
      completedAt: done.length ? best.completedAt : null,
      startedAt: list.reduce((m, a) => (a.startedAt < m ? a.startedAt : m), list[0].startedAt),
      lastActivity: list.reduce((m, a) => { const t = a.completedAt || a.startedAt; return t > m ? t : m; }, ''),
      durationSec: done.length ? best.durationSec : null,
      attempts: list.length,
      best, all: [...list].sort((x, y) => (x.startedAt < y.startedAt ? 1 : -1)),
    });
  }
  return rows;
}

/** Applies the dashboard filters to people rows. Dates are YYYY-MM-DD (local), inclusive. */
export function filterRows(rows, { moduleId = '', office = '', status = '', from = '', to = '', search = '' } = {}) {
  const q = search.trim().toLowerCase();
  const day = (iso) => {
    if (!iso) return '';
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  return rows.filter((r) => {
    if (moduleId && r.moduleId !== moduleId) return false;
    if (office && r.office !== office) return false;
    if (status === 'completed' && r.status === 'started') return false;
    if (status && status !== 'completed' && r.status !== status) return false;
    const when = day(r.completedAt || r.lastActivity);
    if (from && when < from) return false;
    if (to && when > to) return false;
    if (q && !`${r.name} ${r.email}`.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Headline numbers. People are counted once per module they took. */
export function summarize(rows) {
  const done = rows.filter((r) => r.status !== 'started');
  const passed = rows.filter((r) => r.status === 'passed');
  const avg = done.length ? Math.round(done.reduce((s, r) => s + r.score, 0) / done.length) : null;
  const byOffice = new Map();
  for (const r of rows) {
    const o = byOffice.get(r.office || 'Unknown') || { office: r.office || 'Unknown', started: 0, completed: 0, passed: 0, scoreSum: 0 };
    o.started++;
    if (r.status !== 'started') { o.completed++; o.scoreSum += r.score; }
    if (r.status === 'passed') o.passed++;
    byOffice.set(o.office, o);
  }
  const offices = [...byOffice.values()]
    .map((o) => ({ ...o, avg: o.completed ? Math.round(o.scoreSum / o.completed) : null }))
    .sort((a, b) => b.started - a.started || a.office.localeCompare(b.office));
  return { started: rows.length, completed: done.length, passed: passed.length, avg, offices };
}

const csvCell = (v) => {
  const s = v == null ? '' : String(v);
  // Quote, and stop spreadsheet formula injection from names like "=cmd".
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) || safe !== s ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function toCsv(rows) {
  const head = ['Name', 'Email', 'Verified sign-in', 'Office', 'Module', 'Status', 'Score %', 'Completed at', 'Time (min)', 'Attempts', 'First started'];
  const lines = rows.map((r) => [
    r.name, r.email, r.verified ? 'yes' : 'no', r.office, r.moduleTitle,
    { passed: 'Passed', failed: 'Not passed', started: 'Started, not finished' }[r.status],
    r.score ?? '', r.completedAt || '', r.durationSec != null ? (r.durationSec / 60).toFixed(1) : '', r.attempts, r.startedAt,
  ].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\r\n');
}
