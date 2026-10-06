// Creates a new training module from a starter template and adds it to the home screen.
//   npm run new-module -- <id> "<Title>"
//   e.g. npm run new-module -- warehouse "Warehouse Safety Walk"
// Then put your 360° photos in media/<id>/ and edit scenarios/<id>.json.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [id, ...titleParts] = process.argv.slice(2);
const title = titleParts.join(' ').trim();
if (!id || !/^[a-z0-9-]+$/.test(id) || !title) {
  console.log('Usage: npm run new-module -- <id> "<Title>"   (id: lowercase letters, numbers and dashes)');
  process.exit(1);
}
const file = `scenarios/${id}.json`;
if (existsSync(resolve(root, file))) {
  console.log(`${file} already exists.`);
  process.exit(1);
}

const module = {
  id,
  title,
  description: 'Describe what learners will practise in this module.',
  estimatedMinutes: 5,
  passMark: 0.8,
  scenes: {
    'scene-1': {
      title: 'First location',
      initialView: { yaw: 0, pitch: 0 },
      // Placeholder until real footage exists. Replace with:
      //   { "type": "image", "src": "media/<id>/scene-1.jpg" }
      media: {
        type: 'placeholder', theme: 'warehouse', label: title,
        objects: [
          { kind: 'door', yaw: 0, pitch: 0, width: 16, text: 'FIRE EXIT', signColor: '#138a36' },
          { kind: 'extinguisher', yaw: 40, pitch: -12 },
          { kind: 'firstaid', yaw: -60, pitch: 6 },
          { kind: 'boxes', yaw: 120, pitch: -12 },
          { kind: 'wetfloor', yaw: -140, pitch: -18 },
        ],
      },
    },
  },
  steps: [
    { type: 'info', scene: 'scene-1', title: `Welcome to ${title}`, body: 'Look around. Each step asks you to find something or answer a question.' },
    {
      type: 'find', scene: 'scene-1', title: 'Find the fire extinguisher', prompt: 'Look around and tap on the fire extinguisher.',
      targets: [{ yaw: 40, pitch: -12, radius: 8, label: 'Fire extinguisher' }],
      maxAttempts: 3, hint: 'Look to your right, near the floor.', explain: 'Know where your nearest extinguisher is.',
    },
    {
      type: 'quiz', scene: 'scene-1', question: 'What should you do if you see a spill?',
      options: ['Walk around it', 'Put out a wet-floor sign and report it', 'Ignore it', 'Mop it with paper towels and leave'],
      answer: 1, explain: 'Warn others and report it so it gets cleaned up properly.',
    },
  ],
};

const json = JSON.stringify(module, null, 2);
writeFileSync(resolve(root, file), `${json}\n`);
mkdirSync(resolve(root, 'media', id), { recursive: true });
if (!existsSync(resolve(root, 'media', id, '.gitkeep'))) writeFileSync(resolve(root, 'media', id, '.gitkeep'), '');

const indexFile = resolve(root, 'scenarios/index.json');
const index = JSON.parse(readFileSync(indexFile, 'utf8'));
index.modules.push({ file, title, description: module.description, minutes: module.estimatedMinutes });
writeFileSync(indexFile, `${JSON.stringify(index, null, 2)}\n`);

console.log(`Created ${file} and media/${id}/, and added "${title}" to the home screen.
Next:
  1. Put 360° photos in media/${id}/ and point each scene's "media" at them.
  2. Open the app with #author to find yaw/pitch positions for targets and hotspots.
  3. Run npm run validate to check the module.`);
