// Unit tests for the pure, DOM-free parts. Run: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createObjectScanner, sanitizeBeat } from '../server/beats.mjs';
import { compile, sample } from '../web/js/board/expr.js';
import { LESSONS } from '../web/js/tutor/demo.js';
import { buildMessages } from '../server/prompt.mjs';

test('scanner emits each object as soon as it closes, whatever the wrapping', () => {
  const got = [];
  const sc = createObjectScanner((s) => got.push(JSON.parse(s)));
  // Fences, an array, two objects on one line, a brace inside a string, split chunks.
  const stream = '```json\n[{"say":"a {b}","draw":[]},{"say":"c","dr' + 'aw":[{"t":"title","s":"}"}]}]\n```';
  for (const ch of stream.match(/.{1,3}/gs)) sc.push(ch);
  assert.equal(got.length, 2);
  assert.equal(got[0].say, 'a {b}');
  assert.equal(got[1].draw[0].s, '}');
});

test('sanitizer keeps known ops, coerces numbers, drops junk', () => {
  const b = sanitizeBeat({ say: '  Hello   there ', draw: [
    { t: 'circle', x: '100', y: 200, r: 50, c: 'BLUE', evil: '<script>' },
    { t: 'nuke' }, null, { type: 'text', s: 'hi' },
  ] });
  assert.equal(b.say, 'Hello there');
  assert.deepEqual(b.draw[0], { t: 'circle', x: 100, y: 200, r: 50, c: 'blue' });
  assert.equal(b.draw.length, 2);
  assert.equal(b.draw[1].t, 'text');
  assert.equal(sanitizeBeat('not json'), null);
  assert.equal(sanitizeBeat({ say: '', draw: [] }), null);
});

test('expression parser reads maths the way people write it', () => {
  const at = (src, x) => compile(src)(x);
  assert.equal(at('x^2 - x - 6', 3), 0);
  assert.equal(at('2x', 4), 8);
  assert.equal(at('3(x+1)', 1), 6);
  assert.equal(at('x(x-2)', 3), 3);
  assert.equal(at('-x^2', 3), -9);           // −(x²), not (−x)²
  assert.equal(at('2^3^2', 0), 512);         // right-associative
  assert.equal(at('|x - 5|', 2), 3);
  assert.ok(Math.abs(at('2sin(pi x/2)', 1) - 2) < 1e-12);
  assert.ok(Math.abs(at('sin^2(x) + cos^2(x)', 0.7) - 1) < 1e-12);
  assert.equal(at('y = 1/x', 4), 0.25);
  assert.equal(at('{x+1}/{2}', 3), 2);           // LaTeX-style braces work as brackets
  assert.throws(() => compile('alert(1)'));
  assert.throws(() => compile('x; process.exit()'));
});

test('sampling splits at asymptotes instead of drawing a vertical line', () => {
  const runs = sample(compile('1/x'), -5, 5, -5, 5);
  assert.ok(runs.length >= 2);
});

test('demo lessons are valid beats and stay on the board', () => {
  for (const l of LESSONS) {
    for (const b of l.beats) {
      const s = sanitizeBeat(b);
      assert.ok(s, `${l.name}: bad beat ${JSON.stringify(b).slice(0, 80)}`);
      assert.equal(s.draw.length, b.draw.length, `${l.name}: ops dropped in "${b.say}"`);
      for (const op of b.draw) {
        for (const [x, y] of [[op.x, op.y], ...(op.p || [])]) {
          if (x === undefined || op.ax) continue;
          assert.ok(x >= 0 && x <= 1600 && y >= 0 && y <= 900, `${l.name}: off board ${JSON.stringify(op)}`);
        }
      }
    }
  }
});

test('interruption prompt carries what was being said and the board', () => {
  const m = buildMessages({ question: 'why squared?', board: '#f math "A = \\pi r^2"', interrupted: { saying: 'which is pi r squared', topic: 'area of a circle' } });
  const last = m.at(-1).content;
  assert.match(last, /INTERRUPTED/);
  assert.match(last, /which is pi r squared/);
  assert.match(last, /#f math/);
});
