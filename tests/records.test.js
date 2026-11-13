import { test } from 'node:test';
import assert from 'node:assert/strict';
import { peopleRows, filterRows, summarize, toCsv } from '../js/records.js';

const a = (o) => ({ moduleId: 'm1', moduleTitle: 'HQ', office: 'London', verified: true, status: 'started', startedAt: '2026-11-01T09:00:00Z', ...o });
const data = [
  a({ id: '1', userId: 'u1', name: 'Ann', status: 'completed', score: 60, passed: false, completedAt: '2026-11-01T09:10:00Z' }),
  a({ id: '2', userId: 'u1', name: 'Ann', startedAt: '2026-11-02T09:00:00Z', status: 'completed', score: 90, passed: true, completedAt: '2026-11-02T09:08:00Z' }),
  a({ id: '3', userId: 'u2', name: 'Bob', office: 'Leeds' }),
  a({ id: '4', userId: 'u3', name: '=Eve', office: 'Leeds', status: 'completed', score: 100, passed: true, completedAt: '2026-11-03T10:00:00Z' }),
];

test('one row per person and module, keeping the best result', () => {
  const rows = peopleRows(data);
  assert.equal(rows.length, 3);
  const ann = rows.find((r) => r.name === 'Ann');
  assert.equal(ann.score, 90);
  assert.equal(ann.status, 'passed');
  assert.equal(ann.attempts, 2);
  assert.equal(rows.find((r) => r.name === 'Bob').status, 'started');
});

test('summary counts started, completed, passed and by office', () => {
  const s = summarize(peopleRows(data));
  assert.deepEqual([s.started, s.completed, s.passed, s.avg], [3, 2, 2, 95]);
  const leeds = s.offices.find((o) => o.office === 'Leeds');
  assert.deepEqual([leeds.started, leeds.completed, leeds.avg], [2, 1, 100]);
});

test('filters by office, status, date and search', () => {
  const rows = peopleRows(data);
  assert.equal(filterRows(rows, { office: 'Leeds' }).length, 2);
  assert.equal(filterRows(rows, { status: 'completed' }).length, 2);
  assert.equal(filterRows(rows, { status: 'started' }).length, 1);
  assert.equal(filterRows(rows, { from: '2026-11-03' }).length, 1);
  assert.equal(filterRows(rows, { search: 'ann' }).length, 1);
});

test('CSV is safe to open in Excel', () => {
  const csv = toCsv(peopleRows(data));
  assert.match(csv, /^Name,Email/);
  assert.match(csv, /"'=Eve"/);
});
