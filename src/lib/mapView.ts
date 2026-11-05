import { COLS, MAX_X, MAX_Y, MIN_X, MIN_Y, ROWS, TILE_COUNT, toIndex } from './coords';
import { MARK_ICONS, PinIcon, drawIcon, readableOn } from './icons';
import { CODE_SLOTS, MARKS, PIN_CODES, RANGE_CODES, RANGE_RADIUS, isActiveMark } from './marks';
import { typeIcon, type Store, type StoreEvent } from './store';
import { LEVEL_COLORS, areaLabels, zoneArea, zoneLevel } from './zones';

// World units: 1 unit = one tile width. A tile is 1 wide and 0.5 tall, so the
// 507 x 1019 grid is drawn as a square. screen = offset + world * scale.

export const RULER_TOP = 22;
export const RULER_LEFT = 38;

const MAX_SCALE = 96; // max tile width in CSS px
const FINE_BORDER_SCALE = 3.5; // use 4x2-texel border texture from here
const VECTOR_BORDER_SCALE = 8; // draw borders as lines from here
const ZONE_LABEL_MAX_SCALE = 16;
const GRID_SCALE = 12;
const LETTER_SCALE = 22;
const LANDMARK_LABEL_SCALE = 2.5;
const BIG_MARK_SCALE = 4; // below this, marks are dilated so they stay visible
const PIN_SCALE = 12; // below this, marks and landmarks are shown as pins (if enabled)
const CLUSTER_CELL_PX = 46; // pins closer than about this merge into a cluster
const MARK_PIN_SIZE = 24;
const LANDMARK_PIN_SIZE = 32;
const RULER_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500];
const BORDER_RGBA = [24, 28, 36, 235];

export interface HoverInfo {
  index: number;
  clientX: number;
  clientY: number;
  cluster?: { count: number; counts: number[] };
}

interface Cluster {
  c: number; // mean tile position
  r: number;
  count: number;
  counts: number[]; // per mark code
  index: number; // the member tile when count === 1
  code: number; // highest-priority code present
  c0: number;
  c1: number;
  r0: number;
  r1: number;
}

interface PinSprite {
  canvas: HTMLCanvasElement;
  w: number;
  h: number;
  ax: number; // anchor (pin tip) inside the sprite
  ay: number;
  cy: number; // centre of the round head inside the sprite
  r: number;
}

interface PinHit {
  x: number;
  y: number;
  r: number;
  kind: 'mark' | 'cluster' | 'landmark';
  index: number;
  cluster?: Cluster;
}

interface Theme {
  mapBg: string;
  mapEmpty: string;
  rulerBg: string;
  rulerText: string;
  rulerTick: string;
  accent: string;
}

