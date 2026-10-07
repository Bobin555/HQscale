// Builds a single self-contained HTML file (CSS, JS, scenarios and icon inlined) for sharing
// the app where only one file can be hosted, e.g. as a claude.ai artifact or an email attachment.
//   node tools/bundle.mjs [--fragment] [out.html]
// --fragment omits <!doctype>/<html>/<head>/<body> for hosts that wrap the page themselves,
// and hides the CSV download (those hosts block downloads; "Copy results" still works).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(resolve(root, p), 'utf8');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = resolve(root, args.find((a) => !a.startsWith('--')) || 'dist/hqscale.html');

// Modules are concatenated in dependency order, so imports/exports can be dropped.
const js = ['js/viewer.js', 'js/placeholder.js', 'js/hazards.js', 'js/validate.js', 'js/timeline.js', 'js/builder.js', 'js/main.js']
  .map((f) => read(f).replace(/^import .*$/gm, '').replace(/^export /gm, ''))
  .join('\n');

// Concatenation puts every module's top-level names in one scope, so a name defined in two
// modules would break the whole page. Catch that here rather than in the browser.
// (The lookahead skips look-alikes inside strings, such as "const float PI" in shader code.)
const topLevel = [...js.matchAll(/^(?:const|let|var|function\*?|class|async function) ([A-Za-z_$][\w$]*)(?=\s*[=({])/gm)].map((m) => m[1]);
const dupes = [...new Set(topLevel.filter((n, i) => topLevel.indexOf(n) !== i))];
if (dupes.length) {
  console.error(`Can't bundle: these names are defined in more than one file: ${dupes.join(', ')}`);
  process.exit(1);
}

const index = JSON.parse(read('scenarios/index.json'));
const embed = { 'scenarios/index.json': index };
for (const m of index.modules) embed[m.file] = JSON.parse(read(m.file));

const safe = (s) => s.replace(/<\/script/gi, '<\\/script');
const icon = `data:image/svg+xml,${encodeURIComponent(read('icons/icon.svg'))}`;
const body = read('index.html')
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script type="module" src="js\/main.js"><\/script>/, '')
  .replaceAll('icons/icon.svg', icon);

const page = `<title>HQscale Site Induction</title>
<meta name="theme-color" content="#0f1720">
<link rel="icon" href="${icon}">
<style>${read('css/styles.css')}</style>
${body}
<script>window.HQSCALE_EMBED = ${safe(JSON.stringify(embed))};${fragment ? ' window.HQSCALE_NO_DOWNLOADS = true;' : ''}</script>
<script type="module">${safe(js)}</script>
`;

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, fragment ? page : `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${page.replace(/(<\/style>)/, '$1\n</head><body>')}</body></html>
`);
console.log(`Wrote ${out} (${(Buffer.byteLength(readFileSync(out)) / 1024).toFixed(1)} KB)`);
