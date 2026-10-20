// @ts-nocheck
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · demo mode
//
// Hand-written lessons in the exact beat format the model streams. They are
// used when no API key is configured (so the app works out of the box), when
// there is no server at all (the browser plays them itself), as fixtures for
// the tests, and as reference examples of good beats.
// Pure JS with no DOM or Node APIs, so both the server and the browser import it.
// Every coordinate here was placed by hand on the 1600×900 board.
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {{say:string, draw:object[]}} Beat */

/** @type {{name:string, match:RegExp, beats:Beat[]}[]} */
export const LESSONS = [
  {
    name: 'Area of a circle',
    match: /circle|\bpi\b|π|radius|circumference/i,
    beats: [
      { say: "Let's work out the area of a circle.", draw: [{ t: 'title', s: 'Area of a circle' }] },
      { say: 'Here is a circle. The distance from the centre to the edge is the radius, r.', draw: [
        { t: 'circle', id: 'c', x: 1060, y: 360, r: 170, c: 'blue' },
        { t: 'line', id: 'rad', p: [[1060, 360], [1230, 360]] },
        { t: 'text', s: 'r', x: 1138, y: 340, size: 46 },
      ] },
      { say: 'Imagine cutting it into thin slices, like a pizza.', draw: [
        { t: 'line', p: [[1060, 190], [1060, 530]], c: 'grey', w: 2 },
        { t: 'line', p: [[913, 275], [1207, 445]], c: 'grey', w: 2 },
        { t: 'line', p: [[913, 445], [1207, 275]], c: 'grey', w: 2 },
        { t: 'line', p: [[890, 360], [1060, 360]], c: 'grey', w: 2 },
      ] },
      { say: 'Now unroll the slices, alternating up and down, into a bumpy strip.', draw: [
        { t: 'poly', id: 'strip', c: 'blue', close: false, p: [[880, 760], [930, 620], [980, 760], [1030, 620], [1080, 760], [1130, 620], [1180, 760], [1230, 620], [1280, 760], [1330, 620], [1380, 760], [1430, 620], [1480, 760]] },
      ] },
      { say: "It's nearly a rectangle. Its height is the radius, r,", draw: [
        { t: 'line', p: [[855, 620], [855, 760]], c: 'yellow', w: 4 },
        { t: 'text', s: 'r', x: 828, y: 702, size: 44, c: 'yellow' },
      ] },
      { say: 'and its length is half the circumference, which is pi r.', draw: [
        { t: 'line', p: [[880, 795], [1480, 795]], c: 'yellow', w: 4 },
        { t: 'math', s: '\\pi r', x: 1150, y: 845, size: 44, c: 'yellow' },
      ] },
      { say: 'So the area is length times height: pi r, times r.', draw: [{ t: 'math', s: 'A = \\pi r \\times r', size: 48 }] },
      { say: 'Which is pi r squared.', draw: [
        { t: 'math', id: 'f', s: 'A = \\pi r^2', size: 64, c: 'yellow' },
        { t: 'mark', id: 'f', k: 'box', c: 'yellow' },
      ] },
      { say: "Let's try one. Suppose the radius is three centimetres.", draw: [{ t: 'math', s: 'r = 3\\text{ cm}', size: 44 }] },
      { say: 'Square the radius first: three squared is nine.', draw: [{ t: 'math', s: 'r^2 = 9', size: 44 }] },
      { say: 'Then times by pi: nine pi, about twenty-eight point three square centimetres.', draw: [
        { t: 'math', id: 'ans', s: 'A = 9\\pi \\approx 28.3\\text{ cm}^2', size: 48, c: 'yellow' },
      ] },
      { say: 'So remember: square the radius, then multiply by pi.', draw: [{ t: 'mark', id: 'ans', k: 'underline', c: 'yellow' }] },
    ],
  },
  {
    name: "Pythagoras' theorem",
    match: /pythag|hypot|right.?angle|triangle/i,
    beats: [
      { say: "Let's look at Pythagoras' theorem.", draw: [{ t: 'title', s: "Pythagoras' theorem" }] },
      { say: 'It works for right-angled triangles, like this one.', draw: [
        { t: 'line', id: 'legs', p: [[1300, 720], [900, 720], [900, 420]], c: 'white', w: 5 },
        { t: 'poly', p: [[900, 690], [930, 690], [930, 720]], c: 'grey' },
      ] },
      { say: 'The two shorter sides are a and b.', draw: [
        { t: 'math', s: 'a = 3', x: 790, y: 580, size: 40, c: 'blue' },
        { t: 'math', s: 'b = 4', x: 1100, y: 775, size: 40, c: 'blue' },
      ] },
      { say: 'The longest side, opposite the right angle, is the hypotenuse, c.', draw: [
        { t: 'line', id: 'hyp', p: [[900, 420], [1300, 720]], c: 'pink', w: 5 },
        { t: 'math', s: 'c', x: 1130, y: 545, size: 46, c: 'pink' },
      ] },
      { say: 'The theorem says a squared plus b squared equals c squared.', draw: [
        { t: 'math', id: 'thm', s: 'a^2 + b^2 = c^2', size: 60, c: 'yellow' },
        { t: 'mark', id: 'thm', k: 'box', c: 'yellow' },
      ] },
      { say: 'So put in our numbers: three squared plus four squared.', draw: [{ t: 'math', s: '3^2 + 4^2 = c^2', size: 46 }] },
      { say: 'Nine plus sixteen is twenty-five.', draw: [{ t: 'math', s: '9 + 16 = 25', size: 46 }] },
      { say: 'So c squared is twenty-five, and c is the square root: five.', draw: [
        { t: 'math', id: 'ans', s: 'c = \\sqrt{25} = 5', size: 52, c: 'yellow' },
      ] },
      { say: 'The hypotenuse is five units long.', draw: [{ t: 'mark', id: 'hyp', k: 'ring', c: 'yellow' }] },
      { say: 'Square the short sides, add them, then square root.', draw: [{ t: 'mark', id: 'ans', k: 'underline', c: 'yellow' }] },
    ],
  },
  {
    name: 'Solving a quadratic',
    match: /quadratic|factoris|factoriz|x\^?2|x squared|parabola|roots?/i,
    beats: [
      { say: "Let's solve a quadratic equation.", draw: [{ t: 'title', s: 'Solving a quadratic' }] },
      { say: 'Say we want x squared minus x minus six equals zero.', draw: [{ t: 'math', id: 'eq', s: 'x^2 - x - 6 = 0', size: 52 }] },
      { say: 'Find two numbers that multiply to minus six and add to minus one.', draw: [{ t: 'text', s: 'multiply to -6, add to -1', size: 36, c: 'grey' }] },
      { say: 'Minus three and two work.', draw: [{ t: 'math', s: '-3 \\times 2 = -6, \\quad -3 + 2 = -1', size: 40, c: 'blue' }] },
      { say: 'So it factorises into x minus three, times x plus two.', draw: [{ t: 'math', id: 'fac', s: '(x - 3)(x + 2) = 0', size: 50 }] },
      { say: 'If two things multiply to zero, one of them must be zero.', draw: [{ t: 'mark', id: 'fac', k: 'underline', c: 'blue' }] },
      { say: 'So x is three, or x is minus two.', draw: [{ t: 'math', id: 'ans', s: 'x = 3 \\;\\text{ or }\\; x = -2', size: 50, c: 'yellow' }] },
      { say: 'Here is what that means on a graph.', draw: [
        { t: 'axes', id: 'ax', x: 860, y: 150, w: 660, h: 690, xr: [-4, 5], yr: [-7, 7], grid: true },
      ] },
      { say: 'The curve y equals x squared minus x minus six.', draw: [{ t: 'plot', id: 'curve', ax: 'ax', f: 'x^2 - x - 6', c: 'blue' }] },
      { say: 'It crosses zero exactly at minus two and three.', draw: [
        { t: 'dot', ax: 'ax', x: -2, y: 0, label: '(-2, 0)', c: 'yellow' },
        { t: 'dot', ax: 'ax', x: 3, y: 0, label: '(3, 0)', c: 'yellow' },
      ] },
      { say: 'The solutions are where the graph meets the x axis.', draw: [{ t: 'mark', id: 'ans', k: 'box', c: 'yellow' }] },
    ],
  },
  {
    name: 'Adding fractions',
    match: /fraction|denominator|numerator|\d\s*\/\s*\d|half|third|quarter/i,
    beats: [
      { say: "Let's add a third and a quarter.", draw: [{ t: 'title', s: 'Adding fractions' }] },
      { say: 'One third plus one quarter.', draw: [{ t: 'math', id: 'q', s: '\\frac{1}{3} + \\frac{1}{4}', size: 60 }] },
      { say: 'Here is a third of a bar,', draw: [
        { t: 'rect', x: 880, y: 200, w: 210, h: 80, fill: true, c: 'blue' },
        { t: 'rect', x: 880, y: 200, w: 630, h: 80 },
        { t: 'line', p: [[1090, 200], [1090, 280]] }, { t: 'line', p: [[1300, 200], [1300, 280]] },
      ] },
      { say: 'and a quarter of the same bar.', draw: [
        { t: 'rect', x: 880, y: 330, w: 157.5, h: 80, fill: true, c: 'pink' },
        { t: 'rect', x: 880, y: 330, w: 630, h: 80 },
        { t: 'line', p: [[1037.5, 330], [1037.5, 410]] }, { t: 'line', p: [[1195, 330], [1195, 410]] }, { t: 'line', p: [[1352.5, 330], [1352.5, 410]] },
      ] },
      { say: "The pieces are different sizes, so we can't just add them.", draw: [{ t: 'text', s: 'different sized pieces!', size: 36, c: 'grey' }] },
      { say: 'Cut both into twelfths, since twelve is in both times tables.', draw: [
        { t: 'rect', x: 880, y: 520, w: 210, h: 80, fill: true, c: 'blue' },
        { t: 'rect', x: 1090, y: 520, w: 157.5, h: 80, fill: true, c: 'pink' },
        { t: 'rect', id: 'bar', x: 880, y: 520, w: 630, h: 80 },
        { t: 'line', p: [[932.5, 520], [932.5, 600]], c: 'grey', w: 2 }, { t: 'line', p: [[985, 520], [985, 600]], c: 'grey', w: 2 },
        { t: 'line', p: [[1037.5, 520], [1037.5, 600]], c: 'grey', w: 2 }, { t: 'line', p: [[1142.5, 520], [1142.5, 600]], c: 'grey', w: 2 },
        { t: 'line', p: [[1195, 520], [1195, 600]], c: 'grey', w: 2 }, { t: 'line', p: [[1300, 520], [1300, 600]], c: 'grey', w: 2 },
        { t: 'line', p: [[1352.5, 520], [1352.5, 600]], c: 'grey', w: 2 }, { t: 'line', p: [[1405, 520], [1405, 600]], c: 'grey', w: 2 },
        { t: 'line', p: [[1457.5, 520], [1457.5, 600]], c: 'grey', w: 2 },
      ] },
      { say: 'A third is four twelfths, and a quarter is three twelfths.', draw: [{ t: 'math', s: '\\frac{4}{12} + \\frac{3}{12}', size: 58 }] },
      { say: 'Four plus three is seven, so the answer is seven twelfths.', draw: [{ t: 'math', id: 'ans', s: '= \\frac{7}{12}', size: 64, c: 'yellow' }] },
      { say: 'You can see seven of the twelve pieces are shaded.', draw: [{ t: 'mark', id: 'bar', k: 'box', c: 'yellow' }] },
      { say: 'Same size pieces first, then add the tops.', draw: [{ t: 'mark', id: 'ans', k: 'ring', c: 'yellow' }] },
    ],
  },
];

