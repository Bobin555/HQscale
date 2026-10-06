import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describeCoverage } from '../js/viewer.js';
import { validateScenario } from '../js/validate.js';

test('2:1 images are full spheres with no warnings', () => {
  assert.deepEqual(describeCoverage(5760, 2880), { hfov: 360, vfov: 180, warnings: [] });
});

test('wide phone panoramas become a 360° strip', () => {
  const c = describeCoverage(8000, 2000);
  assert.equal(c.hfov, 360);
  assert.equal(c.vfov, 90);
  assert.equal(c.warnings.length, 1);
});

test('narrow images are treated as partial views', () => {
  const c = describeCoverage(4000, 3000);
  assert.equal(c.vfov, 180);
  assert.equal(c.hfov, 240);
  assert.equal(c.warnings.length, 1);
});

test('explicit hfov/vfov in the scene win', () => {
  const c = describeCoverage(6000, 2000, { hfov: 180, vfov: 60 });
  assert.equal(c.hfov, 180);
  assert.equal(c.vfov, 60);
  assert.deepEqual(c.warnings, []);
});

test('the bundled module passes validation', () => {
  assert.deepEqual(validateScenario(JSON.parse(readFileSync(new URL('../scenarios/hq-induction.json', import.meta.url)))), []);
});

test('validation reports readable problems', () => {
  const problems = validateScenario({
    title: 'x',
    scenes: { a: { media: { type: 'image' } } },
    steps: [
      { type: 'quiz', scene: 'a', question: 'q', options: ['1', '2'], answer: 2 },
      { type: 'find', scene: 'missing', prompt: 'p', targets: [{ yaw: 400, pitch: 0 }] },
    ],
  });
  assert.equal(problems.length, 4);
  assert.match(problems.join('\n'), /needs a "src"/);
  assert.match(problems.join('\n'), /"answer" must be the position/);
  assert.match(problems.join('\n'), /unknown scene "missing"/);
  assert.match(problems.join('\n'), /"yaw" must be a number/);
});
