import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirFromYawPitch, yawPitchFromDir, angularDistance } from '../js/viewer.js';

test('yaw/pitch round-trips through a direction vector', () => {
  for (const [yaw, pitch] of [[0, 0], [96, 7], [-148, -6], [179, 60], [-90, -80]]) {
    const r = yawPitchFromDir(dirFromYawPitch(yaw, pitch));
    assert.ok(Math.abs(r.yaw - yaw) < 1e-9 && Math.abs(r.pitch - pitch) < 1e-9, `${yaw},${pitch} -> ${r.yaw},${r.pitch}`);
  }
});

test('yaw 0 looks forward (-z), positive yaw turns right (+x), positive pitch looks up', () => {
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(dirFromYawPitch(0, 0), [0, 0, -1]));
  assert.ok(near(dirFromYawPitch(90, 0), [1, 0, 0]));
  assert.ok(near(dirFromYawPitch(0, 90), [0, 1, 0]));
});

test('angular distance handles the ±180° seam', () => {
  assert.ok(Math.abs(angularDistance({ yaw: 178, pitch: 0 }, { yaw: -178, pitch: 0 }) - 4) < 1e-9);
  assert.ok(Math.abs(angularDistance({ yaw: 10, pitch: 0 }, { yaw: 10, pitch: 30 }) - 30) < 1e-9);
});
