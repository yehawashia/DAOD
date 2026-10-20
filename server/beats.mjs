// ─────────────────────────────────────────────────────────────────────────────
// DAOD · beat extraction
//
// LLMs are messy streamers: they wrap JSON in ``` fences, forget newlines,
// emit a top-level array, or split one object across several lines. Rather
// than trusting "one object per line", we run a tiny incremental JSON scanner
// over the token stream and emit every top-level {...} object the moment its
// closing brace arrives. That is what lets beat 1 be spoken while beat 2 is
// still being generated.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Incremental scanner for top-level JSON objects in a character stream.
 * Tracks string/escape state so braces inside strings don't confuse it.
 * @param {(json: string) => void} onObject called with each complete object's source
 */
export function createObjectScanner(onObject) {
  let depth = 0, inStr = false, esc = false, buf = '';
  return {
    /** Feed the next chunk of model output. */
    push(chunk) {
      for (const ch of chunk) {
        if (depth === 0) {
          // Outside any object: skip prose, fences, commas, array brackets.
          if (ch === '{') { depth = 1; buf = '{'; }
          continue;
        }
        buf += ch;
        if (inStr) {
          if (esc) esc = false;
          else if (ch === '\\') esc = true;
          else if (ch === '"') inStr = false;
          continue;
        }
        if (ch === '"') inStr = true;
        else if (ch === '{') depth++;
        else if (ch === '}' && --depth === 0) { onObject(buf); buf = ''; }
      }
    },
  };
}

// The op vocabulary the board understands (see web/js/board/board.js).
const OPS = new Set(['title', 'text', 'math', 'line', 'arrow', 'circle', 'arc', 'rect', 'poly',
  'axes', 'plot', 'dot', 'mark', 'erase', 'clear']);
const COLOURS = new Set(['white', 'yellow', 'blue', 'green', 'pink', 'orange', 'red', 'purple', 'grey', 'gray']);

const num = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(+v) ? +v : d);
const pt = (p) => (Array.isArray(p) && p.length >= 2 ? [num(p[0]), num(p[1])] : null);

/**
 * Turn whatever the model produced into a safe, well-formed beat, or null.
 * Unknown keys are dropped, numbers are coerced, strings are length-capped.
 * The client validates again while drawing; this keeps junk off the wire.
 */
export function sanitizeBeat(raw) {
  let o;
  try { o = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  // Some models nest: {"beat":{...}} — unwrap one level.
  if (!('say' in o) && !('draw' in o) && o.beat) o = o.beat;
  const say = typeof o.say === 'string' ? o.say.replace(/\s+/g, ' ').trim().slice(0, 400) : '';
  const draw = [];
  for (const op of Array.isArray(o.draw) ? o.draw.slice(0, 14) : []) {
    const clean = sanitizeOp(op);
    if (clean) draw.push(clean);
  }
  if (!say && !draw.length) return null;
  return { say, draw };
}

function sanitizeOp(op) {
  if (!op || typeof op !== 'object') return null;
  const t = String(op.t || op.type || '').toLowerCase();
  if (!OPS.has(t)) return null;
  const out = { t };
  if (typeof op.id === 'string' || typeof op.id === 'number') out.id = String(op.id).slice(0, 40);
  if (typeof op.c === 'string' && COLOURS.has(op.c.toLowerCase())) out.c = op.c.toLowerCase();
  for (const k of ['x', 'y', 'w', 'h', 'r', 'a0', 'a1', 'size', 'bend']) if (k in op) out[k] = num(op[k]);
  for (const k of ['s', 'f', 'label', 'xl', 'yl', 'ax', 'k']) if (typeof op[k] === 'string' || typeof op[k] === 'number') out[k] = String(op[k]).slice(0, 300);
  for (const k of ['fill', 'close', 'grid', 'dash']) if (k in op) out[k] = !!op[k];
  for (const k of ['from', 'to']) { const p = pt(op[k]); if (p) out[k] = p; }
  for (const k of ['xr', 'yr', 'dom']) { const p = pt(op[k]); if (p) out[k] = p; }
  if (Array.isArray(op.p)) out.p = op.p.map(pt).filter(Boolean).slice(0, 200);
  return out;
}