type Mode = 'none' | 'tap' | 'pan' | 'paint' | 'box' | 'pinch';

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function packRgba(r: number, g: number, b: number, a = 255): number {
  return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0; // little-endian ImageData
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function boxBounds(a: number, b: number) {
  const ac = a % COLS;
  const ar = (a - ac) / COLS;
  const bc = b % COLS;
  const br = (b - bc) / COLS;
  return { c0: Math.min(ac, bc), c1: Math.max(ac, bc), r0: Math.min(ar, br), r1: Math.max(ar, br) };
}

export class MapView {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private w = 0; // CSS px
  private h = 0;
  scale = 1; // tile width in CSS px
  private ox = 0; // screen position of world origin (CSS px, canvas-relative)
  private oy = 0;
  private fitted = false;

  private zoneCanvas: HTMLCanvasElement;
  private coarseBorder: HTMLCanvasElement;
  private fineBorder: HTMLCanvasElement;
  private marksCanvas: HTMLCanvasElement;
  private marksCtx: CanvasRenderingContext2D;
  private marksImg: ImageData;
  private marksU32: Uint32Array;
  private markColors: number[];
  private showCodesKey = '';
  private marksVersion = 0;
  private clusterCache: { key: string; items: Cluster[] } | null = null;
  private sprites = new Map<string, PinSprite>();
  private pinHits: PinHit[] = [];
  private pinsActive = false;
  private overPin = false;
  private lastTap: { t: number; x: number; y: number } | null = null;

  private theme!: Theme;
  private raf = 0;
  private hover = -1;
  private anim: { t0: number; dur: number; from: [number, number, number]; to: [number, number, number] } | null = null;

  // input state
  private pointers = new Map<number, { x: number; y: number; type: string }>();
  private mode: Mode = 'none';
  private tapStart = { x: 0, y: 0 };
  private card: HTMLElement | null = null;
  private pinch = { d0: 1, s0: 1, wx: 0, wy: 0 };
  private lastPaint = -1;
  private paintCode = 0; // code of the current stroke (0 = erase)
  private eraseAll = false; // right-drag quick erase ignores the eraser's code filter
  private box: { a: number; b: number } | null = null; // box tool: start and current tile
  private spaceDown = false;
  private disposers: (() => void)[] = [];

  constructor(
    private canvas: HTMLCanvasElement,
    private store: Store,
    private onHover: (info: HoverInfo | null) => void,
  ) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.zoneCanvas = this.buildZoneCanvas();
    this.coarseBorder = this.buildBorderCanvas(1, 1);
    this.fineBorder = this.buildBorderCanvas(4, 2);
    [this.marksCanvas, this.marksCtx] = makeCanvas(COLS, ROWS);
    this.marksImg = this.marksCtx.createImageData(COLS, ROWS);
    this.marksU32 = new Uint32Array(this.marksImg.data.buffer);
    this.markColors = Array.from({ length: CODE_SLOTS }, (_, c) => c).map((c) => (c ? packRgba(...hexToRgb(MARKS[c].color)) : 0));
    this.rebuildMarks();
    this.readTheme();

    this.disposers.push(store.subscribe(this.onStore));
    this.listen(canvas, 'pointerdown', this.onPointerDown);
    this.listen(canvas, 'pointermove', this.onPointerMove);
    this.listen(canvas, 'pointerup', this.onPointerUp);
    this.listen(canvas, 'pointercancel', this.onPointerUp);
    this.listen(canvas, 'pointerleave', this.onPointerLeave);
    this.listen(canvas, 'wheel', this.onWheel, { passive: false });
    this.listen(canvas, 'contextmenu', (e) => e.preventDefault());
    this.listen(window, 'keydown', this.onKey);
    this.listen(window, 'keyup', this.onKey);
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    this.listen(mq, 'change', () => {
      this.readTheme();
      this.requestRender();
    });
  }

  private listen(target: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts);
    this.disposers.push(() => target.removeEventListener(type, fn, opts));
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.disposers.forEach((d) => d());
  }

  private readTheme() {
    const cs = getComputedStyle(document.documentElement);
    const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    this.theme = {
      mapBg: v('--map-bg', '#15181d'),
      mapEmpty: v('--map-empty', '#2a3039'),
      rulerBg: v('--ruler-bg', '#1e2229'),
      rulerText: v('--ruler-text', '#a7afbb'),
      rulerTick: v('--ruler-tick', '#5a6371'),
      accent: v('--accent', '#4da3ff'),
    };
  }

  // ------------------------------------------------------------ layers

  private buildZoneCanvas(): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(COLS, ROWS);
    const img = ctx.createImageData(COLS, ROWS);
    const u32 = new Uint32Array(img.data.buffer);
    const lut = [0, 1, 2, 3, 4, 5, 6].map((l) => (l ? packRgba(...hexToRgb(LEVEL_COLORS[l])) : 0));
    for (let i = 0; i < TILE_COUNT; i++) u32[i] = lut[zoneLevel[i]];
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Transparent texture with dark texels on tile edges where the area changes. */
  private buildBorderCanvas(tx: number, ty: number): HTMLCanvasElement {
    const W = COLS * tx;
    const [c, ctx] = makeCanvas(W, ROWS * ty);
    const img = ctx.createImageData(W, ROWS * ty);
    const u32 = new Uint32Array(img.data.buffer);
    const px = packRgba(BORDER_RGBA[0], BORDER_RGBA[1], BORDER_RGBA[2], BORDER_RGBA[3]);
    for (let r = 0; r < ROWS; r++) {
      for (let col = 0; col < COLS; col++) {
        const i = r * COLS + col;
        const a = zoneArea[i];
        if (col + 1 < COLS && zoneArea[i + 1] !== a) {
          for (let y = 0; y < ty; y++) u32[(r * ty + y) * W + col * tx + tx - 1] = px;
        }
        if (r + 1 < ROWS && zoneArea[i + COLS] !== a) {
          for (let x = 0; x < tx; x++) u32[(r * ty + ty - 1) * W + col * tx + x] = px;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  private markPixel(i: number): number {
    const m = this.store.marks[i];
    return m && isActiveMark(m) && this.store.settings.showCodes[m] ? this.markColors[m] : 0;
  }

  private rebuildMarks() {
    this.marksU32.fill(0);
    for (const i of this.store.marked) this.marksU32[i] = this.markPixel(i);
    this.marksCtx.putImageData(this.marksImg, 0, 0);
    this.showCodesKey = this.store.settings.showCodes.join();
  }

  private updateMarks(indices: number[]) {
    let c0 = COLS, c1 = -1, r0 = ROWS, r1 = -1;
    for (const i of indices) {
      this.marksU32[i] = this.markPixel(i);
      const c = i % COLS;
      const r = (i - c) / COLS;
      if (c < c0) c0 = c;
      if (c > c1) c1 = c;
      if (r < r0) r0 = r;
      if (r > r1) r1 = r;
    }
    if (c1 >= 0) this.marksCtx.putImageData(this.marksImg, 0, 0, c0, r0, c1 - c0 + 1, r1 - r0 + 1);
  }

  private onStore = (ev: StoreEvent) => {
    if (ev.type === 'marks') {
      this.marksVersion++;
      if (ev.indices) this.updateMarks(ev.indices);
      else this.rebuildMarks();
    } else if (ev.type === 'settings' && this.store.settings.showCodes.join() !== this.showCodesKey) {
      this.rebuildMarks();
    }
    if (ev.type === 'settings') this.updateCursor();
    this.requestRender();
  };

  // ------------------------------------------------------------ camera

  setSize(w: number, h: number) {
    // keep the world point at the centre of the view in place (e.g. when the bottom sheet opens)
    const centre = this.fitted ? this.viewCenterWorld() : null;
    this.dpr = Math.min(window.devicePixelRatio || 1, 3);
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    if (!this.fitted && w > 0 && h > 0) {
      this.fitted = true;
      this.fit(false);
    } else if (centre) this.setCamera(centre[0], centre[1], this.scale);
    this.render();
  }

  private get viewW() {
    return Math.max(1, this.w - RULER_LEFT);
  }

  private get viewH() {
    return Math.max(1, this.h - RULER_TOP);
  }

  private get fitScale() {
    return Math.min(this.viewW / COLS, this.viewH / (ROWS / 2));
  }

  private get minScale() {
    return this.fitScale * 0.6;
  }

  private clampScale(s: number) {
    return Math.min(MAX_SCALE, Math.max(this.minScale, s));
  }

  /** Keeps the viewport centre over the map. */
  private clampPan() {
    const cx = RULER_LEFT + this.viewW / 2;
    const cy = RULER_TOP + this.viewH / 2;
    const mw = COLS * this.scale;
    const mh = (ROWS / 2) * this.scale;
    this.ox = Math.min(cx, Math.max(cx - mw, this.ox));
    this.oy = Math.min(cy, Math.max(cy - mh, this.oy));
  }

  private viewCenterWorld(): [number, number] {
    return [(RULER_LEFT + this.viewW / 2 - this.ox) / this.scale, (RULER_TOP + this.viewH / 2 - this.oy) / this.scale];
  }

  private setCamera(wx: number, wy: number, scale: number) {
    this.scale = this.clampScale(scale);
    this.ox = RULER_LEFT + this.viewW / 2 - wx * this.scale;
    this.oy = RULER_TOP + this.viewH / 2 - wy * this.scale;
    this.clampPan();
  }

  private animateTo(wx: number, wy: number, scale: number) {
    const [fx, fy] = this.viewCenterWorld();
    this.anim = { t0: performance.now(), dur: 380, from: [fx, fy, this.scale], to: [wx, wy, this.clampScale(scale)] };
    this.requestRender();
  }

  fit(animate = true) {
    const s = this.fitScale * 0.97;
    if (animate) this.animateTo(COLS / 2, ROWS / 4, s);
    else this.setCamera(COLS / 2, ROWS / 4, s);
    this.requestRender();
  }

  zoomBy(factor: number) {
    this.anim = null;
    this.zoomAt(RULER_LEFT + this.viewW / 2, RULER_TOP + this.viewH / 2, factor);
  }

  /** Centres (and zooms in on) a tile. */
  goTo(index: number, minScale = 24) {
    this.store.addRecent(index);
    const col = index % COLS;
    const row = (index - col) / COLS;
    this.animateTo(col + 0.5, (row + 0.5) / 2, Math.max(this.scale, minScale));
  }

  private zoomAt(sx: number, sy: number, factor: number) {
    const s = this.clampScale(this.scale * factor);
    this.ox = sx - (sx - this.ox) * (s / this.scale);
    this.oy = sy - (sy - this.oy) * (s / this.scale);
    this.scale = s;
    this.clampPan();
    this.requestRender();
  }

  tileAt(sx: number, sy: number): number {
    if (sx < RULER_LEFT || sy < RULER_TOP) return -1;
    const col = Math.floor((sx - this.ox) / this.scale);
    const row = Math.floor((sy - this.oy) / (this.scale / 2));
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return -1;
    return row * COLS + col;
  }

  // ------------------------------------------------------------ input

  private local(e: { clientX: number; clientY: number }) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private updateCursor() {
    const tool = this.store.settings.tool;
    this.canvas.style.cursor =
      this.mode === 'pan'
        ? 'grabbing'
        : this.spaceDown
          ? 'grab'
          : tool === 'select' || this.overPin
            ? 'pointer'
            : 'crosshair';
  }

  private onKey = (e: KeyboardEvent) => {
    if (e.code !== 'Space') return;
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.tagName === 'BUTTON')) return;
    e.preventDefault();
    this.spaceDown = e.type === 'keydown';
    this.updateCursor();
  };

  private onPointerDown = (e: PointerEvent) => {
    this.anim = null;
    const p = this.local(e);
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { ...p, type: e.pointerType });

    if (this.pointers.size === 2) {
      if (this.mode === 'paint') this.store.endStroke();
      this.box = null; // second finger: cancel a box, pinch instead
      const [a, b] = [...this.pointers.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      this.pinch = {
        d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)),
        s0: this.scale,
        wx: (mx - this.ox) / this.scale,
        wy: (my - this.oy) / this.scale,
      };
      this.mode = 'pinch';
      this.onHover(null);
      return;
    }
    if (this.pointers.size > 2) return;

    const mouse = e.pointerType === 'mouse';
    if (mouse && e.button === 2) {
      if (this.store.settings.tool !== 'select') {
        // right-drag with any brush = quick eraser (all codes)
        this.startStroke(0, true, p);
        return;
      }
      const i = this.tileAt(p.x, p.y);
      if (i >= 0) this.store.select(i);
      this.mode = 'none';
      return;
    }
    if (mouse && (e.button === 1 || (e.button === 0 && this.spaceDown))) {
      this.mode = 'pan';
      this.updateCursor();
      return;
    }
    if (mouse && e.button !== 0) return;

    const tool = this.store.settings.tool;
    if (tool !== 'select') {
      if (this.store.settings.brushShape === 'box') {
        const i = this.tileAt(p.x, p.y);
        this.paintCode = tool;
        this.box = i >= 0 ? { a: i, b: i } : null;
        this.mode = this.box ? 'box' : 'none';
        this.requestRender();
      } else this.startStroke(tool, false, p);
      return;
    }
    this.mode = 'tap';
    this.tapStart = p;
  };

  private onPointerMove = (e: PointerEvent) => {
    const p = this.local(e);
    const prev = this.pointers.get(e.pointerId);
    if (prev) this.pointers.set(e.pointerId, { ...p, type: prev.type });

    if (e.pointerType === 'mouse' && this.mode !== 'pinch') {
      const pin = this.mode === 'none' || this.mode === 'tap' ? this.pinAt(p.x, p.y) : null;
      const i = pin ? (pin.kind === 'cluster' ? -1 : pin.index) : this.tileAt(p.x, p.y);
      if (i !== this.hover) {
        this.hover = i;
        this.requestRender();
      }
      if (!!pin !== this.overPin) {
        this.overPin = !!pin;
        this.updateCursor();
      }
      if (pin?.cluster) {
        const { count, counts } = pin.cluster;
        this.onHover({ index: pin.index, clientX: e.clientX, clientY: e.clientY, cluster: { count, counts } });
      } else {
        this.onHover(i >= 0 && this.mode !== 'pan' ? { index: i, clientX: e.clientX, clientY: e.clientY } : null);
      }
    }
    if (!prev) return;

    switch (this.mode) {
      case 'pinch': {
        const [a, b] = [...this.pointers.values()];
        const d = Math.max(10, Math.hypot(a.x - b.x, a.y - b.y));
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        this.scale = this.clampScale(this.pinch.s0 * (d / this.pinch.d0));
        this.ox = mx - this.pinch.wx * this.scale;
        this.oy = my - this.pinch.wy * this.scale;
        this.clampPan();
        this.requestRender();
        break;
      }
      case 'tap': {
        const slop = e.pointerType === 'mouse' ? 4 : 10;
        if (Math.hypot(p.x - this.tapStart.x, p.y - this.tapStart.y) < slop) break;
        this.mode = 'pan';
        this.updateCursor();
        this.onHover(null);
        this.panBy(p.x - this.tapStart.x, p.y - this.tapStart.y);
        break;
      }
      case 'pan':
        this.panBy(p.x - prev.x, p.y - prev.y);
        break;
      case 'paint':
        this.paintTo(this.tileAt(p.x, p.y));
        break;
      case 'box': {
        const i = this.tileAt(Math.max(RULER_LEFT, p.x), Math.max(RULER_TOP, p.y));
        if (i >= 0 && this.box && i !== this.box.b) {
          this.box.b = i;
          this.requestRender();
        }
        break;
      }
    }
  };

  private onPointerUp = (e: PointerEvent) => {
    const had = this.pointers.delete(e.pointerId);
    if (!had) return;
    if (this.mode === 'tap' && e.type === 'pointerup') {
      const p = this.local(e);
      const pin = this.pinAt(p.x, p.y);
      const i = pin ? -1 : this.tileAt(p.x, p.y);
      const now = performance.now();
      const last = this.lastTap;
      const double = !pin && last !== null && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 24;
      this.lastTap = double ? null : { t: now, x: p.x, y: p.y };
      if (pin) this.activatePin(pin);
      else if (double) {
        // double click / tap: zoom in there; the first tap's selection stays (no deselect toggle)
        if (i >= 0) this.store.select(i);
        this.zoomAt(p.x, p.y, 2);
      } else if (i >= 0) this.store.select(i === this.store.selected ? null : i); // tap again to deselect
    }
    if (this.mode === 'paint') this.store.endStroke();
    if (this.mode === 'box') this.applyBox(e.type === 'pointerup');
    if (this.pointers.size === 1 && this.mode === 'pinch') this.mode = 'pan';
    else if (this.pointers.size === 0) this.mode = 'none';
    this.updateCursor();
  };

  private onPointerLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return;
    this.hover = -1;
    this.onHover(null);
    this.requestRender();
  };

  private onWheel = (e: WheelEvent) => {
    e.preventDefault();
    this.anim = null;
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? this.h : 1;
    const dx = e.deltaX * unit;
    const dy = e.deltaY * unit;
    if (e.shiftKey) {
      this.panBy(-(dx || dy), 0);
      return;
    }
    const p = this.local(e);
    const k = e.ctrlKey ? 0.01 : 0.0018; // ctrlKey = trackpad pinch
    this.zoomAt(p.x, p.y, Math.exp(-dy * k));
  };

  private panBy(dx: number, dy: number) {
    this.anim = null;
    this.ox += dx;
    this.oy += dy;
    this.clampPan();
    this.requestRender();
  }

  private startStroke(code: number, eraseAll: boolean, p: { x: number; y: number }) {
    this.mode = 'paint';
    this.paintCode = code;
    this.eraseAll = eraseAll;
    this.store.beginStroke();
    this.lastPaint = -1;
    this.paintTo(this.tileAt(p.x, p.y));
  }

  /** Paints (or erases) a brush-sized square around each tile on the line from the previous one, so fast drags leave no gaps. */
  private paintTo(i: number) {
    if (i < 0) {
      this.lastPaint = -1;
      return;
    }
    const { marks } = this.store;
    const code = this.paintCode;
    const radius = this.store.settings.brushSize;
    const filter = this.eraseAll ? null : this.store.settings.eraseCodes;
    const paintOne = (j: number) => {
      const m = marks[j];
      if (code === 0) {
        if (m && (!filter || filter[m])) this.store.setTile(j, 0);
      } else if (m !== code) this.store.setTile(j, code);
    };
    const paint = (centre: number) => {
      const cc = centre % COLS;
      const cr = (centre - cc) / COLS;
      for (let r = Math.max(0, cr - radius); r <= Math.min(ROWS - 1, cr + radius); r++) {
        for (let c = Math.max(0, cc - radius); c <= Math.min(COLS - 1, cc + radius); c++) paintOne(r * COLS + c);
      }
    };
    if (this.lastPaint < 0) paint(i);
    else {
      let x0 = this.lastPaint % COLS;
      let y0 = Math.floor(this.lastPaint / COLS);
      const x1 = i % COLS;
      const y1 = Math.floor(i / COLS);
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        paint(y0 * COLS + x0);
        if (x0 === x1 && y0 === y1) break;
        const e2 = 2 * err;
        if (e2 >= dy) {
          err += dy;
          x0 += sx;
        }
        if (e2 <= dx) {
          err += dx;
          y0 += sy;
        }
      }
    }
    this.lastPaint = i;
  }

  /** Box tool: paint or erase every tile inside the dragged rectangle as one undo step. */
  private applyBox(commit: boolean) {
    const box = this.box;
    this.box = null;
    this.requestRender();
    if (!box || !commit) return;
    const { c0, c1, r0, r1 } = boxBounds(box.a, box.b);
    const { marks, marked, settings } = this.store;
    const code = this.paintCode;
    const list: number[] = [];
    if (code === 0) {
      for (const i of marked) {
        const c = i % COLS;
        const r = (i - c) / COLS;
        if (c >= c0 && c <= c1 && r >= r0 && r <= r1 && settings.eraseCodes[marks[i]]) list.push(i);
      }
    } else {
      for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) if (marks[r * COLS + c] !== code) list.push(r * COLS + c);
    }
    if (list.length) this.store.markMany(list, code);
    else this.store.notify(code === 0 ? 'Nothing to erase in that box' : 'Those tiles already have that mark');
  }

  // ------------------------------------------------------------ render

  requestRender() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.render();
    });
  }

  private stepAnimation() {
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (performance.now() - a.t0) / a.dur);
    const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
    const s = Math.exp(Math.log(a.from[2]) + (Math.log(a.to[2]) - Math.log(a.from[2])) * k);
    this.setCamera(a.from[0] + (a.to[0] - a.from[0]) * k, a.from[1] + (a.to[1] - a.from[1]) * k, s);
    if (t >= 1) this.anim = null;
    else this.requestRender();
  }

  render() {
    if (!this.w || !this.h) return;
    this.stepAnimation();
    const { ctx, scale, ox, oy, theme, store } = this;
    const { settings } = store;
    const th = scale / 2;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = theme.mapBg;
    ctx.fillRect(0, 0, this.w, this.h);
    this.pinsActive = settings.showPins && scale < PIN_SCALE;
    this.pinHits = [];

    // visible tile range
    const c0 = Math.max(0, Math.floor((RULER_LEFT - ox) / scale));
    const c1 = Math.min(COLS, Math.ceil((this.w - ox) / scale));
    const r0 = Math.max(0, Math.floor((RULER_TOP - oy) / th));
    const r1 = Math.min(ROWS, Math.ceil((this.h - oy) / th));

    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER_LEFT, RULER_TOP, this.viewW, this.viewH);
    ctx.clip();

    if (c0 < c1 && r0 < r1) {
      const vx = ox + c0 * scale;
      const vy = oy + r0 * th;
      const vw = (c1 - c0) * scale;
      const vh = (r1 - r0) * th;
      const blit = (img: HTMLCanvasElement, k: number, kh: number) =>
        ctx.drawImage(img, c0 * k, r0 * kh, (c1 - c0) * k, (r1 - r0) * kh, vx, vy, vw, vh);

      // zones
      ctx.imageSmoothingEnabled = false;
      if (settings.showZones) {
        blit(this.zoneCanvas, 1, 1);
        if (scale < FINE_BORDER_SCALE) blit(this.coarseBorder, 1, 1);
        else if (scale < VECTOR_BORDER_SCALE) {
          ctx.imageSmoothingEnabled = true;
          blit(this.fineBorder, 4, 2);
          ctx.imageSmoothingEnabled = false;
        } else this.drawVectorBorders(c0, c1, r0, r1);
      } else {
        ctx.fillStyle = theme.mapEmpty;
        ctx.fillRect(vx, vy, vw, vh);
      }
      if (settings.showZones && scale < ZONE_LABEL_MAX_SCALE) this.drawZoneLabels();

      if (settings.dimUnmarked) {
        ctx.fillStyle = 'rgba(8,10,14,0.62)';
        ctx.fillRect(vx, vy, vw, vh);
      }

      if (settings.showRanges) this.drawRanges(c0, c1, r0, r1);
      this.drawCrosshair(c0, c1, r0, r1);
      this.drawLandmarks(false);

      // marks
      if (scale < BIG_MARK_SCALE) {
        // tiles are ~1-3px here: dilate marks by drawing the texture shifted +-1px so they stay visible
        for (const dy of [-1, 0, 1]) {
          for (const dx of [-1, 0, 1]) {
            ctx.drawImage(this.marksCanvas, c0, r0, c1 - c0, r1 - r0, vx + dx, vy + dy, vw, vh);
          }
        }
      } else blit(this.marksCanvas, 1, 1);

      if (scale >= GRID_SCALE) this.drawGrid(c0, c1, r0, r1);
      if (scale >= LETTER_SCALE) this.drawLetters(c0, c1, r0, r1);
      this.drawLandmarks(true);
      this.drawSelection();
      this.drawBrushPreview();
      if (this.hover >= 0 && scale >= 4 && settings.tool === 'select') {
        const c = this.hover % COLS;
        const r = (this.hover - c) / COLS;
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(ox + c * scale, oy + r * th, scale, th);
      }
      if (this.pinsActive) this.drawPins();
    }
    ctx.restore();
    this.drawRulers(c0, c1, r0, r1);
    this.positionCard();
  }

  /** Box being dragged, or the brush footprint under the mouse. */
  private drawBrushPreview() {
    const { ctx, scale, ox, oy, store } = this;
    const tool = store.settings.tool;
    if (tool === 'select' && !this.box) return;
    const th = scale / 2;
    let c0: number, c1: number, r0: number, r1: number;
    let code: number;
    if (this.box) {
      ({ c0, c1, r0, r1 } = boxBounds(this.box.a, this.box.b));
      code = this.paintCode;
    } else {
      if (this.hover < 0 || this.mode === 'pan' || this.mode === 'pinch') return;
      const r = store.settings.brushShape === 'box' ? 0 : store.settings.brushSize;
      const hc = this.hover % COLS;
      const hr = (this.hover - hc) / COLS;
      c0 = Math.max(0, hc - r);
      c1 = Math.min(COLS - 1, hc + r);
      r0 = Math.max(0, hr - r);
      r1 = Math.min(ROWS - 1, hr + r);
      code = tool === 'select' ? 0 : tool;
    }
    let x = ox + c0 * scale;
    let y = oy + r0 * th;
    let w = (c1 - c0 + 1) * scale;
    let h = (r1 - r0 + 1) * th;
    if (w < 6) {
      x -= (6 - w) / 2;
      w = 6;
    }
    if (h < 6) {
      y -= (6 - h) / 2;
      h = 6;
    }
    const color = code ? MARKS[code].color : '#ff4d4d';
    if (this.box) {
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, w, h);
      ctx.globalAlpha = 1;
    }
    ctx.setLineDash(code ? [] : [5, 3]);
    ctx.lineWidth = 2;
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeRect(x - 1, y - 1, w + 2, h + 2);
    ctx.strokeStyle = color;
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    if (this.box) {
      const label = `${c1 - c0 + 1} × ${r1 - r0 + 1}`;
      ctx.font = '600 12px system-ui, sans-serif';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'bottom';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,12,16,0.85)';
      ctx.strokeText(label, x, y - 3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x, y - 3);
    }
  }

  private drawVectorBorders(c0: number, c1: number, r0: number, r1: number) {
    const { ctx, scale, ox, oy } = this;
    const th = scale / 2;
    ctx.beginPath();
    for (let r = r0; r < r1; r++) {
      const y = oy + r * th;
      for (let c = c0; c < c1; c++) {
        const i = r * COLS + c;
        const a = zoneArea[i];
        const x = ox + c * scale;
        if (c + 1 < COLS && zoneArea[i + 1] !== a) {
          ctx.moveTo(x + scale, y);
          ctx.lineTo(x + scale, y + th);
        }
        if (r + 1 < ROWS && zoneArea[i + COLS] !== a) {
          ctx.moveTo(x, y + th);
          ctx.lineTo(x + scale, y + th);
        }
      }
    }
    ctx.strokeStyle = `rgba(${BORDER_RGBA[0]},${BORDER_RGBA[1]},${BORDER_RGBA[2]},0.9)`;
    ctx.lineWidth = Math.min(2.5, Math.max(1, scale / 12));
    ctx.lineCap = 'square';
    ctx.stroke();
  }

  private drawZoneLabels() {
    const { ctx, scale, ox, oy } = this;
    const size = Math.round(Math.min(28, Math.max(10, scale * 6)));
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(40,48,66,0.5)';
    for (const a of areaLabels) {
      if (a.level === 6) continue;
      const x = ox + (a.x - MIN_X + 0.5) * scale;
      const y = oy + (a.y - MIN_Y + 0.5) * (scale / 2);
      if (x < -size || y < -size || x > this.w + size || y > this.h + size) continue;
      ctx.fillText(String(a.level), x, y);
    }
  }

  private drawCrosshair(c0: number, c1: number, r0: number, r1: number) {
    const sel = this.store.selected;
    if (sel === null) return;
    const { ctx, scale, ox, oy } = this;
    const th = scale / 2;
    const c = sel % COLS;
    const r = (sel - c) / COLS;
    const bw = Math.max(scale, 2);
    const bh = Math.max(th, 2);
    const x = ox + (c + 0.5) * scale - bw / 2;
    const y = oy + (r + 0.5) * th - bh / 2;
    ctx.fillStyle = 'rgba(255,179,179,0.6)'; // #FFB3B3
    ctx.fillRect(x, oy + r0 * th, bw, (r1 - r0) * th);
    ctx.fillRect(ox + c0 * scale, y, (c1 - c0) * scale, bh);
  }

  private drawGrid(c0: number, c1: number, r0: number, r1: number) {
    const { ctx, scale, ox, oy } = this;
    const th = scale / 2;
    ctx.beginPath();
    for (let c = c0; c <= c1; c++) {
      const x = Math.round(ox + c * scale) + 0.5;
      ctx.moveTo(x, oy + r0 * th);
      ctx.lineTo(x, oy + r1 * th);
    }
    for (let r = r0; r <= r1; r++) {
      const y = Math.round(oy + r * th) + 0.5;
      ctx.moveTo(ox + c0 * scale, y);
      ctx.lineTo(ox + c1 * scale, y);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  /** 39×39 square centred on each treasure / scrap tile, clipped to the map. */
  private drawRanges(c0: number, c1: number, r0: number, r1: number) {
    const { ctx, scale, ox, oy, store } = this;
    const th = scale / 2;
    const show = store.settings.showCodes;
    ctx.lineWidth = 1.5;
    for (const i of store.marked) {
      const m = store.marks[i];
      if (!RANGE_CODES.includes(m) || !show[m]) continue;
      const c = i % COLS;
      const r = (i - c) / COLS;
      const a0 = Math.max(0, c - RANGE_RADIUS);
      const a1 = Math.min(COLS, c + RANGE_RADIUS + 1);
      const b0 = Math.max(0, r - RANGE_RADIUS);
      const b1 = Math.min(ROWS, r + RANGE_RADIUS + 1);
      if (a1 <= c0 || a0 >= c1 || b1 <= r0 || b0 >= r1) continue;
      const x = ox + a0 * scale;
      const y = oy + b0 * th;
      const w = (a1 - a0) * scale;
      const h = (b1 - b0) * th;
      ctx.fillStyle = MARKS[m].color + '24';
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = MARKS[m].color + 'd0';
      ctx.strokeRect(x + 0.75, y + 0.75, w - 1.5, h - 1.5);
    }
  }

  private drawLetters(c0: number, c1: number, r0: number, r1: number) {
    const { ctx, scale, ox, oy, store } = this;
    const th = scale / 2;
    const size = Math.min(th * 0.78, scale * 0.6);
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * COLS + c;
        const m = store.marks[i];
        if (!m || !isActiveMark(m) || !store.settings.showCodes[m]) continue;
        const x = ox + c * scale;
        const y = oy + r * th;
        ctx.fillStyle = MARKS[m].text;
        ctx.fillText(MARKS[m].letter, x + scale / 2, y + th / 2 + 1);
        if (store.notes.has(i)) {
          ctx.beginPath();
          ctx.arc(x + scale - 4, y + 4, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  private drawLandmarks(top: boolean) {
    const { ctx, scale, ox, oy, store } = this;
    const th = scale / 2;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const l of store.landmarks) {
      const color = store.typeOf(l).color;
      const span = l.size * 2 + 1;
      let x = ox + (l.x - MIN_X - l.size) * scale;
      let y = oy + (l.y - MIN_Y - l.size) * th;
      let w = span * scale;
      let h = span * th;
      if (w < 7) {
        x -= (7 - w) / 2;
        w = 7;
      }
      if (h < 7) {
        y -= (7 - h) / 2;
        h = 7;
      }
      if (x > this.w || y > this.h || x + w < 0 || y + h < 0) continue;
      if (!top) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = color;
        ctx.fillRect(x, y, w, h);
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
      if (scale >= LANDMARK_LABEL_SCALE && !this.pinsActive) {
        const label = l.level ? `${l.name} (Lv ${l.level})` : l.name;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,12,16,0.85)';
        ctx.strokeText(label, x + w / 2, y - 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x + w / 2, y - 2);
      }
    }
  }

  private drawSelection() {
    const sel = this.store.selected;
    if (sel === null) return;
    const { ctx, scale, ox, oy } = this;
    const th = scale / 2;
    const c = sel % COLS;
    const r = (sel - c) / COLS;
    const x = ox + c * scale;
    const y = oy + r * th;
    ctx.strokeStyle = '#ff1f1f';
    if (scale < 10) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x + scale / 2, y + th / 2, 9, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ff1f1f';
      ctx.fillRect(x + scale / 2 - Math.max(scale, 2) / 2, y + th / 2 - Math.max(th, 2) / 2, Math.max(scale, 2), Math.max(th, 2));
    } else {
      if (!this.store.marks[sel]) {
        ctx.fillStyle = 'rgba(255,31,31,0.45)';
        ctx.fillRect(x, y, scale, th);
      }
      ctx.lineWidth = 2.5;
      ctx.strokeRect(x, y, scale, th);
    }
  }

  // ------------------------------------------------------------ pins

  /** Groups pin-worthy marks into screen-sized grid cells, split by zone area. Cached until the zoom band or the marks change. */
  private clusters(): Cluster[] {
    const cellC = Math.max(1, 2 ** Math.ceil(Math.log2(CLUSTER_CELL_PX / this.scale)));
    const cellR = cellC * 2; // tiles are half as tall, so this keeps cells square on screen
    const show = this.store.settings.showCodes;
    const key = `${cellC}|${this.marksVersion}|${show.join()}`;
    if (this.clusterCache?.key === key) return this.clusterCache.items;
    const { marks, marked } = this.store;
    const cells = new Map<number, Cluster>();
    for (const i of marked) {
      const m = marks[i];
      if (!show[m] || !PIN_CODES.includes(m)) continue;
      const c = i % COLS;
      const r = (i - c) / COLS;
      // one cluster per grid cell and zone area, so pins never merge across a zone border
      const k = (Math.floor(c / cellC) * 4096 + Math.floor(r / cellR)) * 128 + zoneArea[i];
      let cl = cells.get(k);
      if (!cl) {
        cl = { c: 0, r: 0, count: 0, counts: new Array<number>(CODE_SLOTS).fill(0), index: i, code: m, c0: c, c1: c, r0: r, r1: r };
        cells.set(k, cl);
      }
      cl.c += c;
      cl.r += r;
      cl.count++;
      cl.counts[m]++;
      if (c < cl.c0) cl.c0 = c;
      if (c > cl.c1) cl.c1 = c;
      if (r < cl.r0) cl.r0 = r;
      if (r > cl.r1) cl.r1 = r;
    }
    const items = [...cells.values()];
    for (const cl of items) {
      cl.c /= cl.count;
      cl.r /= cl.count;
      cl.code = PIN_CODES.find((m) => cl.counts[m] > 0)!;
    }
    items.sort((a, b) => a.r - b.r); // lower pins overlap upper ones
    this.clusterCache = { key, items };
    return items;
  }

  /** Teardrop pin with an icon, pre-rendered once per colour/icon/size. */
  private sprite(color: string, icon: PinIcon, size: number): PinSprite {
    const key = `${color}|${icon}|${size}|${this.dpr}`;
    const cached = this.sprites.get(key);
    if (cached) return cached;
    const r = size / 2;
    const pad = 5;
    const w = size + pad * 2;
    const cx = w / 2;
    const cy = pad + r;
    const tip = cy + r * 1.6;
    const h = Math.ceil(tip + pad);
    const [canvas, c] = makeCanvas(Math.ceil(w * this.dpr), Math.ceil(h * this.dpr));
    c.scale(this.dpr, this.dpr);
    c.beginPath();
    c.moveTo(cx, tip);
    c.bezierCurveTo(cx - r * 0.25, tip - r * 0.6, cx - r, cy + r * 0.75, cx - r, cy);
    c.arc(cx, cy, r, Math.PI, 0);
    c.bezierCurveTo(cx + r, cy + r * 0.75, cx + r * 0.25, tip - r * 0.6, cx, tip);
    c.closePath();
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 4;
    c.shadowOffsetY = 1.5;
    c.fillStyle = color;
    c.fill();
    c.shadowColor = 'transparent';
    c.lineWidth = 1.5;
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.stroke();
    const is = size * 0.62;
    drawIcon(c, icon, cx - is / 2, cy - is / 2, is, readableOn(color), color);
    const sprite = { canvas, w, h, ax: cx, ay: tip, cy, r };
    this.sprites.set(key, sprite);
    return sprite;
  }

  /** Cluster bubble with its count badge, pre-rendered (shadows are too slow to draw per frame). */
  private clusterSprite(code: number, count: number): PinSprite {
    const label = count >= 1000 ? `${Math.round(count / 100) / 10}k` : String(count);
    const key = `cluster|${code}|${label}|${this.dpr}`;
    const cached = this.sprites.get(key);
    if (cached) return cached;
    if (this.sprites.size > 800) this.sprites.clear(); // counts vary; keep the cache bounded
    const r = count < 10 ? 14 : count < 100 ? 16 : 18;
    const color = MARKS[code].color;
    const font = '700 10px system-ui, sans-serif';
    const [probe] = makeCanvas(1, 1);
    const pctx = probe.getContext('2d')!;
    pctx.font = font;
    const bw = Math.max(16, pctx.measureText(label).width + 8);
    const halo = r + 6;
    const w = Math.ceil(halo * 2 + bw / 2 + 4);
    const h = Math.ceil(halo * 2 + 10);
    const cx = halo + 2;
    const cy = h - halo - 2;
    const [canvas, c] = makeCanvas(Math.ceil(w * this.dpr), Math.ceil(h * this.dpr));
    c.scale(this.dpr, this.dpr);
    c.globalAlpha = 0.3;
    c.fillStyle = color;
    c.beginPath();
    c.arc(cx, cy, halo, 0, Math.PI * 2);
    c.fill();
    c.globalAlpha = 1;
    c.beginPath();
    c.arc(cx, cy, r, 0, Math.PI * 2);
    c.shadowColor = 'rgba(0,0,0,0.45)';
    c.shadowBlur = 4;
    c.fill();
    c.shadowColor = 'transparent';
    c.lineWidth = 2;
    c.strokeStyle = '#ffffff';
    c.stroke();
    const is = r * 1.15;
    drawIcon(c, MARK_ICONS[code], cx - is / 2, cy - is / 2, is, readableOn(color), color);
    const bx = cx + r * 0.7;
    const by = cy - r * 0.7;
    c.fillStyle = '#e5383b';
    c.beginPath();
    c.roundRect(bx - bw / 2, by - 8, bw, 16, 8);
    c.fill();
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(label, bx, by + 0.5);
    const sprite = { canvas, w, h, ax: cx, ay: cy, cy, r };
    this.sprites.set(key, sprite);
    return sprite;
  }

  private drawPins() {
    const { ctx, scale, ox, oy, store } = this;
    const th = scale / 2;
    const inView = (x: number, y: number) => x > RULER_LEFT - 30 && x < this.w + 30 && y > RULER_TOP - 10 && y < this.h + 60;
    const hits: PinHit[] = [];

    for (const cl of this.clusters()) {
      const x = ox + (cl.c + 0.5) * scale;
      const y = oy + (cl.r + 0.5) * th;
      if (!inView(x, y)) continue;
      const color = MARKS[cl.code].color;
      if (cl.count === 1) {
        const s = this.sprite(color, MARK_ICONS[cl.code], cl.index === store.selected ? 30 : MARK_PIN_SIZE);
        ctx.drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h);
        hits.push({ x, y: y - s.ay + s.cy, r: s.r + 3, kind: 'mark', index: cl.index });
        continue;
      }
      // cluster bubble (pre-rendered): halo, icon of the most important code, count badge
      const s = this.clusterSprite(cl.code, cl.count);
      ctx.drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h);
      const r = s.r;
      hits.push({ x, y, r: r + 4, kind: 'cluster', index: cl.index, cluster: cl });
    }

    // landmarks always on top, with their names
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const l of store.landmarks) {
      const t = store.typeOf(l);
      const x = ox + (l.x - MIN_X + 0.5) * scale;
      const y = oy + (l.y - MIN_Y + 0.5) * th;
      if (!inView(x, y)) continue;
      const s = this.sprite(t.color, typeIcon(t), LANDMARK_PIN_SIZE);
      ctx.drawImage(s.canvas, x - s.ax, y - s.ay, s.w, s.h);
      const label = l.level ? `${l.name} (Lv ${l.level})` : l.name;
      const ly = y - s.ay + 4;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(10,12,16,0.85)';
      ctx.strokeText(label, x, ly);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(label, x, ly);
      hits.push({ x, y: y - s.ay + s.cy, r: s.r + 3, kind: 'landmark', index: toIndex(l.x, l.y) });
    }
    this.pinHits = hits;
  }

  private pinAt(x: number, y: number): PinHit | null {
    for (let k = this.pinHits.length - 1; k >= 0; k--) {
      const h = this.pinHits[k];
      if ((x - h.x) ** 2 + (y - h.y) ** 2 <= h.r * h.r) return h;
    }
    return null;
  }

  private activatePin(hit: PinHit) {
    this.onHover(null); // the view is about to move away from the pointer
    this.overPin = false;
    const cl = hit.cluster;
    if (cl) {
      // zoom in on the cluster's members
      const bw = cl.c1 - cl.c0 + 1;
      const bh = (cl.r1 - cl.r0 + 1) / 2;
      const fit = Math.min(this.viewW / (bw + 4), this.viewH / (bh + 4)) * 0.8;
      this.animateTo((cl.c0 + cl.c1 + 1) / 2, (cl.r0 + cl.r1 + 1) / 4, Math.min(30, Math.max(fit, this.scale * 2)));
      return;
    }
    this.store.select(hit.index);
    this.goTo(hit.index);
  }

  // ------------------------------------------------------------ tile card

  /** The DOM card for the selected tile; the view keeps it next to the tile while panning/zooming. */
  attachCard(el: HTMLElement | null) {
    this.card = el;
    this.requestRender();
  }

  private positionCard() {
    const el = this.card;
    if (!el) return;
    const sel = this.store.selected;
    const th = this.scale / 2;
    const c = sel === null ? 0 : sel % COLS;
    const r = sel === null ? 0 : (sel - c) / COLS;
    const x = this.ox + (c + 0.5) * this.scale;
    const yTop = this.oy + r * th;
    const yBot = yTop + th;
    const brushing = this.store.settings.tool !== 'select'; // the brush banner takes over while painting
    if (sel === null || brushing || x < RULER_LEFT || x > this.w || yBot < RULER_TOP || yTop > this.h) {
      el.style.visibility = 'hidden';
      return;
    }
    const cw = el.offsetWidth;
    const ch = el.offsetHeight;
    const hasPin =
      this.pinsActive &&
      (PIN_CODES.includes(this.store.marks[sel]) || this.store.landmarks.some((l) => toIndex(l.x, l.y) === sel));
    const gap = hasPin ? 46 : 12; // clear the pin drawn above the tile
    let top = yTop - gap - ch;
    if (top < RULER_TOP + 4) top = yBot + 12;
    top = Math.max(RULER_TOP + 4, Math.min(top, this.h - ch - 4)); // stay inside the map area (e.g. above the phone sheet)
    const left = Math.max(RULER_LEFT + 4, Math.min(this.w - cw - 4, x - cw / 2));
    el.style.visibility = 'visible';
    el.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  /** Pans (keeping the zoom) so a tile is comfortably inside the view. */
  ensureVisible(index: number) {
    const c = index % COLS;
    const r = (index - c) / COLS;
    const x = this.ox + (c + 0.5) * this.scale;
    const y = this.oy + (r + 0.5) * (this.scale / 2);
    const m = 60;
    if (x > RULER_LEFT + m && x < this.w - m && y > RULER_TOP + m && y < this.h - m) return;
    this.animateTo(c + 0.5, (r + 0.5) / 2, this.scale);
  }

  private pickStep(pxPerUnit: number, minPx: number): number {
    return RULER_STEPS.find((s) => s * pxPerUnit >= minPx) ?? RULER_STEPS[RULER_STEPS.length - 1];
  }

  private drawRulers(c0: number, c1: number, r0: number, r1: number) {
    const { ctx, scale, ox, oy, theme, w, h } = this;
    const th = scale / 2;
    ctx.fillStyle = theme.rulerBg;
    ctx.fillRect(0, 0, w, RULER_TOP);
    ctx.fillRect(0, 0, RULER_LEFT, h);
    ctx.font = '10px system-ui, sans-serif';

    const marker = (index: number, color: string) => {
      const c = index % COLS;
      const r = (index - c) / COLS;
      ctx.fillStyle = color;
      ctx.fillRect(ox + c * scale, RULER_TOP - 4, Math.max(scale, 2), 4);
      ctx.fillRect(RULER_LEFT - 4, oy + r * th, 4, Math.max(th, 2));
    };

    // top (X)
    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER_LEFT, 0, w - RULER_LEFT, RULER_TOP);
    ctx.clip();
    if (this.hover >= 0) marker(this.hover, theme.accent);
    if (this.store.selected !== null) marker(this.store.selected, '#ff3b3b');
    const stepX = this.pickStep(scale, 44);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.strokeStyle = theme.rulerTick;
    ctx.beginPath();
    let lastLabel = -Infinity;
    for (let c = c0; c < c1; c++) {
      const X = c + MIN_X;
      const major = X % stepX === 0 || X === MIN_X || X === MAX_X;
      const minor = scale >= 6 || X % Math.max(1, stepX / 5) === 0;
      const x = Math.round(ox + (c + 0.5) * scale) + 0.5;
      if (major && x - lastLabel >= 34) {
        ctx.moveTo(x, RULER_TOP - 7);
        ctx.lineTo(x, RULER_TOP);
        ctx.fillStyle = theme.rulerText;
        ctx.fillText(String(X), x, 3);
        lastLabel = x;
      } else if (minor && stepX <= 50 && (scale >= 3 || X % 5 === 0)) {
        ctx.moveTo(x, RULER_TOP - 3);
        ctx.lineTo(x, RULER_TOP);
      }
    }
    ctx.stroke();
    ctx.restore();

    // left (Y)
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, RULER_TOP, RULER_LEFT, h - RULER_TOP);
    ctx.clip();
    if (this.hover >= 0) marker(this.hover, theme.accent);
    if (this.store.selected !== null) marker(this.store.selected, '#ff3b3b');
    const stepY = this.pickStep(th, 22);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.strokeStyle = theme.rulerTick;
    ctx.beginPath();
    lastLabel = -Infinity;
    for (let r = r0; r < r1; r++) {
      const Y = r + MIN_Y;
      const major = Y % stepY === 0 || Y === MIN_Y || Y === MAX_Y;
      const y = Math.round(oy + (r + 0.5) * th) + 0.5;
      if (major && y - lastLabel >= 16) {
        ctx.moveTo(RULER_LEFT - 6, y);
        ctx.lineTo(RULER_LEFT, y);
        ctx.fillStyle = theme.rulerText;
        ctx.fillText(String(Y), RULER_LEFT - 8, y);
        lastLabel = y;
      } else if (th >= 4 || Y % Math.max(1, stepY / 5) === 0) {
        if (stepY <= 50) {
          ctx.moveTo(RULER_LEFT - 3, y);
          ctx.lineTo(RULER_LEFT, y);
        }
      }
    }
    ctx.stroke();
    ctx.restore();

    // corner + edges
    ctx.fillStyle = theme.rulerBg;
    ctx.fillRect(0, 0, RULER_LEFT, RULER_TOP);
    ctx.fillStyle = theme.rulerText;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('X/Y', RULER_LEFT / 2, RULER_TOP / 2);
    ctx.fillStyle = theme.rulerTick;
    ctx.fillRect(RULER_LEFT, RULER_TOP - 1, w - RULER_LEFT, 1);
    ctx.fillRect(RULER_LEFT - 1, RULER_TOP, 1, h - RULER_TOP);
  }
}
