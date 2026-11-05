#!/usr/bin/env node
// Regenerates the zone grid (src/data/zones.json) from the zone map image.
//
//   node scripts/build-zones.mjs [input.jpg] [output.json]
//
// How it works:
//  1. Decode the JPEG and find the inner rectangle inside the grey outer frame.
//  2. Pixels brighter than WHITE_THRESHOLD are "area interior"; the grey border
//     lines and the dark digits are not. Label the interior pixels into
//     4-connected components.
//  3. SEEDS lists the position of every level label printed in the image (plus
//     one point inside the King's Throne diamond). Each seed claims the large
//     component nearest to it, which gives each area its id and level.
//  4. Unclaimed pixels (border lines, digits, throne icons, the "SIENNA" tag)
//     take the id of the nearest claimed pixel (multi-source BFS).
//  5. The inner rectangle is stretched linearly onto the 507 x 1019 tile grid
//     (X 3..509, Y 3..1021); each tile takes the area id at its centre.
//  6. The grid is written as run-length-encoded area ids, row-major.
//
// If you replace the image with a different one, update SEEDS (positions are
// given in a 1932 x 1931 reference frame of the whole image, frame included).

import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';

const INPUT = process.argv[2] ?? 'scripts/zones-source.jpg';
const OUTPUT = process.argv[3] ?? 'src/data/zones.json';

const COLS = 507; // X 3..509
const ROWS = 1019; // Y 3..1021
const ORIGIN = 3;
const WHITE_THRESHOLD = 215;
const MIN_AREA_PX = 5000;
const REF_W = 1932;
const REF_H = 1931;
const THRONE = 6;

// [x, y, level] in the 1932 x 1931 reference frame.
const SEEDS = [
  // top row
  [50, 60, 1], [293, 60, 1], [545, 60, 1], [895, 60, 1], [1135, 60, 1], [1487, 60, 1], [1887, 60, 1],
  [815, 150, 2], [200, 200, 2], [1045, 170, 2], [1165, 170, 2], [1678, 170, 2],
  [50, 300, 1], [525, 285, 3], [1165, 300, 3], [1287, 265, 3], [1887, 295, 1],
  [200, 425, 2], [318, 405, 3], [547, 420, 4], [667, 445, 3], [1268, 445, 4], [1380, 420, 3], [1800, 425, 2],
  [328, 540, 3], [849, 543, 4], [1013, 588, 5], [1433, 557, 4], [1600, 597, 3], [1887, 577, 1],
  [100, 618, 1],
  [200, 768, 2], [400, 783, 4], [626, 813, 5], [1255, 783, 5], [1498, 835, 4],
  [50, 915, 1], [1612, 895, 2], [1887, 887, 1],
  [264, 1033, 3], [1543, 1007, 3], [1632, 1023, 2],
  [135, 1093, 2], [50, 1150, 1], [440, 1203, 4], [697, 1187, 5], [1078, 1177, 5],
  [1255, 1250, 4], [1615, 1250, 3], [1755, 1278, 2], [1887, 1158, 1],
  [183, 1360, 2], [635, 1413, 4],
  [373, 1458, 3], [850, 1503, 3], [1017, 1487, 4], [1615, 1480, 3], [50, 1510, 1], [1887, 1513, 1],
  [908, 1577, 2], [267, 1613, 2], [590, 1597, 3], [1360, 1613, 3], [1738, 1627, 2],
  [435, 1720, 1], [1117, 1707, 2], [50, 1767, 1], [775, 1790, 2],
  // bottom row
  [510, 1897, 1], [897, 1897, 1], [1118, 1897, 1], [1563, 1897, 1], [1887, 1878, 1],
  // King's Throne (white point inside the diamond, away from the icons)
  [965, 820, THRONE],
];

const EXPECTED = { 1: 24, 2: 18, 3: 16, 4: 10, 5: 5, 6: 1 };

function fail(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

const img = jpeg.decode(fs.readFileSync(INPUT), { useTArray: true });
const W = img.width;
const H = img.height;
const gray = new Uint8Array(W * H);
for (let i = 0; i < W * H; i++) {
  gray[i] = (img.data[i * 4] + img.data[i * 4 + 1] + img.data[i * 4 + 2]) / 3;
}

// --- 1. inner rectangle inside the grey frame -------------------------------
function scan(start, step, count, get) {
  // skip a few antialiased edge pixels, then the frame (non-white run)
  let i = 0;
  while (i < 4 && get(start + i * step) >= WHITE_THRESHOLD) i++;
  while (i < count && get(start + i * step) < WHITE_THRESHOLD) i++;
  return start + i * step;
}
const midY = Math.floor(H / 2);
const midX = Math.floor(W / 2);
const x0 = scan(0, 1, 100, (x) => gray[midY * W + x]);
const x1 = scan(W - 1, -1, 100, (x) => gray[midY * W + x]); // inclusive
const y0 = scan(0, 1, 100, (y) => gray[y * W + midX]);
const y1 = scan(H - 1, -1, 100, (y) => gray[y * W + midX]);
const iw = x1 - x0 + 1;
const ih = y1 - y0 + 1;
console.log(`image ${W}x${H}, inner rect x ${x0}..${x1}, y ${y0}..${y1}`);

// --- 2. connected components of interior pixels (inside the inner rect) -----
const comp = new Int32Array(W * H).fill(-1);
const compSize = [];
const stack = new Int32Array(W * H);
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const start = y * W + x;
    if (comp[start] !== -1 || gray[start] < WHITE_THRESHOLD) continue;
    const id = compSize.length;
    let sp = 0;
    let size = 0;
    stack[sp++] = start;
    comp[start] = id;
    while (sp > 0) {
      const p = stack[--sp];
      size++;
      const px = p % W;
      const py = (p - px) / W;
      if (px > x0) push(p - 1);
      if (px < x1) push(p + 1);
      if (py > y0) push(p - W);
      if (py < y1) push(p + W);
    }
    compSize.push(size);
    function push(q) {
      if (comp[q] === -1 && gray[q] >= WHITE_THRESHOLD) {
        comp[q] = id;
        stack[sp++] = q;
      }
    }
  }
}
const bigComps = compSize.filter((s) => s >= MIN_AREA_PX).length;
console.log(`components: ${compSize.length} total, ${bigComps} large (>= ${MIN_AREA_PX}px)`);

