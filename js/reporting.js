// Sends training results to the results API (api/), so admins can see who has started and
// completed which module, with office, score and date. On sites without the API (GitHub Pages,
// the single-file build) it switches itself off and the app works as before.
//
// If a learner is offline when they finish, the result is kept on the device and sent the next
// time they open the training.

const QUEUE_KEY = 'hqscale.pendingResults';

async function getJson(url, { timeout = 4000, ...opts } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...opts, signal: ctl.signal });
    const body = await res.json().catch(() => ({}));
    return { ok: res.ok, status: res.status, body };
  } finally {
    clearTimeout(t);
  }
}

const post = (body) => getJson('api/attempts', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), timeout: 10000 });

export class Reporter {
  constructor() {
    this.enabled = false; // the site has the results API
    this.user = null; // { name, email, roles } when signed in (Azure Static Web Apps)
  }

  /** Finds out whether results can be recorded here, and who is signed in. */
  async init() {
    if (!/^https?:$/.test(location.protocol) || window.HQSCALE_EMBED) return this;
    try {
      const h = await getJson('api/health');
      this.enabled = h.ok && h.body?.ok === true;
    } catch {
      this.enabled = false;
    }
    if (!this.enabled) return this;
    try {
      const me = (await getJson('/.auth/me')).body?.clientPrincipal;
      if (me) this.user = { name: me.userDetails, email: me.userDetails, roles: me.userRoles || [] };
    } catch {}
    this.flush();
    return this;
  }

  get isAdmin() { return !!this.user?.roles.includes('admin'); }

  /** Records that a module was started. Returns a handle used when it's finished. */
  start(details) {
    const handle = { details, attemptId: null };
    handle.ready = post({ action: 'start', ...details })
      .then((r) => { if (r.ok) handle.attemptId = r.body.attemptId; else handle.error = r.body?.error || `Error ${r.status}`; })
      .catch(() => { handle.offline = true; });
    return handle;
  }

  /**
   * Records the result. Resolves to { state: 'recorded' | 'queued' | 'failed', message? }.
   * 'queued' means the device was offline; it's sent automatically later.
   */
  async complete(handle, result) {
    await handle.ready;
    const item = { details: handle.details, attemptId: handle.attemptId, result };
    try {
      const r = await this.#send(item);
      return r.ok ? { state: 'recorded' } : { state: 'failed', message: r.body?.error || handle.error || `Error ${r.status}` };
    } catch {
      this.#queue(item);
      return { state: 'queued' };
    }
  }

  async #send(item) {
    if (!item.attemptId) {
      const s = await post({ action: 'start', ...item.details });
      if (!s.ok) return s;
      item.attemptId = s.body.attemptId;
    }
    return post({ action: 'complete', moduleId: item.details.moduleId, name: item.details.name, attemptId: item.attemptId, ...item.result });
  }

  #queue(item) {
    try {
      const q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]');
      q.push(item);
      localStorage.setItem(QUEUE_KEY, JSON.stringify(q.slice(-20)));
    } catch {}
  }

  /** Sends results that were kept while offline. */
  async flush() {
    let q;
    try { q = JSON.parse(localStorage.getItem(QUEUE_KEY) || '[]'); } catch { return; }
    if (!q.length) return;
    const left = [];
    for (const item of q) {
      try { await this.#send(item); } catch { left.push(item); }
    }
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(left)); } catch {}
  }
}
