import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formLink, isFormTemplate, formDate } from '../js/forms.js';

const tpl = 'https://forms.office.com/Pages/ResponsePage.aspx?id=AbC123&r1a=NAME&r2b=%7BOffice%7D&r3c=MODULE&r4d=SCORE&r5e=RESULT&r6f=COMPLETED&r7g=keep';

test('recognises a pre-filled template', () => {
  assert.equal(isFormTemplate(tpl), true);
  assert.equal(isFormTemplate('https://forms.office.com/r/abc'), false);
  assert.equal(isFormTemplate(''), false);
});

test('fills in the learner details and leaves other answers alone', () => {
  const u = new URL(formLink(tpl, { NAME: 'Sam O\'Neil & Co', OFFICE: 'London', MODULE: 'HQ Site Induction', SCORE: 90, RESULT: 'Passed', COMPLETED: '2026-11-16 14:05' }));
  assert.equal(u.searchParams.get('id'), 'AbC123');
  assert.equal(u.searchParams.get('r1a'), 'Sam O\'Neil & Co');
  assert.equal(u.searchParams.get('r2b'), 'London');
  assert.equal(u.searchParams.get('r4d'), '90');
  assert.equal(u.searchParams.get('r7g'), 'keep');
});

test('date format Excel understands', () => {
  assert.equal(formDate(new Date(2026, 10, 6, 9, 5)), '2026-11-06 09:05');
});
