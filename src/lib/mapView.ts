import { COLS, MAX_X, MAX_Y, MIN_X, MIN_Y, ROWS, TILE_COUNT, toIndex } from './coords';
import {
  ISO_SIZE,
  ISO_TILE,
  MAP_X0,
  MAP_X1,
  MAP_Y0,
  MAP_Y1,
  TILE_ISO,
  centerX,
  centerY,
  diamondTiles,
  fromIso,
  mapOutline,
  tileAtWorld,
  tileCenter,
  worldToIso,
} from './grid';
import { MARK_ICONS, PinIcon, drawIcon, readableOn } from './icons';
import { CODE_SLOTS, MARKS, PIN_CODES, RANGE_CODES, RANGE_RADIUS, isActiveMark } from './marks';
import { typeIcon, type Store, type StoreEvent } from './store';
import { LEVEL_COLORS, areaLabels, zoneArea, zoneLevel } from './zones';

// World units: 1 unit = one tile width. Tiles are diamonds 1 wide and 1 tall in staggered rows
// 0.5 apart (see grid.ts), so the 507 x 1019 grid is drawn as a square.
// screen = offset + world * scale. Textures live in the 45°-turned "iso" grid, one pixel per tile.

export const RULER_TOP = 22;
export const RULER_LEFT = 38;

const MAX_SCALE = 96; // max tile width in CSS px
const VECTOR_BORDER_SCALE = 3.5; // draw borders as lines from here (below: darkened border tiles)
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
  x: number; // mean tile centre, world units
  y: number;
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

/** Traces a diamond centred on (x, y) with half-width hw and half-height hh. */
function diamondPath(ctx: CanvasRenderingContext2D, x: number, y: number, hw: number, hh: number) {
  ctx.moveTo(x, y - hh);
  ctx.lineTo(x + hw, y);
  ctx.lineTo(x, y + hh);
  ctx.lineTo(x - hw, y);
  ctx.closePath();
}

