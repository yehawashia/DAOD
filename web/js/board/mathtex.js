// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · mini-TeX: typeset a useful subset of LaTeX straight onto a canvas
//
// Why not KaTeX? KaTeX renders HTML, which can't live *inside* a WebGL texture
// and can't be "written" stroke by stroke. This ~300-line typesetter lays out
// boxes (width / ascent / descent) and paints them with canvas text and
// hand-drawn strokes, so maths appears on the glass in the tutor's hand.
//
// Supported: ^ _ {groups} \frac \dfrac \tfrac \sqrt \sqrt[n] \text \mathrm
// \left( \right) Greek, relations, operators, arrows, \sin-style functions,
// spacing (\, \: \; \quad \qquad \!), ^\circ, primes, and unicode passthrough.
// ─────────────────────────────────────────────────────────────────────────────

import { wobble } from './ink.js';

/** Fonts: words in the hand font; symbols fall back to a real maths font. */
export const HAND_FONT = '"Caveat", "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
const MATH_FONT = '"Caveat", "Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", serif';
const SYM_FONT = '"Cambria Math", "STIX Two Math", "Latin Modern Math", "Times New Roman", serif';

// Command → [glyph, class]. Classes drive spacing like TeX: bin / rel / op / ord.
const SYMBOLS = /** @type {Record<string,[string,string]>} */ ({
  alpha: ['α', 'ord'], beta: ['β', 'ord'], gamma: ['γ', 'ord'], delta: ['δ', 'ord'], epsilon: ['ε', 'ord'], varepsilon: ['ε', 'ord'],
  zeta: ['ζ', 'ord'], eta: ['η', 'ord'], theta: ['θ', 'ord'], vartheta: ['ϑ', 'ord'], iota: ['ι', 'ord'], kappa: ['κ', 'ord'],
  lambda: ['λ', 'ord'], mu: ['μ', 'ord'], nu: ['ν', 'ord'], xi: ['ξ', 'ord'], pi: ['π', 'ord'], rho: ['ρ', 'ord'], sigma: ['σ', 'ord'],
  tau: ['τ', 'ord'], phi: ['φ', 'ord'], varphi: ['φ', 'ord'], chi: ['χ', 'ord'], psi: ['ψ', 'ord'], omega: ['ω', 'ord'],
  Gamma: ['Γ', 'ord'], Delta: ['Δ', 'ord'], Theta: ['Θ', 'ord'], Lambda: ['Λ', 'ord'], Pi: ['Π', 'ord'], Sigma: ['Σ', 'ord'],
  Phi: ['Φ', 'ord'], Psi: ['Ψ', 'ord'], Omega: ['Ω', 'ord'],
  times: ['×', 'bin'], cdot: ['·', 'bin'], div: ['÷', 'bin'], pm: ['±', 'bin'], mp: ['∓', 'bin'], ast: ['∗', 'bin'], circ: ['∘', 'bin'],
  le: ['≤', 'rel'], leq: ['≤', 'rel'], ge: ['≥', 'rel'], geq: ['≥', 'rel'], ne: ['≠', 'rel'], neq: ['≠', 'rel'],
  approx: ['≈', 'rel'], equiv: ['≡', 'rel'], sim: ['∼', 'rel'], propto: ['∝', 'rel'], to: ['→', 'rel'], rightarrow: ['→', 'rel'],
  leftarrow: ['←', 'rel'], Rightarrow: ['⇒', 'rel'], implies: ['⇒', 'rel'], Leftrightarrow: ['⇔', 'rel'], iff: ['⇔', 'rel'],
  in: ['∈', 'rel'], notin: ['∉', 'rel'], subset: ['⊂', 'rel'], subseteq: ['⊆', 'rel'], perp: ['⊥', 'rel'], parallel: ['∥', 'rel'],
  infty: ['∞', 'ord'], partial: ['∂', 'ord'], nabla: ['∇', 'ord'], angle: ['∠', 'ord'], triangle: ['△', 'ord'], degree: ['°', 'ord'],
  therefore: ['∴', 'rel'], because: ['∵', 'rel'], ldots: ['…', 'ord'], dots: ['…', 'ord'], cdots: ['⋯', 'ord'], prime: ['′', 'ord'],
  sum: ['∑', 'op'], prod: ['∏', 'op'], int: ['∫', 'op'], oint: ['∮', 'op'], cup: ['∪', 'bin'], cap: ['∩', 'bin'],
  forall: ['∀', 'ord'], exists: ['∃', 'ord'], emptyset: ['∅', 'ord'], neg: ['¬', 'ord'], mid: ['|', 'rel'],
  langle: ['⟨', 'ord'], rangle: ['⟩', 'ord'], lfloor: ['⌊', 'ord'], rfloor: ['⌋', 'ord'], lceil: ['⌈', 'ord'], rceil: ['⌉', 'ord'],
  '{': ['{', 'ord'], '}': ['}', 'ord'], '%': ['%', 'ord'], '$': ['$', 'ord'], '#': ['#', 'ord'], '&': ['&', 'ord'], '_': ['_', 'ord'],
});
const FUNCS = new Set(['sin', 'cos', 'tan', 'sec', 'csc', 'cot', 'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd', 'mod', 'deg']);
const SPACES = /** @type {Record<string,number>} */ ({ ',': 0.17, ':': 0.22, ';': 0.28, ' ': 0.25, quad: 1, qquad: 2, '!': -0.17, enspace: 0.5 });
const CHAR_CLASS = /** @type {Record<string,string>} */ ({
  '+': 'bin', '-': 'bin', '−': 'bin', '*': 'bin', '×': 'bin', '÷': 'bin', '±': 'bin', '·': 'bin',
  '=': 'rel', '<': 'rel', '>': 'rel', '≤': 'rel', '≥': 'rel', '≠': 'rel', '≈': 'rel', '→': 'rel', ':': 'rel',
  '(': 'open', '[': 'open', ')': 'close', ']': 'close', ',': 'punct', ';': 'punct', '!': 'close', '|': 'ord',
});

