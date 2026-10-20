// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · the board
//
// A 1600×900 logical drawing surface backed by one 2D canvas, which the 3D
// scene uploads as a texture onto the glass panel. Each op from the model
// becomes an Item that knows its bounding box, its "ink length" (weight) and
// how to draw itself at progress p ∈ [0,1].
//
// Performance model:
//   • Finished items are "baked" into an offscreen canvas once.
//   • Each frame we only redraw the bake + the 1–2 items currently being
//     written, and only when something changed (`dirty`). An idle board
//     costs nothing: no redraw, no texture upload.
// ─────────────────────────────────────────────────────────────────────────────

import { wobble, polyline, oval, arc, arrowHead, bent, Path } from './ink.js';
import { typeset, HAND_FONT } from './mathtex.js';
import { compile, sample } from './expr.js';

export const W = 1600, H = 900;

/** Chalk on smoked glass. White is DAOD's off-white. */
export const COLOURS = /** @type {Record<string,string>} */ ({
  white: '#f0ede6', yellow: '#ffd866', blue: '#7cc4ff', green: '#8fe3a0', pink: '#ff94c6',
  orange: '#ffb066', red: '#ff7070', purple: '#c4a8ff', grey: '#9a958c', gray: '#9a958c',
});

const COL = { x0: 70, x1: 770 };          // the writing column
const FLOW_TOP_WITH_TITLE = 150, FLOW_TOP = 70, FLOW_BOTTOM = 860;

/** @typedef {number[]} Pt  [x, y] */
/** @typedef {{x:number,y:number,w:number,h:number}} Rect */
/**
 * @typedef {object} Item
 * @property {string} id
 * @property {string} kind
 * @property {Rect} box            bounding box on the board
 * @property {number} weight       ink length in board px — drives pen timing
 * @property {boolean} [flow]      placed by the writing column's flow layout
 * @property {string} [desc]       one-line description for the model
 * @property {any} [axes]          axes mapping (axes items only)
 * @property {Pt[]} [ends]         endpoints, for straight lines
 * @property {(g:CanvasRenderingContext2D, p:number)=>Pt|null} draw
 */

