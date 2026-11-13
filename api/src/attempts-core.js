// Training results API: records when someone starts and finishes a module, and lets admins
// read the records. Plain logic with no Azure dependency, so it runs the same in Azure Functions,
// the local dev server and the tests.
//
//   GET  /api/health                 { ok: true, signedIn }
//   POST /api/attempts  { action: 'start', moduleId, moduleTitle, office, name?, device? }  → { attemptId }
//   POST /api/attempts  { action: 'complete', moduleId, attemptId, score, passed, correct, total,
//                         durationSec, answers: [{ title, correct, detail }] }               → { ok }
//   GET  /api/attempts?module=<id>   admins only                                          → { attempts }
//
// Who someone is comes from the sign-in (Azure Static Web Apps puts it in the
// x-ms-client-principal header), never from the request body, unless anonymous recording is
// switched on (local testing, or a deliberate no-sign-in setup), in which case the typed name is
// stored and marked as unverified.

import { randomUUID } from 'node:crypto';

const ADMIN_ROLE = 'admin';

/** Decodes the x-ms-client-principal header set by Azure Static Web Apps. */
export function readPrincipal(header) {
  if (!header) return null;
  try {
    const p = JSON.parse(Buffer.from(header, 'base64').toString('utf8'));
    if (!p || !p.userId) return null;
    const claim = (type) => (p.claims || []).find((c) => c.typ === type || c.type === type)?.val;
    return {
      id: String(p.userId),
      email: String(claim('preferred_username') || claim('email') || p.userDetails || ''),
      name: String(claim('name') || p.userDetails || ''),
      roles: Array.isArray(p.userRoles) ? p.userRoles.map(String) : [],
    };
  } catch {
    return null;
  }
}

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const fail = (status, error) => ({ status, body: { error } });

/**
 * Handles one API request.
 * @param {object} req  { method, route: 'health'|'attempts', query, body, principal }
 * @param {object} ctx  { store, now?: () => Date, allowAnonymous?: boolean, openAdmin?: boolean }
 */
export async function handle(req, ctx) {
  const { method, route, query = {}, body, principal } = req;
  const now = () => (ctx.now ? ctx.now() : new Date()).toISOString();

  if (route === 'health') return { status: 200, body: { ok: true, signedIn: !!principal } };
  if (route !== 'attempts') return fail(404, 'Not found');

  if (method === 'GET') {
    const isAdmin = principal?.roles.includes(ADMIN_ROLE) || ctx.openAdmin;
    if (!isAdmin) return fail(principal ? 403 : 401, 'Only admins can see training records.');
    const attempts = await ctx.store.list({ moduleId: text(query.module, 120) || undefined });
    attempts.sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)));
    return { status: 200, body: { attempts } };
  }

  if (method !== 'POST') return fail(405, 'Method not allowed');
  if (!body || typeof body !== 'object') return fail(400, 'Send the details as JSON.');

  // Who is this?
  let who;
  if (principal) {
    who = { userId: principal.id, name: principal.name || principal.email, email: principal.email, verified: true };
  } else if (ctx.allowAnonymous) {
    const name = text(body.name, 100);
    if (!name) return fail(400, 'Your name is needed to record your result.');
    who = { userId: `anon:${name.toLowerCase()}`, name, email: '', verified: false };
  } else {
    return fail(401, 'Sign in to record your result.');
  }

  const moduleId = text(body.moduleId, 120);
  if (!moduleId) return fail(400, 'moduleId is missing.');

  if (body.action === 'start') {
    const office = text(body.office, 100);
    if (!office) return fail(400, 'Choose your office.');
    const attempt = {
      id: randomUUID(),
      moduleId,
      moduleTitle: text(body.moduleTitle, 200) || moduleId,
      ...who,
      office,
      device: text(body.device, 30) || 'web',
      status: 'started',
      startedAt: now(),
    };
    await ctx.store.create(attempt);
    return { status: 201, body: { attemptId: attempt.id } };
  }

  if (body.action === 'complete') {
    const attempt = await ctx.store.get(moduleId, text(body.attemptId, 64));
    if (!attempt) return fail(404, 'That attempt was not found.');
    if (attempt.userId !== who.userId) return fail(403, 'You can only finish your own attempt.');
    if (attempt.status === 'completed') return { status: 200, body: { ok: true, alreadyRecorded: true } };
    const score = Number(body.score);
    const correct = Number(body.correct);
    const total = Number(body.total);
    if (!(score >= 0 && score <= 100)) return fail(400, 'score must be 0–100.');
    if (!(Number.isInteger(correct) && Number.isInteger(total) && correct >= 0 && total >= correct && total <= 500)) {
      return fail(400, 'correct and total must be whole numbers, with correct ≤ total.');
    }
    const answers = (Array.isArray(body.answers) ? body.answers : []).slice(0, 200).map((a) => ({
      title: text(a?.title, 200), correct: !!a?.correct, detail: text(a?.detail, 300),
    }));
    Object.assign(attempt, {
      status: 'completed',
      completedAt: now(),
      score: Math.round(score),
      passed: !!body.passed,
      correct,
      total,
      durationSec: Math.max(0, Math.round(Number(body.durationSec) || 0)),
      answers,
    });
    await ctx.store.update(attempt);
    return { status: 200, body: { ok: true } };
  }

  return fail(400, 'action must be "start" or "complete".');
}
