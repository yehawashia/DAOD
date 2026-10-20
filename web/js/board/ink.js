// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · ink: hand-drawn stroke geometry
//
// Shapes are built as point lists with a gentle, *deterministic* wobble
// (sin-based, never Math.random — as in khan-explainer) so a stroke redrawn
// on a later frame lands on exactly the same pixels. Strokes are revealed by
// arc length, so a pen moving along a long side and a short side keeps one
// constant speed.
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {number[]} Pt  [x, y] */

/**
 * A slightly imperfect straight line from a to b.
 * @param {Pt} a @param {Pt} b @param {number} [n] points @param {number} [amp] wobble scale
 * @returns {Pt[]}
 */
export function wobble(a, b, n = 0, amp = 1) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  n = n || Math.max(6, Math.min(48, Math.round(len / 18)));
  const k = Math.min(1.8, len / 90) * amp;           // short strokes wobble less
  const nx = -(b[1] - a[1]) / (len || 1), ny = (b[0] - a[0]) / (len || 1);
  const seed = (a[0] * 0.013 + a[1] * 0.017 + b[0] * 0.011) % 6.28;
  /** @type {Pt[]} */
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const off = k * (Math.sin(u * 7 + seed) * 0.7 + Math.sin(u * 17 + seed * 2) * 0.3) * Math.sin(u * Math.PI);
    pts.push([a[0] + (b[0] - a[0]) * u + nx * off, a[1] + (b[1] - a[1]) * u + ny * off]);
  }
  return pts;
}

/** A polyline through points, each segment wobbled; optionally closed. @param {Pt[]} p @param {boolean} [close] */
export function polyline(p, close = false) {
  /** @type {Pt[]} */
  const out = [];
  const pts = close && p.length > 2 ? [...p, p[0]] : p;
  for (let i = 0; i + 1 < pts.length; i++) {
    const seg = wobble(pts[i], pts[i + 1]);
    if (i > 0) seg.shift();
    out.push(...seg);
  }
  return out.length ? out : p.slice();
}

/**
 * An ellipse that overshoots its start a little, like a real hand closing a loop.
 * @param {number} cx @param {number} cy @param {number} rx @param {number} ry @param {number} [over] extra turn (0.06 = 6%)
 */
export function oval(cx, cy, rx, ry, over = 0.06) {
  /** @type {Pt[]} */
  const pts = [];
  const n = Math.max(40, Math.min(140, Math.round((rx + ry) / 3)));
  const seed = (cx * 0.01 + cy * 0.02) % 6.28;
  for (let i = 0; i <= n; i++) {
    const u = i / n, a = -Math.PI * 0.6 + u * Math.PI * 2 * (1 + over);
    const k = 1 + 0.018 * Math.sin(a * 3 + seed) + 0.012 * u;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return pts;
}

/**
 * Arc in maths convention (degrees, 0 = right, counter-clockwise),
 * converted to the board's y-down space.
 * @param {number} cx @param {number} cy @param {number} r @param {number} a0 @param {number} a1
 */
export function arc(cx, cy, r, a0, a1) {
  /** @type {Pt[]} */
  const pts = [];
  const span = a1 - a0, n = Math.max(8, Math.round(Math.abs(span) / 4));
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + (span * i) / n) * Math.PI) / 180;
    pts.push([cx + Math.cos(a) * r, cy - Math.sin(a) * r]);
  }
  return pts;
}

/** An arrowhead's two barbs at the end of a path. @param {Pt[]} pts @param {number} size */
export function arrowHead(pts, size = 22) {
  const e = pts[pts.length - 1], q = pts[Math.max(0, pts.length - 4)];
  const ang = Math.atan2(e[1] - q[1], e[0] - q[0]);
  return [-1, 1].map((s) => /** @type {Pt[]} */ ([[e[0] + Math.cos(ang + s * 2.6) * size, e[1] + Math.sin(ang + s * 2.6) * size], e]));
}

/** A quadratic curve from a to b bowing by `bend` (−1..1) of its length. @param {Pt} a @param {Pt} b @param {number} bend */
export function bent(a, b, bend) {
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const cx = mx + (-(b[1] - a[1]) / (len || 1)) * bend * len * 0.5, cy = my + ((b[0] - a[0]) / (len || 1)) * bend * len * 0.5;
  /** @type {Pt[]} */
  const pts = [];
  for (let i = 0; i <= 32; i++) {
    const u = i / 32, v = 1 - u;
    pts.push([v * v * a[0] + 2 * v * u * cx + u * u * b[0], v * v * a[1] + 2 * v * u * cy + u * u * b[1]]);
  }
  return pts;
}

/**
 * A path prepared for progressive drawing: cumulative lengths are computed
 * once so each frame can reveal it to an exact fraction of its length.
 */
export class Path {
  /** @param {Pt[]} pts */
  constructor(pts) {
    this.pts = pts;
    /** @type {number[]} */
    this.cum = [0];
    for (let i = 1; i < pts.length; i++) {
      this.cum.push(this.cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    }
    this.length = this.cum[this.cum.length - 1] || 0;
  }

  /**
   * Stroke the first `p` (0..1) of the path. Returns the pen tip when partial.
   * @param {CanvasRenderingContext2D} g @param {number} p
   * @returns {Pt|null}
   */
  draw(g, p) {
    const pts = this.pts;
    if (p <= 0 || pts.length < 2) return null;
    const target = this.length * Math.min(1, p);
    g.beginPath();
    g.moveTo(pts[0][0], pts[0][1]);
    let i = 1;
    for (; i < pts.length && this.cum[i] <= target; i++) g.lineTo(pts[i][0], pts[i][1]);
    if (p >= 1 || i >= pts.length) { g.stroke(); return null; }
    // Interpolate the final partial segment so the pen moves smoothly.
    const s0 = this.cum[i - 1], s1 = this.cum[i], t = (target - s0) / (s1 - s0 || 1);
    const tip = /** @type {Pt} */ ([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * t, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * t]);
    g.lineTo(tip[0], tip[1]);
    g.stroke();
    return tip;
  }
}
