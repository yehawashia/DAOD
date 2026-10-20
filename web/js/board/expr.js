// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · safe maths expression compiler (for {"t":"plot","f":"x^2 - 3"})
//
// The model writes functions as text. v1 eval'd them as JavaScript, which is
// both unsafe and brittle ("2x" or "x^2" broke it). This is a small Pratt
// parser that understands how people actually write maths:
//   2x   3(x+1)   x(x-2)   2sin(x)   sin x   x^2^3 (= x^(2^3))   -x^2 (= -(x^2))
//   |x| (abs)   pi  π  e   sqrt ln log exp abs floor ceil sign sin cos tan …
// and compiles to a closure tree. No eval, no Function(), no property access.
// ─────────────────────────────────────────────────────────────────────────────

const FUNCS = /** @type {Record<string,(x:number)=>number>} */ ({
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  arcsin: Math.asin, arccos: Math.acos, arctan: Math.atan,
  sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
  sec: (x) => 1 / Math.cos(x), csc: (x) => 1 / Math.sin(x), cosec: (x) => 1 / Math.sin(x), cot: (x) => 1 / Math.tan(x),
  sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp, ln: Math.log, log: Math.log10,
  floor: Math.floor, ceil: Math.ceil, round: Math.round, sign: Math.sign,
});
const CONSTS = /** @type {Record<string,number>} */ ({ pi: Math.PI, 'π': Math.PI, e: Math.E, tau: Math.PI * 2 });

/** @typedef {(x:number)=>number} Fn */

/**
 * Compile an expression in x into a fast function. Throws on bad input.
 * @param {string} src
 * @returns {Fn}
 */
export function compile(src) {
  const toks = tokenize(src);
  let i = 0;
  const peek = () => toks[i];
  const next = () => toks[i++];
  const expect = (/** @type {string} */ v) => {
    const t = next();
    if (!t || t.v !== v) throw new Error(`expected "${v}"`);
  };

  // Binding powers: + - (10) < * / implicit (20) < unary - (30) < ^ (40, right-assoc)
  /** @param {number} rbp @returns {Fn} */
  function expr(rbp) {
    let left = nud(next());
    for (;;) {
      const t = peek();
      if (!t) break;
      // Implicit multiplication: a value directly followed by a value-start.
      const implicit = t.k === 'num' || t.k === 'id' || t.v === '(' || (t.v === '|' && !absOpen);
      const lbp = implicit ? 20 : t.v === '+' || t.v === '-' ? 10 : t.v === '*' || t.v === '/' ? 20 : t.v === '^' ? 40 : 0;
      if (lbp <= rbp) break;
      if (implicit) { const r = expr(20); const l = left; left = (x) => l(x) * r(x); continue; }
      next();
      const l = left;
      if (t.v === '+') { const r = expr(10); left = (x) => l(x) + r(x); }
      else if (t.v === '-') { const r = expr(10); left = (x) => l(x) - r(x); }
      else if (t.v === '*') { const r = expr(20); left = (x) => l(x) * r(x); }
      else if (t.v === '/') { const r = expr(20); left = (x) => l(x) / r(x); }
      else if (t.v === '^') { const r = expr(39); left = (x) => Math.pow(l(x), r(x)); } // 39 → right-assoc
    }
    return left;
  }

  let absOpen = false; // inside |…| a "|" closes rather than opens

  /** @param {{k:string,v:string}|undefined} t @returns {Fn} */
  function nud(t) {
    if (!t) throw new Error('unexpected end');
    if (t.k === 'num') { const v = +t.v; return () => v; }
    if (t.v === '(') { const e = expr(0); expect(')'); return e; }
    if (t.v === '|' && !absOpen) { absOpen = true; const e = expr(0); absOpen = false; expect('|'); return (x) => Math.abs(e(x)); }
    if (t.v === '-') { const e = expr(30); return (x) => -e(x); }
    if (t.v === '+') return expr(30);
    if (t.k === 'id') {
      const name = t.v.toLowerCase();
      if (name === 'x') return (x) => x;
      if (name in CONSTS) { const v = CONSTS[name]; return () => v; }
      if (name in FUNCS) {
        const f = FUNCS[name];
        // sin^2(x) → (sin x)^2, the way people write it
        let power = /** @type {Fn|null} */ (null);
        if (peek()?.v === '^') { next(); power = nud(next()); }
        // "sin(x)" or "sin x": the argument binds tighter than * but looser than ^
        const arg = peek()?.v === '(' ? (next(), (() => { const e = expr(0); expect(')'); return e; })()) : expr(30);
        if (power) { const p = power; return (x) => Math.pow(f(arg(x)), p(x)); }
        return (x) => f(arg(x));
      }
      throw new Error(`unknown name "${t.v}"`);
    }
    throw new Error(`unexpected "${t.v}"`);
  }

  const fn = expr(0);
  if (i < toks.length) throw new Error(`unexpected "${toks[i].v}"`);
  return fn;
}

/** @param {string} src */
function tokenize(src) {
  const s = src
    .replace(/\\(left|right)/g, '')         // tolerate a little LaTeX
    .replace(/\\cdot|\\times|×|·/g, '*').replace(/÷/g, '/').replace(/−/g, '-')
    .replace(/\\pi/g, 'pi').replace(/\\sqrt/g, 'sqrt').replace(/\\(sin|cos|tan|ln|log|exp)/g, '$1')
    .replace(/\*\*/g, '^').replace(/[{[]/g, '(').replace(/[}\]]/g, ')')
    .replace(/^\s*y\s*=\s*/i, '').replace(/^\s*f\s*\(\s*x\s*\)\s*=\s*/i, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ k: 'num', v: num[0] }); i += num[0].length; continue; }
    if (/[a-zπ]/i.test(c)) {
      // Greedy-match a known function/constant name, else a single letter
      // (so "xsin" or "2pix" still splits sensibly).
      const rest = s.slice(i).toLowerCase();
      const name = Object.keys(FUNCS).concat(Object.keys(CONSTS)).sort((a, b) => b.length - a.length).find((n) => rest.startsWith(n));
      const v = name || c;
      out.push({ k: 'id', v }); i += v.length; continue;
    }
    if ('+-*/^()|'.includes(c)) { out.push({ k: 'op', v: c }); i++; continue; }
    throw new Error(`bad character "${c}"`);
  }
  return out;
}

/**
 * Sample a function across [a, b] into drawable runs, splitting at
 * discontinuities (tan, 1/x) and where the curve leaves the visible window.
 * @param {Fn} f
 * @param {number} a  domain start
 * @param {number} b  domain end
 * @param {number} yMin
 * @param {number} yMax
 * @param {number} [n] samples
 * @returns {Array<Array<[number, number]>>} runs of [x, y] in graph units
 */
export function sample(f, a, b, yMin, yMax, n = 320) {
  const runs = [];
  let run = /** @type {Array<[number,number]>} */ ([]);
  const span = yMax - yMin, lo = yMin - span * 0.6, hi = yMax + span * 0.6;
  let prev = NaN;
  for (let k = 0; k <= n; k++) {
    const x = a + ((b - a) * k) / n;
    let y;
    try { y = f(x); } catch { y = NaN; }
    const ok = Number.isFinite(y) && y > lo && y < hi;
    // A jump of more than the whole window between samples is an asymptote.
    const jump = Number.isFinite(prev) && Number.isFinite(y) && Math.abs(y - prev) > span * 1.2;
    if (!ok || jump) { if (run.length > 1) runs.push(run); run = []; }
    if (ok) run.push([x, y]);
    prev = y;
  }
  if (run.length > 1) runs.push(run);
  return runs;
}
