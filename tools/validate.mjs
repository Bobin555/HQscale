// Checks every module listed in scenarios/index.json: content rules (js/validate.js), that
// media files exist, and that 360° images have a sensible shape. Run before publishing:
//   npm run validate
import { readFileSync, existsSync, openSync, readSync, closeSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateScenario } from '../js/validate.js';
import { describeCoverage } from '../js/viewer.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
let errors = 0, warnings = 0;
const error = (msg) => { errors++; console.log(`  ✕ ${msg}`); };
const warn = (msg) => { warnings++; console.log(`  ⚠ ${msg}`); };

let index;
try {
  index = JSON.parse(readFileSync(resolve(root, 'scenarios/index.json'), 'utf8'));
} catch (e) {
  console.log(`✕ scenarios/index.json: ${e.message}`);
  process.exit(1);
}

const ids = new Set();
for (const m of index.modules || []) {
  console.log(`\n${m.file}`);
  const errorsBefore = errors;
  if (!m.title) error('index.json entry needs a "title"');
  let s;
  try {
    s = JSON.parse(readFileSync(resolve(root, m.file), 'utf8'));
  } catch (e) {
    error(existsSync(resolve(root, m.file)) ? `not valid JSON: ${e.message}` : 'file not found');
    continue;
  }
  if (s.id) {
    if (ids.has(s.id)) error(`module id "${s.id}" is used by another module`);
    ids.add(s.id);
  }
  validateScenario(s).forEach(error);

  for (const [id, scene] of Object.entries(s.scenes || {})) {
    const media = scene.media || {};
    if (!['image', 'video'].includes(media.type) || !media.src || /^(https?:|data:|blob:)/.test(media.src)) continue;
    const file = resolve(root, media.src);
    if (!existsSync(file)) { error(`scene "${id}": media file ${media.src} not found`); continue; }
    if (media.type !== 'image') continue;
    const size = imageSize(file);
    if (!size) continue;
    describeCoverage(size.width, size.height, media).warnings.forEach((w) => warn(`scene "${id}" (${media.src}): ${w}`));
    if (size.width > 8192) warn(`scene "${id}" (${media.src}): ${size.width}px wide. Phones scale this down anyway, so 4096–6000px loads faster.`);
  }
  if (errors === errorsBefore) console.log('  ✓ OK');
}

console.log(`\n${errors} problem(s), ${warnings} warning(s)`);
process.exit(errors ? 1 : 0);

/** Reads width/height from a JPEG or PNG header without any dependencies. */
function imageSize(file) {
  const fd = openSync(file, 'r');
  const buf = Buffer.alloc(256 * 1024);
  const n = readSync(fd, buf, 0, buf.length, 0);
  closeSync(fd);
  if (buf.readUInt32BE(0) === 0x89504e47) return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i + 9 < n) {
      if (buf[i] !== 0xff) { i++; continue; }
      const marker = buf[i + 1];
      const len = buf.readUInt16BE(i + 2);
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        return { height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + len;
    }
  }
  return null;
}