const measure = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));
const clamp01 = (/** @type {number} */ v) => Math.max(0, Math.min(1, v));
const smooth = (/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ v) => { const t = clamp01((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const finite = (/** @type {any} */ v, /** @type {number} */ d) => (typeof v === 'number' && Number.isFinite(v) ? v : d);

export class Board {
  /** @param {{scale?: number}} [opts] */
  constructor(opts = {}) {
    // Texture resolution: 1.28 × logical = 2048×1152, crisp on a 4K screen.
    this.scale = opts.scale ?? 1.28;
    this.canvas = document.createElement('canvas');
    this.canvas.width = Math.round(W * this.scale);
    this.canvas.height = Math.round(H * this.scale);
    this.g = /** @type {CanvasRenderingContext2D} */ (this.canvas.getContext('2d'));
    this.bake = document.createElement('canvas');
    this.bake.width = this.canvas.width; this.bake.height = this.canvas.height;
    this.bg = /** @type {CanvasRenderingContext2D} */ (this.bake.getContext('2d'));
    /** @type {Map<string, Item>} */ this.items = new Map();   // everything on the board, by id
    /** @type {Set<Item>} */ this.done = new Set();             // fully drawn (in the bake)
    /** @type {Set<Item>} */ this.active = new Set();           // being written right now
    /** @type {{item:Item, t0:number}[]} */ this.fading = [];   // erased items fading out
    /** @type {{canvas:HTMLCanvasElement, t0:number}|null} */ this.wipe = null; // whole-board clear
    this.cursorY = FLOW_TOP;
    this.hasTitle = false;
    this.seq = 0;
    /** @type {any} */ this.lastAxes = null;
    /** @type {Pt|null} pen tip on the board, or null when the pen is lifted */
    this.pen = null;
    this.dirty = true;         // the canvas changed: the GPU texture needs re-uploading
    this.needsRedraw = true;   // the composed canvas must be rebuilt
  }

  // ── Beats ──────────────────────────────────────────────────────────────────

  /**
   * Lay out a beat's ops into items (nothing is drawn yet). `clear` and
   * `erase` happen immediately. Returns a handle for setProgress().
   * @param {any[]} ops
   */
  begin(ops) {
    /** @type {Item[]} */
    const items = [];
    for (const op of Array.isArray(ops) ? ops : []) {
      try {
        if (op.t === 'clear') { this.clear(); continue; }
        if (op.t === 'erase') { this.erase(String(op.id)); continue; }
        const item = this.make(op);
        if (item) { this.items.set(item.id, item); items.push(item); }
      } catch (err) { console.warn('[board] skipped op', op, err); }
    }
    const total = items.reduce((s, it) => s + it.weight, 0);
    return { items, total, p: 0 };
  }

  /**
   * Advance a beat's drawing to overall progress p. Items are written one
   * after another, each getting a share of time proportional to its ink.
   * @param {{items:Item[], total:number, p:number}} beat @param {number} p
   */
  setProgress(beat, p) {
    if (p === beat.p) return;
    beat.p = p;
    let start = 0;
    this.pen = null;
    for (const it of beat.items) {
      const local = beat.total > 0 ? clamp01((p * beat.total - start) / it.weight) : 1;
      start += it.weight;
      if (this.done.has(it) || !this.items.has(it.id)) continue;
      if (local >= 1) {
        this.active.delete(it);
        this.done.add(it);
        this.paint(this.bg, it, 1);  // bake once, never redraw again
      } else if (local > 0) {
        this.active.add(it);
        /** @type {any} */ (it).p = local;
      }
    }
    this.needsRedraw = true;
  }

  /** Instantly finish a beat (used when the student interrupts mid-stroke). */
  finish(/** @type {{items:Item[], total:number, p:number}} */ beat) { this.setProgress(beat, 1); this.pen = null; }

  // ── Page actions ───────────────────────────────────────────────────────────

  /** Wipe the board with a fade, like a duster. */
  clear() {
    if (this.items.size) {
      const snap = document.createElement('canvas');
      snap.width = this.canvas.width; snap.height = this.canvas.height;
      /** @type {CanvasRenderingContext2D} */ (snap.getContext('2d')).drawImage(this.compose(true), 0, 0);
      this.wipe = { canvas: snap, t0: performance.now() };
    }
    this.items.clear(); this.done.clear(); this.active.clear(); this.fading = [];
    this.bg.clearRect(0, 0, this.bake.width, this.bake.height);
    this.cursorY = FLOW_TOP; this.hasTitle = false; this.lastAxes = null;
    this.needsRedraw = true;
  }

  /** Remove one item (fades out). @param {string} id */
  erase(id) {
    const it = this.items.get(id);
    if (!it) return;
    this.items.delete(id); this.active.delete(it);
    if (this.done.delete(it)) this.rebake();
    this.fading.push({ item: it, t0: performance.now() });
    this.needsRedraw = true;
  }

  rebake() {
    this.bg.clearRect(0, 0, this.bake.width, this.bake.height);
    for (const it of this.done) this.paint(this.bg, it, 1);
  }

  // ── Per-frame ──────────────────────────────────────────────────────────────

  /**
   * Rebuild the visible canvas if anything changed. Cheap when idle.
   * @param {number} now performance.now()
   */
  update(now) {
    if (this.wipe || this.fading.length) this.needsRedraw = true;
    if (!this.needsRedraw) return;
    this.compose(false, now);
    this.needsRedraw = false;
    this.dirty = true;
  }

  /** @param {boolean} [bakeOnly] @param {number} [now] */
  compose(bakeOnly = false, now = performance.now()) {
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.bake, 0, 0);
    let pen = null;
    for (const it of this.active) pen = this.paint(g, it, /** @type {any} */ (it).p) || pen;
    if (bakeOnly) return this.canvas;
    // Erased items and wiped pages fade over ~450 ms.
    this.fading = this.fading.filter((f) => {
      const a = 1 - (now - f.t0) / 450;
      if (a <= 0) return false;
      g.save(); g.globalAlpha = a; this.paint(g, f.item, 1); g.restore();
      return true;
    });
    if (this.wipe) {
      const a = 1 - (now - this.wipe.t0) / 500;
      if (a <= 0) this.wipe = null;
      else { g.save(); g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = a * a; g.drawImage(this.wipe.canvas, 0, (1 - a) * 18); g.restore(); }
    }
    this.pen = pen;   // null when nothing is being written: the pen lifts
    return this.canvas;
  }

  /** Draw an item at progress p in board coordinates. */
  paint(/** @type {CanvasRenderingContext2D} */ g, /** @type {Item} */ it, /** @type {number} */ p) {
    g.save();
    g.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    g.lineCap = 'round'; g.lineJoin = 'round';
    const pen = it.draw(g, p);
    g.restore();
    return pen;
  }

  /** True while any ink is still moving (so the renderer can idle when false). */
  get animating() { return this.active.size > 0 || !!this.wipe || this.fading.length > 0; }

  // ── Description for the model (sent when the student interrupts) ──────────

  describe() {
    const lines = [`Board ${W}x${H}. Writing column: next free line at y≈${Math.round(this.cursorY)} (x ${COL.x0}–${COL.x1}).`];
    for (const it of this.items.values()) {
      const b = it.box;
      lines.push(`#${it.id} ${it.desc || it.kind} [${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}x${Math.round(b.h)}]`);
    }
    if (this.items.size === 0) lines.push('(empty)');
    return lines.join('\n');
  }

  // ── Item factory ───────────────────────────────────────────────────────────

  /** @param {any} op @returns {Item|null} */
  make(op) {
    const id = op.id && !this.items.has(String(op.id)) ? String(op.id) : `i${++this.seq}`;
    const colour = COLOURS[op.c] || COLOURS.white;
    switch (op.t) {
      case 'title': return this.makeTitle(id, op, colour);
      case 'text': return this.makeText(id, op, colour);
      case 'math': return this.makeMath(id, op, colour);
      case 'line': case 'poly': {
        const pts = sanitizePts(op.p);
        if (pts.length < 2) return null;
        const close = op.t === 'poly' && op.close !== false && pts.length > 2;
        const item = this.makeStroke(id, op.t, polyline(pts, close), op, colour, op.fill && close ? pts : null,
          `${op.t} ${pts.map((q) => `(${Math.round(q[0])},${Math.round(q[1])})`).join('→')}${close ? ' closed' : ''}`);
        if (pts.length === 2) item.ends = pts;   // lets a "ring" mark hug the line instead of its bounding box
        return item;
      }
      case 'rect': {
        const x = finite(op.x, 900), y = finite(op.y, 300), w = finite(op.w, 200), h = finite(op.h, 120);
        /** @type {Pt[]} */ const corners = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]];
        return this.makeStroke(id, 'rect', polyline(corners, true), op, colour, op.fill ? corners : null, `rect ${Math.round(w)}x${Math.round(h)}`);
      }
      case 'circle': {
        const x = finite(op.x, 1150), y = finite(op.y, 450), r = Math.max(4, finite(op.r, 100));
        const pts = oval(x, y, r, r, 0.04);
        return this.makeStroke(id, 'circle', pts, op, colour, op.fill ? pts : null, `circle centre (${Math.round(x)},${Math.round(y)}) r=${Math.round(r)}`);
      }
      case 'arc': {
        const x = finite(op.x, 1150), y = finite(op.y, 450), r = Math.max(4, finite(op.r, 60));
        return this.makeStroke(id, 'arc', arc(x, y, r, finite(op.a0, 0), finite(op.a1, 90)), op, colour, null, `arc centre (${Math.round(x)},${Math.round(y)}) r=${Math.round(r)}`);
      }
      case 'arrow': return this.makeArrow(id, op, colour);
      case 'axes': return this.makeAxes(id, op, colour);
      case 'plot': return this.makePlot(id, op, colour);
      case 'dot': return this.makeDot(id, op, colour);
      case 'mark': return this.makeMark(id, op, colour);
      default: return null;
    }
  }

  // Words ─────────────────────────────────────────────────────────────────────

  /** @param {string} id @param {any} op @param {string} colour */
  makeTitle(id, op, colour) {
    const str = String(op.s || '').slice(0, 60);
    if (this.hasTitle) {
      // A second title on the same page becomes a section heading in the flow.
      return this.makeText(id, { ...op, size: op.size || 50, underline: true }, colour);
    }
    this.hasTitle = true;
    const size = 64;
    measure.font = `600 ${size}px ${HAND_FONT}`;
    const w = Math.min(measure.measureText(str).width, 1400);
    const x = 70, base = 98;
    this.cursorY = Math.max(this.cursorY, FLOW_TOP_WITH_TITLE);
    const under = new Path(wobble([x - 6, base + 16], [x + w + 10, base + 13]));
    const textW = w;
    return {
      id, kind: 'title', box: { x, y: base - size * 0.75, w: textW, h: size * 1.05 }, weight: textW * 1.1 + under.length,
      desc: `title "${str}"`,
      draw: (g, p) => {
        const pt = smooth(0, 0.8, p);
        g.fillStyle = colour; g.strokeStyle = colour; g.lineWidth = 3.5;
        const pen = writeText(g, str, x, base, `600 ${size}px ${HAND_FONT}`, textW, pt, size);
        const pu = (p - 0.8) / 0.2;
        return under.draw(g, pu) || pen;
      },
    };
  }

  /** @param {string} id @param {any} op @param {string} colour */
  makeText(id, op, colour) {
    let size = Math.max(22, Math.min(72, finite(op.size, 40)));
    const str = String(op.s ?? '').slice(0, 300);
    const font = `${size}px ${HAND_FONT}`;
    measure.font = font;
    const explicit = Number.isFinite(op.x) && Number.isFinite(op.y);
    const lines = [];
    if (explicit || op.ax) lines.push(str);
    else {
      // Wrap to the writing column.
      const maxW = COL.x1 - (Number.isFinite(op.x) ? op.x : COL.x0);
      let cur = '';
      for (const word of str.split(/\s+/)) {
        const next = cur ? `${cur} ${word}` : word;
        if (measure.measureText(next).width > maxW && cur) { lines.push(cur); cur = word; } else cur = next;
      }
      if (cur) lines.push(cur);
    }
    const widths = lines.map((l) => measure.measureText(l).width);
    const w = Math.max(1, ...widths), lineH = size * 1.12, h = lineH * lines.length;
    const pos = this.place(op, w, h, size * 0.78);
    const total = widths.reduce((a, b) => a + b, 0) || 1;
    const under = op.underline ? new Path(wobble([pos.x - 4, pos.y + h + 4], [pos.x + w + 8, pos.y + h + 2])) : null;
    return {
      id, kind: 'text', flow: pos.flow, box: { x: pos.x, y: pos.y, w, h }, weight: total * 1.05 + (under?.length || 0),
      desc: `text "${str.slice(0, 80)}"`,
      draw: (g, p) => {
        g.fillStyle = colour; g.strokeStyle = colour; g.lineWidth = 3;
        let acc = 0, pen = null;
        const pt = under ? p / 0.85 : p;
        for (let k = 0; k < lines.length; k++) {
          const lp = clamp01((pt * total - acc) / widths[k]);
          acc += widths[k];
          if (lp <= 0) break;
          pen = writeText(g, lines[k], pos.x, pos.y + lineH * k + size * 0.78, font, widths[k], lp, size) || pen;
        }
        if (under) pen = under.draw(g, (p - 0.85) / 0.15) || pen;
        return pen;
      },
    };
  }

  /** @param {string} id @param {any} op @param {string} colour */
  makeMath(id, op, colour) {
    let size = Math.max(24, Math.min(80, finite(op.size, 46)));
    const src = String(op.s ?? '').slice(0, 300);
    let box = typeset(src, size);
    // Too wide for where it's going? Shrink to fit rather than run off the glass.
    const room = Number.isFinite(op.x) ? W - 40 - op.x : COL.x1 - COL.x0 + 40;
    if (box.w > room && room > 100) { size = Math.max(22, Math.floor(size * room / box.w)); box = typeset(src, size); }
    const h = box.a + box.d;
    const pos = this.place(op, box.w, h, box.a);
    const b = box;
    return {
      id, kind: 'math', flow: pos.flow, box: { x: pos.x, y: pos.y, w: b.w, h }, weight: b.w * 1.25 + 30,
      desc: `math "${src.slice(0, 80)}"`,
      draw: (g, p) => {
        g.fillStyle = colour;
        if (p >= 1) { b.paint(g, pos.x, pos.y + b.a); return null; }
        // Reveal left to right, as if being written.
        const edge = pos.x + b.w * p;
        g.save();
        g.beginPath(); g.rect(pos.x - 10, pos.y - 30, b.w * p + 10, h + 60); g.clip();
        b.paint(g, pos.x, pos.y + b.a);
        g.restore();
        return [edge, pos.y + h * 0.55];
      },
    };
  }

  /**
   * Decide where a block of text/maths goes: explicit x/y (x = left edge,
   * y = middle), graph coordinates via an axes, or the next line of the
   * writing column. Returns the block's top-left.
   * @param {any} op @param {number} w @param {number} h @param {number} ascent
   */
  place(op, w, h, ascent) {
    if (op.ax && this.axesFor(op.ax)) {
      const ax = this.axesFor(op.ax);
      return { x: clampX(ax.X(finite(op.x, 0)), w), y: clampY(ax.Y(finite(op.y, 0)) - h / 2, h), flow: false };
    }
    if (Number.isFinite(op.x) && Number.isFinite(op.y)) {
      let x = clampX(op.x, w), y = clampY(op.y - h / 2, h);
      // If it would land on top of other writing, slide it down a line or two.
      for (let k = 0; k < 4 && this.overlapsWriting({ x, y, w, h }); k++) y = clampY(y + h * 0.9, h);
      return { x, y, flow: false };
    }
    // Flow: next line in the writing column (x may override the indent).
    const x = Number.isFinite(op.x) ? clampX(op.x, w) : COL.x0;
    if (this.cursorY + h > FLOW_BOTTOM) this.turnPage();
    const y = this.cursorY;
    this.cursorY = y + h + Math.max(14, h * 0.22);
    return { x, y, flow: true };
  }

  /** The writing column is full: fade out its old lines, keep the diagram. */
  turnPage() {
    for (const it of [...this.items.values()]) if (it.flow) this.erase(it.id);
    this.cursorY = this.hasTitle ? FLOW_TOP_WITH_TITLE : FLOW_TOP;
  }

  /** @param {Rect} r */
  overlapsWriting(r) {
    for (const it of this.items.values()) {
      if (it.kind !== 'text' && it.kind !== 'math' && it.kind !== 'title') continue;
      const b = it.box;
      const ox = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x), oy = Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y);
      if (ox > 0 && oy > 0 && ox * oy > 0.25 * Math.min(r.w * r.h, b.w * b.h)) return true;
    }
    return false;
  }

  // Strokes ───────────────────────────────────────────────────────────────────

  /**
   * Any single-path shape, optionally with a translucent fill that washes in
   * once the outline is complete.
   * @param {string} id @param {string} kind @param {Pt[]} pts @param {any} op @param {string} colour
   * @param {Pt[]|null} fill @param {string} desc
   */
  makeStroke(id, kind, pts, op, colour, fill, desc) {
    const path = new Path(pts);
    const width = Math.max(1.5, Math.min(10, finite(op.w, 4)));
    return {
      id, kind, box: bbox(pts), weight: Math.max(40, path.length), desc: `${desc}${op.c ? ` ${op.c}` : ''}`,
      draw: (g, p) => {
        if (fill) {
          const a = smooth(0.55, 1, p) * 0.32;
          if (a > 0) {
            g.save(); g.globalAlpha = a; g.fillStyle = colour; g.beginPath();
            g.moveTo(fill[0][0], fill[0][1]);
            for (const q of fill) g.lineTo(q[0], q[1]);
            g.closePath(); g.fill(); g.restore();
          }
        }
        g.strokeStyle = colour; g.lineWidth = width;
        if (op.dash) g.setLineDash([14, 12]);
        const pen = path.draw(g, fill ? Math.min(1, p / 0.7) : p);
        g.setLineDash([]);
        return pen;
      },
    };
  }

  /** @param {string} id @param {any} op @param {string} colour */
  makeArrow(id, op, colour) {
    const a = sanitizePt(op.from) || [900, 450], b = sanitizePt(op.to) || [1100, 450];
    const bend = Math.max(-1, Math.min(1, finite(op.bend, 0)));
    const shaft = new Path(bend ? bent(a, b, bend) : wobble(a, b));
    const heads = arrowHead(shaft.pts, 20).map((h) => new Path(h));
    return {
      id, kind: 'arrow', box: bbox([a, b]), weight: shaft.length + 40, desc: `arrow (${Math.round(a[0])},${Math.round(a[1])})→(${Math.round(b[0])},${Math.round(b[1])})`,
      draw: (g, p) => {
        g.strokeStyle = colour; g.lineWidth = Math.max(2, finite(op.w, 4));
        const pen = shaft.draw(g, p / 0.85);
        for (const h of heads) h.draw(g, (p - 0.85) / 0.15);
        return pen;
      },
    };
  }

  // Graphs ────────────────────────────────────────────────────────────────────

  /** @param {string} name */
  axesFor(name) {
    const it = this.items.get(String(name));
    return it?.axes || this.lastAxes;
  }

  /** @param {string} id @param {any} op @param {string} colour */
  makeAxes(id, op, colour) {
    const x = finite(op.x, 860), y = finite(op.y, 160), w = Math.max(120, finite(op.w, 640)), h = Math.max(120, finite(op.h, 620));
    let [x0, x1] = Array.isArray(op.xr) ? op.xr : [-5, 5];
    let [y0, y1] = Array.isArray(op.yr) ? op.yr : [-5, 5];
    if (!(x1 > x0)) [x0, x1] = [-5, 5];
    if (!(y1 > y0)) [y0, y1] = [-5, 5];
    const X = (/** @type {number} */ gx) => x + ((gx - x0) / (x1 - x0)) * w;
    const Y = (/** @type {number} */ gy) => y + h - ((gy - y0) / (y1 - y0)) * h;
    const ax = { X, Y, x0, x1, y0, y1, rect: { x, y, w, h } };
    this.lastAxes = ax;

    const ox = x0 <= 0 && x1 >= 0 ? X(0) : x;        // where the y axis sits
    const oy = y0 <= 0 && y1 >= 0 ? Y(0) : y + h;    // where the x axis sits
    const xAxis = new Path(wobble([x - 6, oy], [x + w + 14, oy], 0, 0.4));
    const yAxis = new Path(wobble([ox, y + h + 6], [ox, y - 14], 0, 0.4));
    const heads = [...arrowHead(xAxis.pts, 16), ...arrowHead(yAxis.pts, 16)].map((q) => new Path(q));
    const sx = niceStep((x1 - x0) / 10), sy = niceStep((y1 - y0) / 10);
    const ticksX = range(x0, x1, sx).filter((v) => Math.abs(v) > 1e-9);
    const ticksY = range(y0, y1, sy).filter((v) => Math.abs(v) > 1e-9);
    const muted = COLOURS.grey;
    return {
      id, kind: 'axes', axes: ax, box: { x, y, w, h }, weight: (w + h) * 1.1,
      desc: `axes x∈[${x0},${x1}] y∈[${y0},${y1}]`,
      draw: (g, p) => {
        const pa = p / 0.6, pd = smooth(0.55, 1, p);
        if (op.grid && pd > 0) {
          g.save(); g.globalAlpha = 0.16 * pd; g.strokeStyle = muted; g.lineWidth = 1.2;
          g.beginPath();
          for (const v of ticksX) { g.moveTo(X(v), y); g.lineTo(X(v), y + h); }
          for (const v of ticksY) { g.moveTo(x, Y(v)); g.lineTo(x + w, Y(v)); }
          g.stroke(); g.restore();
        }
        g.strokeStyle = colour; g.lineWidth = 3;
        const pen = xAxis.draw(g, pa * 2) || yAxis.draw(g, pa * 2 - 1);
        if (pa >= 1) for (const hd of heads) hd.draw(g, 1);
        if (pd > 0) {
          g.save(); g.globalAlpha = pd; g.fillStyle = muted; g.strokeStyle = muted; g.lineWidth = 2;
          g.font = `24px ${HAND_FONT}`; g.textAlign = 'center';
          g.beginPath();
          for (const v of ticksX) { g.moveTo(X(v), oy - 6); g.lineTo(X(v), oy + 6); }
          for (const v of ticksY) { g.moveTo(ox - 6, Y(v)); g.lineTo(ox + 6, Y(v)); }
          g.stroke();
          for (const v of ticksX) g.fillText(fmt(v), X(v), oy + 28);
          g.textAlign = 'right';
          for (const v of ticksY) g.fillText(fmt(v), ox - 11, Y(v) + 8);
          g.textAlign = 'left'; g.font = `30px ${HAND_FONT}`; g.fillStyle = colour;
          g.fillText(String(op.xl || 'x'), x + w + 12, oy - 14);
          g.fillText(String(op.yl || 'y'), ox + 12, y - 4);
          g.restore();
        }
        return pen;
      },
    };
  }

  /** @param {string} id @param {any} op @param {string} colour */
  makePlot(id, op, colour) {
    const ax = this.axesFor(op.ax);
    if (!ax) return null;
    let f;
    try { f = compile(String(op.f || 'x')); } catch (err) { console.warn('[board] bad function', op.f, err); return null; }
    const [d0, d1] = Array.isArray(op.dom) ? [Math.max(ax.x0, op.dom[0]), Math.min(ax.x1, op.dom[1])] : [ax.x0, ax.x1];
    const runs = sample(f, d0, d1, ax.y0, ax.y1).map((run) => new Path(run.map(([gx, gy]) => /** @type {Pt} */ ([ax.X(gx), ax.Y(gy)]))));
    const total = runs.reduce((s, r) => s + r.length, 0);
    if (!total) return null;
    const r = ax.rect;
    return {
      id, kind: 'plot', box: { ...r }, weight: Math.max(80, total * 0.8), desc: `plot y=${op.f}${op.c ? ` ${op.c}` : ''}`,
      draw: (g, p) => {
        g.save();
        g.beginPath(); g.rect(r.x - 2, r.y - 2, r.w + 4, r.h + 4); g.clip();   // stay inside the axes
        g.strokeStyle = colour; g.lineWidth = Math.max(2, finite(op.w, 4.5));
        let acc = 0, pen = null;
        for (const run of runs) {
          const lp = (p * total - acc) / run.length;
          acc += run.length;
          if (lp <= 0) break;
          pen = run.draw(g, lp) || pen;
        }
        g.restore();
        return pen;
      },
    };
  }

  /** @param {string} id @param {any} op @param {string} colour */
  makeDot(id, op, colour) {
    const ax = op.ax ? this.axesFor(op.ax) : null;
    const x = ax ? ax.X(finite(op.x, 0)) : finite(op.x, 1100), y = ax ? ax.Y(finite(op.y, 0)) : finite(op.y, 450);
    const label = op.label ? String(op.label).slice(0, 40) : '';
    measure.font = `28px ${HAND_FONT}`;
    const lw = label ? measure.measureText(label).width : 0;
    const left = x + 16 + lw > W - 30;   // keep labels on the glass
    const lx = left ? x - 16 - lw : x + 16, ly = y - 18;
    return {
      id, kind: 'dot', box: { x: Math.min(x - 8, lx), y: ly - 24, w: Math.max(16, lw + 24), h: 40 }, weight: 60 + lw,
      desc: `dot ${ax ? `at graph (${op.x}, ${op.y})` : `(${Math.round(x)},${Math.round(y)})`}${label ? ` "${label}"` : ''}`,
      draw: (g, p) => {
        const pr = smooth(0, 0.35, p);
        g.fillStyle = colour;
        g.beginPath(); g.arc(x, y, 8 * pr + 0.01, 0, Math.PI * 2); g.fill();
        if (label && p > 0.35) {
          return writeText(g, label, lx, ly, `28px ${HAND_FONT}`, lw, (p - 0.35) / 0.65, 28) || [x, y];
        }
        return p < 1 ? [x, y] : null;
      },
    };
  }

  /** Emphasis around something already on the board. @param {string} id @param {any} op @param {string} colour */
  makeMark(id, op, colour) {
    const target = this.items.get(String(op.id));
    if (!target) return null;
    // A mark's own id must not replace its target's.
    const markId = `${id === String(op.id) ? `m${++this.seq}` : id}`;
    const b = target.box, k = String(op.k || 'ring');
    let pts;
    if (k === 'underline') pts = wobble([b.x - 6, b.y + b.h + 10], [b.x + b.w + 10, b.y + b.h + 6]);
    else if (k === 'box') pts = polyline([[b.x - 14, b.y - 12], [b.x + b.w + 14, b.y - 12], [b.x + b.w + 14, b.y + b.h + 12], [b.x - 14, b.y + b.h + 12]], true);
    else if (k === 'tick') { const x = b.x + b.w + 24, y = b.y + b.h / 2; pts = [...wobble([x, y], [x + 14, y + 18]), ...wobble([x + 14, y + 18], [x + 44, y - 26])]; }
    else if (k === 'cross') { const x = b.x + b.w + 24, y = b.y + b.h / 2; pts = [...wobble([x, y - 18], [x + 36, y + 18]), [x + 36, y - 18], ...wobble([x + 36, y - 18], [x, y + 18])]; }
    else if (target.ends && (k === 'ring')) {
      // A capsule-shaped loop along the line, rotated to match it.
      const [a, e] = target.ends, ang = Math.atan2(e[1] - a[1], e[0] - a[0]), len = Math.hypot(e[0] - a[0], e[1] - a[1]);
      const cx = (a[0] + e[0]) / 2, cy = (a[1] + e[1]) / 2, ca = Math.cos(ang), sa = Math.sin(ang);
      pts = oval(0, 0, len / 2 + 22, 24).map(([x, y]) => [cx + x * ca - y * sa, cy + x * sa + y * ca]);
    }
    else pts = oval(b.x + b.w / 2, b.y + b.h / 2, b.w / 2 + 26, b.h / 2 + 22);
    const c = op.c ? colour : k === 'cross' ? COLOURS.red : k === 'tick' ? COLOURS.green : COLOURS.yellow;
    const path = new Path(pts);
    return {
      id: markId, kind: 'mark', box: bbox(pts), weight: Math.max(60, path.length * 0.75), desc: `${k} around #${target.id}`,
      draw: (g, p) => { g.strokeStyle = c; g.lineWidth = 3.5; return path.draw(g, p); },
    };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Write text revealed left to right (clip), returning the pen tip.
 * @param {CanvasRenderingContext2D} g @param {string} str @param {number} x @param {number} base
 * @param {string} font @param {number} w @param {number} p @param {number} size
 * @returns {Pt|null}
 */
function writeText(g, str, x, base, font, w, p, size) {
  if (p <= 0) return null;
  g.font = font;
  if (p >= 1) { g.fillText(str, x, base); return null; }
  g.save();
  g.beginPath(); g.rect(x - size, base - size * 1.2, w * p + size, size * 1.7); g.clip();
  g.fillText(str, x, base);
  g.restore();
  return [x + w * p, base - size * 0.3];
}

/** @param {any} p @returns {Pt|null} */
function sanitizePt(p) {
  return Array.isArray(p) && Number.isFinite(+p[0]) && Number.isFinite(+p[1]) ? [+p[0], +p[1]] : null;
}
/** @param {any} p @returns {Pt[]} */
function sanitizePts(p) { return Array.isArray(p) ? /** @type {Pt[]} */ (p.map(sanitizePt).filter(Boolean)) : []; }
/** @param {Pt[]} pts @returns {Rect} */
function bbox(pts) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}
const clampX = (/** @type {number} */ x, /** @type {number} */ w) => Math.max(30, Math.min(W - 30 - w, x));
const clampY = (/** @type {number} */ y, /** @type {number} */ h) => Math.max(20, Math.min(H - 20 - h, y));
/** 1, 2, 5, 10, 20, 50… */
function niceStep(/** @type {number} */ raw) {
  const p = Math.pow(10, Math.floor(Math.log10(raw || 1))), m = raw / p;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p;
}
function range(/** @type {number} */ a, /** @type {number} */ b, /** @type {number} */ step) {
  const out = [];
  for (let v = Math.ceil(a / step) * step; v <= b + 1e-9 && out.length < 60; v += step) out.push(+v.toFixed(10));
  return out;
}
const fmt = (/** @type {number} */ v) => (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0) ? v.toExponential(0) : String(+v.toFixed(2))).replace('-', '−');