// --- 3. seeds claim components ----------------------------------------------
const compArea = new Int32Array(compSize.length); // component -> area id (0 = none)
const areas = [];
SEEDS.forEach(([rx, ry, level], i) => {
  const sx = Math.round((rx / REF_W) * W);
  const sy = Math.round((ry / REF_H) * H);
  let best = -1;
  let bestD = Infinity;
  const R = 60;
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      const x = sx + dx;
      const y = sy + dy;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const c = comp[y * W + x];
      if (c < 0 || compSize[c] < MIN_AREA_PX) continue;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
  }
  if (best < 0) fail(`seed #${i} (${rx},${ry}) found no area nearby`);
  if (compArea[best]) {
    const other = areas[compArea[best] - 1];
    fail(`seed #${i} (${rx},${ry}) lands in the same area as seed (${other.ref}) - is a border line broken?`);
  }
  const id = i + 1;
  compArea[best] = id;
  const gx = ORIGIN + Math.floor(((sx - x0) / iw) * COLS);
  const gy = ORIGIN + Math.floor(((sy - y0) / ih) * ROWS);
  areas.push({ id, level, label: [gx, gy], ref: `${rx},${ry}` });
});
const unclaimed = compSize.filter((s, c) => s >= MIN_AREA_PX && !compArea[c]).length;
if (unclaimed) fail(`${unclaimed} large component(s) have no seed - add a seed for each`);

// --- 4. grow areas over lines / digits / icons ------------------------------
const area = new Uint8Array(W * H);
const queue = new Int32Array(W * H);
let qh = 0;
let qt = 0;
for (let y = y0; y <= y1; y++) {
  for (let x = x0; x <= x1; x++) {
    const p = y * W + x;
    const c = comp[p];
    if (c >= 0 && compArea[c]) {
      area[p] = compArea[c];
      queue[qt++] = p;
    }
  }
}
while (qh < qt) {
  const p = queue[qh++];
  const px = p % W;
  const py = (p - px) / W;
  const a = area[p];
  if (px > x0 && !area[p - 1]) { area[p - 1] = a; queue[qt++] = p - 1; }
  if (px < x1 && !area[p + 1]) { area[p + 1] = a; queue[qt++] = p + 1; }
  if (py > y0 && !area[p - W]) { area[p - W] = a; queue[qt++] = p - W; }
  if (py < y1 && !area[p + W]) { area[p + W] = a; queue[qt++] = p + W; }
}

// --- 5. sample onto the tile grid -------------------------------------------
const grid = new Uint8Array(COLS * ROWS);
for (let r = 0; r < ROWS; r++) {
  const py = y0 + Math.min(ih - 1, Math.floor(((r + 0.5) / ROWS) * ih));
  for (let c = 0; c < COLS; c++) {
    // tiles are diamonds in staggered rows: odd rows (even game Y) are shifted half a tile right
    const px = x0 + Math.min(iw - 1, Math.floor(((c + 0.5 + (r & 1) * 0.5) / (COLS + 0.5)) * iw));
    grid[r * COLS + c] = area[py * W + px];
  }
}

// --- 6. RLE + checks ---------------------------------------------------------
const rle = [];
let prev = grid[0];
let run = 0;
for (const v of grid) {
  if (v === prev) run++;
  else {
    rle.push(prev, run);
    prev = v;
    run = 1;
  }
}
rle.push(prev, run);

const tilesPerArea = new Map();
for (const v of grid) tilesPerArea.set(v, (tilesPerArea.get(v) ?? 0) + 1);
if (tilesPerArea.has(0)) fail('some tiles have no area');
const levelCount = {};
const tilesPerLevel = {};
for (const a of areas) {
  if (!tilesPerArea.get(a.id)) fail(`area ${a.id} vanished after sampling`);
  levelCount[a.level] = (levelCount[a.level] ?? 0) + 1;
  tilesPerLevel[a.level] = (tilesPerLevel[a.level] ?? 0) + tilesPerArea.get(a.id);
}
for (const [lvl, n] of Object.entries(EXPECTED)) {
  if (levelCount[lvl] !== n) fail(`expected ${n} areas at level ${lvl}, got ${levelCount[lvl] ?? 0}`);
}

const out = {
  version: 1,
  cols: COLS,
  rows: ROWS,
  origin: ORIGIN,
  source: path.basename(INPUT),
  areas: areas.map(({ id, level, label }) => ({ id, level, label })),
  rle,
};
fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
fs.writeFileSync(OUTPUT, JSON.stringify(out));
console.log(`areas per level: ${JSON.stringify(levelCount)}`);
console.log(`tiles per level: ${JSON.stringify(tilesPerLevel)}`);
console.log(`wrote ${OUTPUT}: ${areas.length} areas, ${rle.length / 2} runs, ${fs.statSync(OUTPUT).size} bytes`);