function isoOf(i: number): [number, number] {
  const p = TILE_ISO[i];
  const u = p % ISO_SIZE;
  return [u, (p - u) / ISO_SIZE];
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
  private borderCanvas: HTMLCanvasElement;
  private rangeCanvas: HTMLCanvasElement;
  private rangeCtx: CanvasRenderingContext2D;
  private rangeImg: ImageData;
  private rangeEdgeCanvas: HTMLCanvasElement;
  private rangeEdgeCtx: CanvasRenderingContext2D;
  private rangeEdgeImg: ImageData;
  private rangeBits = new Uint8Array(ISO_SIZE * ISO_SIZE);
  private rangeKey = '';
  private rangeVersion = '';
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
    this.borderCanvas = this.buildBorderCanvas();
    [this.rangeCanvas, this.rangeCtx] = makeCanvas(ISO_SIZE, ISO_SIZE);
    this.rangeImg = this.rangeCtx.createImageData(ISO_SIZE, ISO_SIZE);
    [this.rangeEdgeCanvas, this.rangeEdgeCtx] = makeCanvas(ISO_SIZE, ISO_SIZE);
    this.rangeEdgeImg = this.rangeEdgeCtx.createImageData(ISO_SIZE, ISO_SIZE);
    [this.marksCanvas, this.marksCtx] = makeCanvas(ISO_SIZE, ISO_SIZE);
    this.marksImg = this.marksCtx.createImageData(ISO_SIZE, ISO_SIZE);
    this.marksU32 = new Uint32Array(this.marksImg.data.buffer);
    this.markColors = Array.from({ length: CODE_SLOTS }, (_, c) => c).map((c) => (c ? packRgba(...hexToRgb(MARKS[c].color)) : 0));
    this.rebuildMarks();
    this.readTheme();
    if (import.meta.env.DEV) (window as unknown as { mapView: MapView }).mapView = this; // for profiling in dev tools

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
    const [c, ctx] = makeCanvas(ISO_SIZE, ISO_SIZE);
    const img = ctx.createImageData(ISO_SIZE, ISO_SIZE);
    const u32 = new Uint32Array(img.data.buffer);
    const lut = [0, 1, 2, 3, 4, 5, 6].map((l) => (l ? packRgba(...hexToRgb(LEVEL_COLORS[l])) : 0));
    for (let i = 0; i < TILE_COUNT; i++) u32[TILE_ISO[i]] = lut[zoneLevel[i]];
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /** Area of an iso cell, or -1 outside the map. */
  private isoArea(u: number, v: number): number {
    if (u < 0 || v < 0 || u >= ISO_SIZE || v >= ISO_SIZE) return -1;
    const i = ISO_TILE[u + v * ISO_SIZE];
    return i < 0 ? -1 : zoneArea[i];
  }

  /** Transparent iso texture with the tiles along area borders darkened (used when zoomed out). */
  private buildBorderCanvas(): HTMLCanvasElement {
    const [c, ctx] = makeCanvas(ISO_SIZE, ISO_SIZE);
    const img = ctx.createImageData(ISO_SIZE, ISO_SIZE);
    const u32 = new Uint32Array(img.data.buffer);
    const px = packRgba(BORDER_RGBA[0], BORDER_RGBA[1], BORDER_RGBA[2], BORDER_RGBA[3]);
    for (let v = 0; v < ISO_SIZE; v++) {
      for (let u = 0; u < ISO_SIZE; u++) {
        const a = this.isoArea(u, v);
        if (a < 0) continue;
        const ar = this.isoArea(u + 1, v);
        const ad = this.isoArea(u, v + 1);
        if ((ar >= 0 && ar !== a) || (ad >= 0 && ad !== a)) u32[u + v * ISO_SIZE] = px;
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
    for (const i of this.store.marked) this.marksU32[TILE_ISO[i]] = this.markPixel(i);
    this.marksCtx.putImageData(this.marksImg, 0, 0);
    this.showCodesKey = this.store.settings.showCodes.join();
  }

  private updateMarks(indices: number[]) {
    let u0 = ISO_SIZE, u1 = -1, v0 = ISO_SIZE, v1 = -1;
    for (const i of indices) {
      this.marksU32[TILE_ISO[i]] = this.markPixel(i);
      const [u, v] = isoOf(i);
      if (u < u0) u0 = u;
      if (u > u1) u1 = u;
      if (v < v0) v0 = v;
      if (v > v1) v1 = v;
    }
    if (u1 >= 0) this.marksCtx.putImageData(this.marksImg, 0, 0, u0, v0, u1 - u0 + 1, v1 - v0 + 1);
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
    const [x, y] = tileCenter(index);
    this.animateTo(x, y, Math.max(this.scale, minScale));
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
    const wx = (sx - this.ox) / this.scale;
    const wy = (sy - this.oy) / this.scale;
    if (wx < MAP_X0 || wx > MAP_X1 || wy < MAP_Y0 || wy > MAP_Y1) return -1; // tileAtWorld finds the exact diamond
    return tileAtWorld(wx, wy);
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
    this.requestRender(); // e.g. refresh the treasure / scrap areas after a stroke
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

  /** Paints (or erases) a brush-sized diamond around each tile on the line from the previous one, so fast drags leave no gaps. */
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
      for (const j of diamondTiles(centre, radius)) paintOne(j);
    };
    if (this.lastPaint < 0) paint(i);
    else {
      // walk the iso grid so every tile between the two points is covered
      let [x0, y0] = isoOf(this.lastPaint);
      const [x1, y1] = isoOf(i);
      const dx = Math.abs(x1 - x0);
      const dy = -Math.abs(y1 - y0);
      const sx = x0 < x1 ? 1 : -1;
      const sy = y0 < y1 ? 1 : -1;
      let err = dx + dy;
      for (;;) {
        const j = fromIso(x0, y0);
        if (j >= 0) paint(j);
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

  /** Visible part of the iso grid (whole cells, clamped to the texture). */
  private isoView = { u0: 0, u1: 0, v0: 0, v1: 0 };

  private updateIsoView() {
    const { scale, ox, oy } = this;
    const xs = [RULER_LEFT, this.w].map((x) => (x - ox) / scale);
    const ys = [RULER_TOP, this.h].map((y) => (y - oy) / scale);
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const x of xs) {
      for (const y of ys) {
        const [u, v] = worldToIso(x, y);
        u0 = Math.min(u0, u);
        u1 = Math.max(u1, u);
        v0 = Math.min(v0, v);
        v1 = Math.max(v1, v);
      }
    }
    const clamp = (n: number) => Math.min(ISO_SIZE, Math.max(0, n));
    this.isoView = { u0: clamp(Math.floor(u0) - 1), u1: clamp(Math.ceil(u1) + 1), v0: clamp(Math.floor(v0) - 1), v1: clamp(Math.ceil(v1) + 1) };
  }

  /** Switches the context to iso cells (1 unit = one tile, turned 45°), shifted by (dx, dy) CSS px. */
  private setIsoTransform(dx = 0, dy = 0) {
    const { dpr, scale } = this;
    const k = (scale / 2) * dpr;
    this.ctx.setTransform(k, k, -k, k, dpr * (this.ox + dx + (scale * COLS) / 2), dpr * (this.oy + dy + scale * (0.25 - COLS / 2)));
  }

  private resetTransform() {
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  /** Draws the visible part of an iso texture; each texel lands on its tile's diamond. */
  private drawIso(img: HTMLCanvasElement, dx = 0, dy = 0) {
    const { u0, u1, v0, v1 } = this.isoView;
    if (u1 <= u0 || v1 <= v0) return;
    this.setIsoTransform(dx, dy);
    this.ctx.drawImage(img, u0, v0, u1 - u0, v1 - v0, u0, v0, u1 - u0, v1 - v0);
    this.resetTransform();
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

    // visible tile range (rows/columns, one extra on each side for the staggered diamonds)
    const c0 = Math.max(0, Math.floor((RULER_LEFT - ox) / scale) - 1);
    const c1 = Math.min(COLS, Math.ceil((this.w - ox) / scale) + 1);
    const r0 = Math.max(0, Math.floor((RULER_TOP - oy) / th) - 2);
    const r1 = Math.min(ROWS, Math.ceil((this.h - oy) / th) + 2);
    this.updateIsoView();

    ctx.save();
    ctx.beginPath();
    ctx.rect(RULER_LEFT, RULER_TOP, this.viewW, this.viewH);
    ctx.clip();

    if (c0 < c1 && r0 < r1) {
      // map layers, clipped to the map's zigzag outline (edge tiles stay whole)
      const mx = ox + MAP_X0 * scale;
      const my = oy + MAP_Y0 * scale;
      const mw = (MAP_X1 - MAP_X0) * scale;
      const mh = (MAP_Y1 - MAP_Y0) * scale;
      ctx.save();
      ctx.setTransform(this.dpr * scale, 0, 0, this.dpr * scale, this.dpr * ox, this.dpr * oy);
      ctx.clip(mapOutline());
      this.resetTransform();

      ctx.imageSmoothingEnabled = false;
      if (settings.showZones) {
        this.drawIso(this.zoneCanvas);
        if (scale < VECTOR_BORDER_SCALE) this.drawIso(this.borderCanvas);
        else this.drawVectorBorders();
      } else {
        ctx.fillStyle = theme.mapEmpty;
        ctx.fillRect(mx, my, mw, mh);
      }

      if (settings.dimUnmarked) {
        ctx.fillStyle = 'rgba(8,10,14,0.62)';
        ctx.fillRect(mx, my, mw, mh);
      }

      if (settings.showRanges) this.drawRanges();
      this.drawCrosshair(c0, c1, r0, r1);
      this.drawLandmarks(false);

      // marks
      if (scale < BIG_MARK_SCALE) {
        // tiles are ~1-3px here: dilate marks by drawing the texture shifted +-1px so they stay visible
        for (const dy of [-1, 0, 1]) for (const dx of [-1, 0, 1]) this.drawIso(this.marksCanvas, dx, dy);
      } else this.drawIso(this.marksCanvas);

      if (scale >= GRID_SCALE) this.drawGrid();
      ctx.restore();

      if (settings.showZones && scale < ZONE_LABEL_MAX_SCALE) this.drawZoneLabels();
      if (scale >= LETTER_SCALE) this.drawLetters(c0, c1, r0, r1);
      this.drawLandmarks(true);
      this.drawSelection();
      this.drawBrushPreview();
      if (this.hover >= 0 && scale >= 4 && settings.tool === 'select') {
        const [hx, hy] = tileCenter(this.hover);
        ctx.strokeStyle = 'rgba(255,255,255,0.95)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        diamondPath(ctx, ox + hx * scale, oy + hy * scale, scale / 2, scale / 2);
        ctx.stroke();
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
    const code = this.box ? this.paintCode : tool === 'select' ? 0 : tool;
    const color = code ? MARKS[code].color : '#ff4d4d';
    const outline = () => {
      ctx.setLineDash(code ? [] : [5, 3]);
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.strokeStyle = color;
      ctx.stroke();
      ctx.setLineDash([]);
    };

    if (!this.box) {
      // brush: a diamond of (2r+1) tiles across, centred on the hovered tile
      if (this.hover < 0 || this.mode === 'pan' || this.mode === 'pinch') return;
      const r = store.settings.brushShape === 'box' ? 0 : store.settings.brushSize;
      const [hx, hy] = tileCenter(this.hover);
      const half = Math.max(4, (r + 0.5) * scale);
      ctx.beginPath();
      diamondPath(ctx, ox + hx * scale, oy + hy * scale, half, half);
      outline();
      return;
    }

    // box: the rows and columns between the two corner tiles
    const { c0, c1, r0, r1 } = boxBounds(this.box.a, this.box.b);
    let x = ox + (c0 + 0.25) * scale;
    let y = oy + (centerY(r0) - 0.25) * scale;
    let w = (c1 - c0 + 1) * scale;
    let h = (r1 - r0 + 1) * (scale / 2);
    if (w < 6) {
      x -= (6 - w) / 2;
      w = 6;
    }
    if (h < 6) {
      y -= (6 - h) / 2;
      h = 6;
    }
    ctx.globalAlpha = 0.25;
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    outline();
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

  /** Area borders as lines along the diamond edges, drawn in iso space. */
  private drawVectorBorders() {
    const { ctx, scale } = this;
    const { u0, u1, v0, v1 } = this.isoView;
    this.setIsoTransform();
    ctx.beginPath();
    for (let v = v0; v < v1; v++) {
      for (let u = u0; u < u1; u++) {
        const a = this.isoArea(u, v);
        if (a < 0) continue;
        const ar = this.isoArea(u + 1, v);
        if (ar >= 0 && ar !== a) {
          ctx.moveTo(u + 1, v);
          ctx.lineTo(u + 1, v + 1);
        }
        const ad = this.isoArea(u, v + 1);
        if (ad >= 0 && ad !== a) {
          ctx.moveTo(u, v + 1);
          ctx.lineTo(u + 1, v + 1);
        }
      }
    }
    ctx.strokeStyle = `rgba(${BORDER_RGBA[0]},${BORDER_RGBA[1]},${BORDER_RGBA[2]},0.9)`;
    ctx.lineWidth = (Math.min(2.5, Math.max(1, scale / 12)) * Math.SQRT2) / scale; // CSS px -> iso units
    ctx.lineCap = 'square';
    ctx.stroke();
    this.resetTransform();
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
      const r = a.y - MIN_Y;
      const x = ox + centerX(a.x - MIN_X, r) * scale;
      const y = oy + centerY(r) * scale;
      if (x < -size || y < -size || x > this.w + size || y > this.h + size) continue;
      ctx.fillText(String(a.level), x, y);
    }
  }

  /** Highlights the selected tile's row (Y) and column (X). */
  private drawCrosshair(c0: number, c1: number, r0: number, r1: number) {
    const sel = this.store.selected;
    if (sel === null) return;
    const { ctx, scale, ox, oy } = this;
    const th = scale / 2;
    const [cx, cy] = tileCenter(sel);
    const bw = Math.max(scale, 2);
    const bh = Math.max(th, 2);
    ctx.fillStyle = 'rgba(255,179,179,0.6)'; // #FFB3B3
    ctx.fillRect(ox + cx * scale - bw / 2, oy + r0 * th, bw, (r1 - r0) * th);
    ctx.fillRect(ox + c0 * scale, oy + cy * scale - bh / 2, (c1 - c0 + 1) * scale, bh);
  }

  /** Diamond grid: the lines of the iso grid. */
  private drawGrid() {
    const { ctx, scale } = this;
    const { u0, u1, v0, v1 } = this.isoView;
    this.setIsoTransform();
    ctx.beginPath();
    for (let u = u0; u <= u1; u++) {
      ctx.moveTo(u, v0);
      ctx.lineTo(u, v1);
    }
    for (let v = v0; v <= v1; v++) {
      ctx.moveTo(u0, v);
      ctx.lineTo(u1, v);
    }
    ctx.strokeStyle = 'rgba(0,0,0,0.16)';
    ctx.lineWidth = Math.SQRT2 / scale; // 1 CSS px
    ctx.stroke();
    this.resetTransform();
  }

  /** Rebuilds the range coverage (bit k = inside a RANGE_CODES[k] area) and its two textures. */
  private rebuildRanges() {
    const { store } = this;
    const show = store.settings.showCodes;
    const bits = this.rangeBits;
    const N = ISO_SIZE;
    bits.fill(0);
    RANGE_CODES.forEach((code, k) => {
      if (!show[code]) return;
      const bit = 1 << k;
      for (const i of store.marked) {
        if (store.marks[i] !== code) continue;
        const [u, v] = isoOf(i);
        const a0 = Math.max(0, u - RANGE_RADIUS);
        const a1 = Math.min(N - 1, u + RANGE_RADIUS);
        for (let b = Math.max(0, v - RANGE_RADIUS); b <= Math.min(N - 1, v + RANGE_RADIUS); b++) {
          for (let a = a0; a <= a1; a++) bits[a + b * N] |= bit;
        }
      }
    });
    const colors = RANGE_CODES.map((c) => packRgba(...hexToRgb(MARKS[c].color)));
    const fill = new Uint32Array(this.rangeImg.data.buffer);
    const edge = new Uint32Array(this.rangeEdgeImg.data.buffer);
    fill.fill(0);
    edge.fill(0);
    for (let v = 0; v < N; v++) {
      for (let u = 0; u < N; u++) {
        const p = u + v * N;
        const m = bits[p];
        if (!m) continue;
        for (let k = RANGE_CODES.length - 1; k >= 0; k--) {
          if (!(m & (1 << k))) continue;
          if (!fill[p]) fill[p] = colors[k];
          const bit = 1 << k;
          const inside = (q: number) => (bits[q] & bit) !== 0;
          if (u === 0 || u === N - 1 || v === 0 || v === N - 1 || !inside(p - 1) || !inside(p + 1) || !inside(p - N) || !inside(p + N)) {
            edge[p] = colors[k];
          }
        }
      }
    }
    this.rangeCtx.putImageData(this.rangeImg, 0, 0);
    this.rangeEdgeCtx.putImageData(this.rangeEdgeImg, 0, 0);
  }

  /** 39×39 diamond around each treasure / scrap tile; overlapping areas merge into one outlined region. */
  private drawRanges() {
    const { ctx, scale, store } = this;
    // rebuild only when treasure / scrap tiles changed, and not in the middle of a stroke
    const version = `${this.marksVersion}|${store.settings.showCodes.join()}`;
    if (this.rangeVersion !== version && this.mode !== 'paint' && this.mode !== 'box') {
      this.rangeVersion = version;
      let hash = 0;
      for (const i of store.marked) if (RANGE_CODES.includes(store.marks[i])) hash = (hash * 31 + i * 7 + store.marks[i]) | 0;
      const key = `${hash}|${store.settings.showCodes.join()}`;
      if (this.rangeKey !== key) {
        this.rangeKey = key;
        this.rebuildRanges();
      }
    }
    ctx.globalAlpha = 0.2;
    this.drawIso(this.rangeCanvas);
    ctx.globalAlpha = 1;

    if (scale < VECTOR_BORDER_SCALE) {
      // tiles are tiny: the baked outline (one tile wide) reads as a thin line
      ctx.globalAlpha = 0.85;
      this.drawIso(this.rangeEdgeCanvas);
      ctx.globalAlpha = 1;
      return;
    }
    // outline of the merged areas along diamond edges, for the visible cells only
    const { u0, u1, v0, v1 } = this.isoView;
    const bits = this.rangeBits;
    const N = ISO_SIZE;
    this.setIsoTransform();
    ctx.lineWidth = 1.5 * (Math.SQRT2 / scale);
    RANGE_CODES.forEach((code, k) => {
      const bit = 1 << k;
      ctx.beginPath();
      for (let v = Math.max(0, v0 - 1); v < Math.min(N - 1, v1); v++) {
        for (let u = Math.max(0, u0 - 1); u < Math.min(N - 1, u1); u++) {
          const p = u + v * N;
          const here = bits[p] & bit;
          if (here !== (bits[p + 1] & bit)) {
            ctx.moveTo(u + 1, v);
            ctx.lineTo(u + 1, v + 1);
          }
          if (here !== (bits[p + N] & bit)) {
            ctx.moveTo(u, v + 1);
            ctx.lineTo(u + 1, v + 1);
          }
        }
      }
      ctx.strokeStyle = MARKS[code].color + 'e0';
      ctx.stroke();
    });
    this.resetTransform();
  }

  private drawLetters(c0: number, c1: number, r0: number, r1: number) {
    const { ctx, scale, ox, oy, store } = this;
    const size = scale * 0.36;
    ctx.font = `700 ${size}px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let r = r0; r < r1; r++) {
      for (let c = c0; c < c1; c++) {
        const i = r * COLS + c;
        const m = store.marks[i];
        if (!m || !isActiveMark(m) || !store.settings.showCodes[m]) continue;
        const x = ox + centerX(c, r) * scale;
        const y = oy + centerY(r) * scale;
        ctx.fillStyle = MARKS[m].text;
        ctx.fillText(MARKS[m].letter, x, y + 1);
        if (store.notes.has(i)) {
          ctx.beginPath();
          ctx.arc(x + scale * 0.27, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }
  }

  /** Landmark footprints: a diamond reaching `size` tiles from the centre tile. */
  private drawLandmarks(top: boolean) {
    const { ctx, scale, ox, oy, store } = this;
    ctx.font = '600 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    for (const l of store.landmarks) {
      const color = store.typeOf(l).color;
      const r = l.y - MIN_Y;
      const x = ox + centerX(l.x - MIN_X, r) * scale;
      const y = oy + centerY(r) * scale;
      const half = Math.max(4, (l.size + 0.5) * scale);
      if (x - half > this.w || y - half > this.h || x + half < 0 || y + half < 0) continue;
      ctx.beginPath();
      diamondPath(ctx, x, y, half, half);
      if (!top) {
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = color;
        ctx.fill();
        ctx.globalAlpha = 1;
        continue;
      }
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.stroke();
      if (scale >= LANDMARK_LABEL_SCALE && !this.pinsActive) {
        const label = l.level ? `${l.name} (Lv ${l.level})` : l.name;
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(10,12,16,0.85)';
        ctx.strokeText(label, x, y - half - 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, x, y - half - 2);
      }
    }
  }

  private drawSelection() {
    const sel = this.store.selected;
    if (sel === null) return;
    const { ctx, scale, ox, oy } = this;
    const [cx, cy] = tileCenter(sel);
    const x = ox + cx * scale;
    const y = oy + cy * scale;
    ctx.strokeStyle = '#ff1f1f';
    ctx.fillStyle = '#ff1f1f';
    if (scale < 10) {
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, y, 9, 0, Math.PI * 2);
      ctx.stroke();
      const half = Math.max(scale / 2, 1.5);
      ctx.beginPath();
      diamondPath(ctx, x, y, half, half);
      ctx.fill();
    } else {
      ctx.beginPath();
      diamondPath(ctx, x, y, scale / 2, scale / 2);
      if (!this.store.marks[sel]) {
        ctx.fillStyle = 'rgba(255,31,31,0.45)';
        ctx.fill();
      }
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }
  }

  // ------------------------------------------------------------ pins

  /** Groups pin-worthy marks into screen-sized grid cells, split by zone area and mark code. Cached until the zoom band or the marks change. */
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
      // one cluster per grid cell, zone area and mark code: pins never merge across a zone border or between codes
      const k = ((Math.floor(c / cellC) * 4096 + Math.floor(r / cellR)) * 128 + zoneArea[i]) * CODE_SLOTS + m;
      let cl = cells.get(k);
      if (!cl) {
        cl = { x: 0, y: 0, count: 0, counts: new Array<number>(CODE_SLOTS).fill(0), index: i, code: m, c0: c, c1: c, r0: r, r1: r };
        cells.set(k, cl);
      }
      cl.x += centerX(c, r);
      cl.y += centerY(r);
      cl.count++;
      cl.counts[m]++;
      if (c < cl.c0) cl.c0 = c;
      if (c > cl.c1) cl.c1 = c;
      if (r < cl.r0) cl.r0 = r;
      if (r > cl.r1) cl.r1 = r;
    }
    const items = [...cells.values()];
    for (const cl of items) {
      cl.x /= cl.count;
      cl.y /= cl.count;
      cl.code = PIN_CODES.find((m) => cl.counts[m] > 0)!;
    }
    items.sort((a, b) => a.y - b.y); // lower pins overlap upper ones
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
    const inView = (x: number, y: number) => x > RULER_LEFT - 30 && x < this.w + 30 && y > RULER_TOP - 10 && y < this.h + 60;
    const hits: PinHit[] = [];

    for (const cl of this.clusters()) {
      const x = ox + cl.x * scale;
      const y = oy + cl.y * scale;
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
      const [lx, ly0] = tileCenter(toIndex(l.x, l.y));
      const x = ox + lx * scale;
      const y = oy + ly0 * scale;
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
    const [cx, cy] = tileCenter(sel ?? 0);
    const x = this.ox + cx * this.scale;
    const yTop = this.oy + (cy - 0.5) * this.scale;
    const yBot = yTop + this.scale;
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
    const [cx, cy] = tileCenter(index);
    const x = this.ox + cx * this.scale;
    const y = this.oy + cy * this.scale;
    const m = 60;
    if (x > RULER_LEFT + m && x < this.w - m && y > RULER_TOP + m && y < this.h - m) return;
    this.animateTo(cx, cy, this.scale);
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
