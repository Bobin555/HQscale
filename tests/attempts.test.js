import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle, readPrincipal } from '../api/src/attempts-core.js';
import { MemoryStore } from '../api/src/stores.js';

const header = (p) => Buffer.from(JSON.stringify(p)).toString('base64');
const sam = readPrincipal(header({ userId: 'u1', userDetails: 'sam@corp.example', userRoles: ['anonymous', 'authenticated'], claims: [{ typ: 'name', val: 'Sam Taylor' }] }));
const admin = readPrincipal(header({ userId: 'a1', userDetails: 'lead@corp.example', userRoles: ['authenticated', 'admin'] }));
const start = { action: 'start', moduleId: 'office-hq', moduleTitle: 'Office HQ', office: 'London' };
const finish = (attemptId) => ({ action: 'complete', moduleId: 'office-hq', attemptId, score: 80, passed: true, correct: 4, total: 5, durationSec: 312, answers: [{ title: 'Q1', correct: true, detail: 'ok' }] });

test('reads the signed-in user from the Static Web Apps header', () => {
  assert.deepEqual(sam, { id: 'u1', email: 'sam@corp.example', name: 'Sam Taylor', roles: ['anonymous', 'authenticated'] });
  assert.equal(readPrincipal('not base64 json'), null);
  assert.equal(readPrincipal(undefined), null);
});

test('a signed-in learner starts and completes; identity comes from the sign-in, not the body', async () => {
  const store = new MemoryStore();
  const ctx = { store, now: () => new Date('2026-11-13T10:00:00Z') };
  const s = await handle({ method: 'POST', route: 'attempts', body: { ...start, name: 'Someone Else' }, principal: sam }, ctx);
  assert.equal(s.status, 201);
  const c = await handle({ method: 'POST', route: 'attempts', body: finish(s.body.attemptId), principal: sam }, ctx);
  assert.equal(c.status, 200);
  const [row] = await store.list();
  assert.equal(row.name, 'Sam Taylor');
  assert.equal(row.email, 'sam@corp.example');
  assert.equal(row.verified, true);
  assert.equal(row.office, 'London');
  assert.equal(row.status, 'completed');
  assert.equal(row.score, 80);
  assert.equal(row.completedAt, '2026-11-13T10:00:00.000Z');
});

test('only admins can read records', async () => {
  const ctx = { store: new MemoryStore() };
  assert.equal((await handle({ method: 'GET', route: 'attempts', principal: null }, ctx)).status, 401);
  assert.equal((await handle({ method: 'GET', route: 'attempts', principal: sam }, ctx)).status, 403);
  assert.equal((await handle({ method: 'GET', route: 'attempts', principal: admin }, ctx)).status, 200);
});

test('nobody can complete someone else\'s attempt', async () => {
  const ctx = { store: new MemoryStore() };
  const s = await handle({ method: 'POST', route: 'attempts', body: start, principal: sam }, ctx);
  const other = readPrincipal(header({ userId: 'u2', userDetails: 'x@corp.example', userRoles: [] }));
  assert.equal((await handle({ method: 'POST', route: 'attempts', body: finish(s.body.attemptId), principal: other }, ctx)).status, 403);
});

test('without sign-in, recording is refused unless anonymous recording is switched on', async () => {
  const store = new MemoryStore();
  assert.equal((await handle({ method: 'POST', route: 'attempts', body: start, principal: null }, { store })).status, 401);
  const r = await handle({ method: 'POST', route: 'attempts', body: { ...start, name: 'Pat' }, principal: null }, { store, allowAnonymous: true });
  assert.equal(r.status, 201);
  const [row] = await store.list();
  assert.equal(row.verified, false);
  assert.equal(row.name, 'Pat');
});

test('rejects bad input with readable messages', async () => {
  const ctx = { store: new MemoryStore() };
  assert.match((await handle({ method: 'POST', route: 'attempts', body: { ...start, office: '' }, principal: sam }, ctx)).body.error, /office/);
  const s = await handle({ method: 'POST', route: 'attempts', body: start, principal: sam }, ctx);
  assert.equal((await handle({ method: 'POST', route: 'attempts', body: { ...finish(s.body.attemptId), score: 140 }, principal: sam }, ctx)).status, 400);
  assert.equal((await handle({ method: 'POST', route: 'attempts', body: { ...finish(s.body.attemptId), correct: 6, total: 5 }, principal: sam }, ctx)).status, 400);
  assert.equal((await handle({ method: 'POST', route: 'attempts', body: { action: 'nope', moduleId: 'm' }, principal: sam }, ctx)).status, 400);
});
