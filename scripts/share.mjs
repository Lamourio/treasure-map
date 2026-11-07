// Publishes marks to the shared map (src/data/shared.json) that every visitor sees.
//
//   npm run share -- treasure-map-2026-11-06.json            add / update the marks of an export
//   npm run share -- treasure-map-2026-11-06.json --replace  make the shared map exactly that export
//
// The file is an "Export JSON" from the app (only its marks are used). Afterwards commit and
// deploy; visitors get the new marks on their next page load. To remove a shared mark, delete
// its line from src/data/shared.json by hand.
import { readFileSync, writeFileSync } from 'node:fs';

const SHARED = 'src/data/shared.json';
const LETTERS = ['T', 'C', 'S', 'D', 'X'];

const args = process.argv.slice(2);
const replace = args.includes('--replace');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: npm run share -- <export.json> [--replace]');
  process.exit(1);
}

const input = JSON.parse(readFileSync(file, 'utf8'));
if (!Array.isArray(input.marks)) {
  console.error(`${file} has no "marks" list - is it an export from the app?`);
  process.exit(1);
}
const current = JSON.parse(readFileSync(SHARED, 'utf8'));

const byTile = new Map();
const key = (m) => `${m.x}:${m.y}`;
if (!replace) for (const m of current.marks ?? []) byTile.set(key(m), m);

let added = 0;
let changed = 0;
let skipped = 0;
for (const m of input.marks) {
  const x = Number(m.x);
  const y = Number(m.y);
  const code = String(m.code ?? '').toUpperCase();
  if (!Number.isInteger(x) || !Number.isInteger(y) || x < 3 || x > 509 || y < 3 || y > 1021 || !LETTERS.includes(code)) {
    skipped++;
    continue;
  }
  const mark = { x, y, code };
  if (typeof m.note === 'string' && m.note.trim()) mark.note = m.note.trim().slice(0, 200);
  const old = byTile.get(key(mark));
  if (!old) added++;
  else if (old.code !== mark.code || (old.note ?? '') !== (mark.note ?? '')) changed++;
  byTile.set(key(mark), mark);
}

const marks = [...byTile.values()].sort((a, b) => a.y - b.y || a.x - b.x);
// one mark per line so diffs and hand edits stay readable
const body = marks.map((m) => '    ' + JSON.stringify(m)).join(',\n');
const updatedAt = new Date().toISOString().slice(0, 10);
writeFileSync(SHARED, `{\n  "updatedAt": "${updatedAt}",\n  "marks": [\n${body}${body ? '\n' : ''}  ]\n}\n`);

console.log(
  `${SHARED}: ${marks.length} marks (${added} added, ${changed} changed${skipped ? `, ${skipped} skipped` : ''}${replace ? ', replaced' : ''}).`,
);
console.log('Commit and deploy to publish them.');