const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('aborted')); }, { once: true });
});

/**
 * Stream a demo lesson as beats, with model-like pacing.
 * @param {object} req       same body the real /api/lesson receives
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<Beat>}
 */
export async function* demoBeats(req, signal) {
  const topic = req.interrupted?.topic || req.question || '';
  const lesson = LESSONS.find((l) => l.match.test(topic)) || null;
  await sleep(160, signal); // ≈ a fast model's time to first token

  if (req.interrupted) {
    // Point at the most recent thing on the board, then resume the lesson.
    const ids = [...String(req.board || '').matchAll(/#([\w-]+)/g)].map((m) => m[1]);
    const last = ids[ids.length - 1];
    yield { say: 'Good question.', draw: last ? [{ t: 'mark', id: last, k: 'ring', c: 'pink' }] : [] };
    await sleep(70, signal);
    yield { say: "I'm running in demo mode, so I can't think on my feet yet. Add a Groq key and I'll answer anything.", draw: [] };
    if (lesson) {
      const done = Math.max(0, Math.min(lesson.beats.length, Number(req.beatsDone) || 0));
      if (done < lesson.beats.length) {
        await sleep(70, signal);
        yield { say: 'Right, back to where we were.', draw: [] };
        for (const b of lesson.beats.slice(done)) { await sleep(80, signal); yield b; }
      }
    }
    return;
  }

  if (!lesson) {
    yield { say: "I'm in demo mode, so here's a lesson I prepared earlier.", draw: [{ t: 'clear' }] };
  }
  const chosen = lesson || LESSONS[0];
  for (const [i, b] of chosen.beats.entries()) {
    // The first beat clears the board so a new topic always gets a fresh page.
    yield i === 0 ? { ...b, draw: [{ t: 'clear' }, ...b.draw] } : b;
    await sleep(90, signal);
  }
}