// ── Parsing: LaTeX source → a tree of nodes ─────────────────────────────────
/** @typedef {{t:string,[k:string]:any}} Node */

/** @param {string} src @returns {Node[]} */
export function parse(src) {
  let i = 0;
  const s = src;

  /** Read a {group} or a single token as an argument. @returns {Node[]} */
  function arg() {
    skipWs();
    if (s[i] === '{') { i++; const g = list('}'); i++; return g; }
    const one = atom();
    return one ? [one] : [];
  }
  function skipWs() { while (i < s.length && s[i] === ' ') i++; }
  /** Raw text up to the matching brace (for \text{…}). */
  function rawGroup() {
    skipWs();
    if (s[i] !== '{') return '';
    let depth = 0, out = '';
    for (; i < s.length; i++) {
      if (s[i] === '{') { if (depth++ === 0) continue; }
      if (s[i] === '}') { if (--depth === 0) { i++; break; } }
      out += s[i];
    }
    return out.replace(/\\([{}%$#&_ ])/g, '$1');
  }

  /** @returns {Node|null} */
  function atom() {
    const c = s[i];
    if (c === undefined) return null;
    if (c === '\\') {
      i++;
      const m = /^[a-zA-Z]+|^./.exec(s.slice(i));
      const name = m ? m[0] : '';
      i += name.length;
      if (name === 'frac' || name === 'dfrac' || name === 'tfrac') return { t: 'frac', num: arg(), den: arg() };
      if (name === 'sqrt') {
        let index = null;
        skipWs();
        if (s[i] === '[') { i++; index = list(']'); i++; }
        return { t: 'sqrt', body: arg(), index };
      }
      if (name === 'text' || name === 'mathrm' || name === 'textbf' || name === 'mathbf' || name === 'operatorname') {
        return { t: 'text', s: rawGroup() };
      }
      if (name === 'left' || name === 'right') {
        skipWs();
        let d = s[i++] || '';
        if (d === '\\') { const m2 = /^[a-zA-Z]+|^./.exec(s.slice(i)); d = m2 ? (SYMBOLS[m2[0]]?.[0] ?? m2[0]) : ''; i += m2 ? m2[0].length : 0; }
        return { t: name, d: d === '.' ? '' : d };
      }
      if (name in SPACES) return { t: 'space', w: SPACES[name] };
      if (FUNCS.has(name)) return { t: 'func', s: name };
      if (name === 'circ' && s[i - name.length - 2] === '^') return { t: 'sym', s: '°', cls: 'ord' };
      if (name in SYMBOLS) { const [g, cls] = SYMBOLS[name]; return { t: 'sym', s: g, cls }; }
      if (name === 'displaystyle' || name === 'limits' || name === 'nolimits') return { t: 'space', w: 0 };
      return { t: 'text', s: name }; // unknown command: show its name rather than vanish
    }
    i++;
    if (c === '{') { const g = list('}'); i++; return { t: 'group', body: g }; }
    if (c === ' ') return null; // spaces in maths mode are ignored, like TeX
    if (c === "'") return { t: 'sym', s: '′', cls: 'ord' };
    if (/[a-zA-Z]/.test(c)) return { t: 'var', s: c };
    if (/[0-9.]/.test(c)) {
      // Keep numbers together so "28.3" is one box.
      let n = c;
      while (i < s.length && /[0-9.]/.test(s[i])) n += s[i++];
      return { t: 'num', s: n };
    }
    return { t: 'sym', s: c === '-' ? '−' : c === '*' ? '×' : c, cls: CHAR_CLASS[c] || 'ord' };
  }

  /** Parse a sequence until `end`, attaching ^ and _ scripts. @param {string} end */
  function list(end) {
    /** @type {Node[]} */
    const out = [];
    while (i < s.length && s[i] !== end) {
      if (s[i] === '^' || s[i] === '_') {
        const which = s[i++] === '^' ? 'sup' : 'sub';
        const base = out.pop() || { t: 'group', body: [] };
        const script = base.t === 'scripts' ? base : { t: 'scripts', base, sup: null, sub: null };
        script[which] = arg();
        out.push(script);
        continue;
      }
      const a = atom();
      if (a) out.push(a);
    }
    return out;
  }

  return list('\u0000');
}

// ── Layout: nodes → boxes ───────────────────────────────────────────────────
/**
 * A laid-out box. y is the baseline; ascent goes up, descent down.
 * @typedef {{w:number,a:number,d:number,cls:string,paint:(g:CanvasRenderingContext2D,x:number,y:number)=>void}} Box
 */

const measureCtx = /** @type {CanvasRenderingContext2D} */ (document.createElement('canvas').getContext('2d'));

/** Text box in a given font. */
function glyph(/** @type {string} */ str, /** @type {number} */ size, /** @type {string} */ font, cls = 'ord', italic = false) {
  const f = `${italic ? 'italic ' : ''}${size}px ${font}`;
  measureCtx.font = f;
  const m = measureCtx.measureText(str);
  const w = m.width;
  return /** @type {Box} */ ({
    w, a: size * 0.72, d: size * 0.22, cls,
    paint(g, x, y) { g.font = f; g.fillText(str, x, y); },
  });
}

/**
 * Lay out a node list at a font size.
 * @param {Node[]} nodes @param {number} size @returns {Box}
 */
function layoutList(nodes, size) {
  /** @type {Box[]} */
  const boxes = [];
  for (let k = 0; k < nodes.length; k++) {
    const n = nodes[k];
    if (n.t === 'left') {
      // Find the matching \right and size the delimiters to what's between.
      let depth = 1, j = k + 1;
      for (; j < nodes.length; j++) { if (nodes[j].t === 'left') depth++; if (nodes[j].t === 'right' && --depth === 0) break; }
      const inner = layoutList(nodes.slice(k + 1, j), size);
      boxes.push(delim(n.d, inner, size, 'open'), inner, delim(nodes[j]?.d ?? '', inner, size, 'close'));
      k = j;
      continue;
    }
    if (n.t === 'right') continue;
    boxes.push(layoutNode(n, size));
  }
  // TeX-ish spacing between neighbours: around relations and binary operators.
  /** @type {number[]} */
  const gaps = [];
  for (let k = 0; k < boxes.length; k++) {
    const cur = boxes[k], prev = boxes[k - 1];
    let gap = 0;
    // A "−" with nothing (or an operator / opening bracket) before it is a sign, not subtraction.
    const unary = cur.cls === 'bin' && (!prev || prev.cls === 'bin' || prev.cls === 'rel' || prev.cls === 'open' || prev.cls === 'punct');
    if (unary) cur.cls = 'ord';
    if (prev) {
      if (cur.cls === 'rel' || prev.cls === 'rel') gap = 0.28;
      else if (cur.cls === 'bin' || prev.cls === 'bin') gap = 0.22;
      else if (prev.cls === 'punct') gap = 0.17;
      else if (prev.cls === 'func' && cur.cls !== 'open') gap = 0.12;
    }
    gaps.push(gap * size);
  }
  let w = 0, a = size * 0.5, d = size * 0.1;
  for (let k = 0; k < boxes.length; k++) { w += gaps[k] + boxes[k].w; a = Math.max(a, boxes[k].a); d = Math.max(d, boxes[k].d); }
  return {
    w, a, d, cls: boxes.length === 1 ? boxes[0].cls : 'ord',
    paint(g, x, y) {
      let cx = x;
      for (let k = 0; k < boxes.length; k++) { cx += gaps[k]; boxes[k].paint(g, cx, y); cx += boxes[k].w; }
    },
  };
}

/** @param {Node} n @param {number} size @returns {Box} */
function layoutNode(n, size) {
  switch (n.t) {
    case 'var': return glyph(n.s, size, MATH_FONT, 'ord');
    case 'num': return glyph(n.s, size, MATH_FONT, 'ord');
    case 'text': return glyph(n.s, size, HAND_FONT, 'ord');
    case 'func': return { ...glyph(n.s, size, HAND_FONT, 'func') };
    case 'space': return { w: n.w * size, a: 0, d: 0, cls: 'space', paint() {} };
    case 'group': return layoutList(n.body, size);
    case 'sym': {
      // Handwriting fonts often lack maths symbols; draw those in a maths font.
      const sym = /[A-Za-z0-9()[\]+=<>,.!|/:;?]/.test(n.s) && n.s !== '|';
      const b = glyph(n.s, n.cls === 'op' ? size * 1.35 : size, sym ? MATH_FONT : SYM_FONT, n.cls);
      if (n.s === '−') { // draw minus as a stroke: fonts disagree wildly on its weight
        return { ...b, w: size * 0.48, paint(g, x, y) { hline(g, x + size * 0.05, x + size * 0.43, y - size * 0.27, size); } };
      }
      return b;
    }
    case 'scripts': {
      const base = layoutNode(n.base, size);
      const small = Math.max(size * 0.62, 14);
      const sup = n.sup ? layoutList(n.sup, small) : null;
      const sub = n.sub ? layoutList(n.sub, small) : null;
      const supShift = Math.max(base.a * 0.62, size * 0.38), subShift = size * 0.22;
      const w = base.w + Math.max(sup?.w ?? 0, sub?.w ?? 0) + size * 0.04;
      return {
        w, cls: base.cls,
        a: Math.max(base.a, sup ? supShift + sup.a : 0),
        d: Math.max(base.d, sub ? subShift + sub.d : 0),
        paint(g, x, y) {
          base.paint(g, x, y);
          sup?.paint(g, x + base.w + size * 0.03, y - supShift);
          sub?.paint(g, x + base.w + size * 0.02, y + subShift);
        },
      };
    }
    case 'frac': {
      const small = Math.max(size * 0.78, 16);
      const num = layoutList(n.num, small), den = layoutList(n.den, small);
      const w = Math.max(num.w, den.w) + size * 0.25;
      const axis = size * 0.28, gap = size * 0.1;
      return {
        w, cls: 'ord',
        a: axis + gap + num.d + num.a,
        d: -axis + gap + den.a + den.d,
        paint(g, x, y) {
          num.paint(g, x + (w - num.w) / 2, y - axis - gap - num.d);
          den.paint(g, x + (w - den.w) / 2, y - axis + gap + den.a);
          hline(g, x + size * 0.04, x + w - size * 0.04, y - axis, size);
        },
      };
    }
    case 'sqrt': {
      const body = layoutList(n.body, size);
      const idx = n.index ? layoutList(n.index, size * 0.5) : null;
      const top = body.a + size * 0.14, hook = size * 0.55, lead = idx ? Math.max(0, idx.w - hook * 0.4) : 0;
      return {
        w: lead + hook + body.w + size * 0.12, cls: 'ord', a: top + size * 0.06, d: body.d + size * 0.04,
        paint(g, x, y) {
          const x0 = x + lead;
          // The radical sign is drawn by hand: a little tick, a long down-stroke, then up and across.
          strokePts(g, [[x0, y - size * 0.25], [x0 + hook * 0.22, y - size * 0.34], [x0 + hook * 0.5, y + body.d],
            [x0 + hook * 0.9, y - top], [x0 + hook + body.w + size * 0.08, y - top]], size);
          idx?.paint(g, x, y - size * 0.42);
          body.paint(g, x0 + hook, y);
        },
      };
    }
    default: return { w: 0, a: 0, d: 0, cls: 'ord', paint() {} };
  }
}

/** A tall bracket for \left / \right, drawn by hand so it can stretch. */
function delim(/** @type {string} */ d, /** @type {Box} */ inner, /** @type {number} */ size, /** @type {string} */ cls) {
  if (!d) return { w: 0, a: 0, d: 0, cls, paint() {} };
  const h = inner.a + inner.d, tall = h > size * 1.25;
  if (!tall) return glyph(d, size, MATH_FONT, cls);
  const w = size * 0.32, a = inner.a + size * 0.05, de = inner.d + size * 0.05;
  return {
    w, a, d: de, cls,
    paint(g, x, y) {
      const top = y - a, bot = y + de, open = cls === 'open';
      const near = open ? x + w * 0.8 : x + w * 0.2, far = open ? x + w * 0.15 : x + w * 0.85;
      if (d === '(' || d === ')') {
        const pts = [];
        for (let k = 0; k <= 16; k++) { const u = k / 16; pts.push([near + (far - near) * Math.sin(u * Math.PI), top + (bot - top) * u]); }
        strokePts(g, /** @type {[number,number][]} */ (pts), size);
      } else if (d === '|') strokePts(g, [[x + w / 2, top], [x + w / 2, bot]], size);
      else strokePts(g, [[near, top], [far, top], [far, bot], [near, bot]], size); // [ ] and anything else
    },
  };
}

function hline(/** @type {CanvasRenderingContext2D} */ g, /** @type {number} */ x0, /** @type {number} */ x1, /** @type {number} */ y, /** @type {number} */ size) {
  strokePts(g, wobble([x0, y], [x1, y + size * 0.01], 10, 0.6), size);
}
function strokePts(/** @type {CanvasRenderingContext2D} */ g, /** @type {number[][]} */ pts, /** @type {number} */ size) {
  g.save();
  g.strokeStyle = /** @type {string} */ (g.fillStyle);
  g.lineWidth = Math.max(2, size * 0.055);
  g.lineCap = g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(pts[0][0], pts[0][1]);
  for (let k = 1; k < pts.length; k++) g.lineTo(pts[k][0], pts[k][1]);
  g.stroke();
  g.restore();
}

/**
 * Typeset LaTeX at a size. Returns a box whose paint(g, x, baseline) draws it.
 * Results are cached: the same expression is laid out once per size.
 * @param {string} src @param {number} size @returns {Box}
 */
export function typeset(src, size) {
  const key = `${size}|${src}`;
  let box = cache.get(key);
  if (!box) {
    try { box = layoutList(parse(src), size); }
    catch { box = glyph(src, size, HAND_FONT); } // never fail to show *something*
    if (cache.size > 400) cache.clear();
    cache.set(key, box);
  }
  return box;
}
const cache = new Map();
/** Fonts finished loading → forget measurements made with fallback fonts. */
export function clearTypesetCache() { cache.clear(); }
