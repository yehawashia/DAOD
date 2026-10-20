// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · main: wires the board, the 3D world, the voice, the ears and the UI
// together, and owns the one animation loop everything runs on.
//
//   student ──speech/typing──▶ Ears / input ──▶ Conductor ──▶ /api/lesson
//                                                   │  ▲          (beats stream)
//                                   voice ◀─────────┤  └──────────────┘
//                                   board ◀─────────┘
//   board.canvas ──texture──▶ Scene (WebGL2)
// ─────────────────────────────────────────────────────────────────────────────

import { Board } from './board/board.js';
import { clearTypesetCache } from './board/mathtex.js';
import { Scene } from './gl/scene.js';
import { Voice } from './tutor/voice.js';
import { Ears } from './tutor/ears.js';
import { Conductor } from './tutor/conductor.js';
import { getConfig } from './tutor/api.js';

const $ = (/** @type {string} */ s) => /** @type {HTMLElement} */ (document.querySelector(s));
const params = new URLSearchParams(location.search);

// ── Core objects ─────────────────────────────────────────────────────────────
const board = new Board();
const voice = new Voice();
const conductor = new Conductor({ board, voice });
/** @type {Ears} */ let ears = new Ears();

/** @type {Scene|null} */
let scene = null;
try {
  scene = new Scene(/** @type {HTMLCanvasElement} */ ($('#gl')), board.canvas);
} catch (err) {
  // No WebGL2 (very old device / disabled GPU): show the board as flat glass.
  console.warn('[daod] 3D unavailable, using flat board', err);
  $('#gl').remove();
  board.canvas.className = 'flat-board';
  document.body.prepend(board.canvas);
}

// ── Settings (remembered per browser) ────────────────────────────────────────
const store = {
  get(/** @type {string} */ k, /** @type {any} */ d) { try { return JSON.parse(localStorage.getItem(`daod.${k}`) ?? 'null') ?? d; } catch { return d; } },
  set(/** @type {string} */ k, /** @type {any} */ v) { try { localStorage.setItem(`daod.${k}`, JSON.stringify(v)); } catch { /* private mode */ } },
};
voice.rate = store.get('rate', 1);
voice.engine = params.get('voice') === 'silent' ? 'silent' : store.get('engine', voice.engine);
voice.speedup = Math.max(1, +(params.get('speed') || 1));

// Fonts must be ready before the board measures handwriting.
const fontsReady = Promise.race([
  document.fonts.load('40px "Caveat"').then(() => document.fonts.load('600 64px "Caveat"')),
  new Promise((r) => setTimeout(r, 1500)),
]).then(() => clearTypesetCache());

// Server capabilities (demo mode, cloud voice, cloud ears). Never blocks startup.
let config = { demo: true, model: '…', tts: null, stt: null };
getConfig().then((c) => {
  config = c;
  ears = new Ears({ cloudStt: !!c.stt });
  bindEars();
  if (!ears.available) { /** @type {HTMLButtonElement} */ ($('#mic')).disabled = true; $('#mic').title = 'Speech input isn’t supported in this browser — type instead.'; }
  if (!c.tts && voice.engine === 'cloud') voice.engine = 'browser';
  $('#modelInfo').textContent = c.demo
    ? 'Demo mode: no model key on the server, so DAOD plays prepared lessons. Add GROQ_API_KEY to .env for real answers.'
    : `Thinking with ${c.model}. ${c.tts ? `Natural voice: ${c.tts.model}.` : ''}`;
  /** @type {HTMLOptionElement} */ ($('#engine option[value=cloud]')).disabled = !c.tts;
});

// ── Asking ───────────────────────────────────────────────────────────────────
/** @param {string} text @param {{interrupted?:boolean}} [opts] */
async function ask(text, opts = {}) {
  if (!text.trim()) return;
  voice.unlock();
  await fontsReady;
  document.body.classList.add('taught');
  conductor.ask(text, { interrupted: opts.interrupted ?? conductor.state !== 'idle' });
}

const form = /** @type {HTMLFormElement} */ ($('#askForm'));
const input = /** @type {HTMLInputElement} */ ($('#q'));
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const q = input.value;
  input.value = '';
  ask(q);
});
$('#pills').addEventListener('click', (e) => {
  const b = /** @type {HTMLElement} */ (e.target).closest('button');
  if (b) ask(b.textContent || '');
});

// ── Hands-free listening + barge-in ─────────────────────────────────────────
const mic = $('#mic');
mic.addEventListener('click', toggleMic);
async function toggleMic() {
  voice.unlock();
  if (ears.on) { ears.stop(); mic.setAttribute('aria-pressed', 'false'); return; }
  mic.setAttribute('aria-pressed', 'true');
  await ears.start();
  if (!ears.on) mic.setAttribute('aria-pressed', 'false');
}

const heard = $('#heard');
/** @type {any} */ let resumeTimer = 0;
/** @type {any} */ let heardTimer = 0;
let userTalking = false;

/** Words the tutor has just said: its own voice leaking into the mic must not interrupt it. */
function tutorWords() {
  const recent = [conductor.current?.beat.say || '', ...(conductor.turn?.said.slice(-2) || [])].join(' ');
  return new Set(words(recent));
}
/** @param {string} s */
const words = (s) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
/** Most of what we heard is what the tutor is saying → it's echo. @param {string} text */
function isEcho(text) {
  const w = words(text), mine = tutorWords();
  if (!w.length) return true;
  return w.filter((x) => mine.has(x)).length / w.length >= 0.7;
}
/** Backchannel ("okay", "go on") means "carry on", not "stop". @param {string} text */
const isContinue = (text) => /^(ok(ay)?|yes|yeah|yep|yup|go on|carry on|continue|keep going|right|sure|mm+|hmm+|uh huh|got it|cool|nice|thanks?|thank you|alright|fine|good|i see)[\s.!]*$/i.test(text.trim());
/** Worth stopping for: two new words, or one that clearly means "wait". @param {string} text */
function wantsFloor(text) {
  const mine = tutorWords();
  const fresh = words(text).filter((w) => !mine.has(w));
  return fresh.length >= 2 || /\b(wait|stop|hang on|hold on|pause|sorry|what|why|how|huh|actually|but)\b/i.test(text);
}
function armResume(ms = 3500) {
  clearTimeout(resumeTimer);
  resumeTimer = setTimeout(() => { if (conductor.state === 'paused') { conductor.resume(); hideHeard(); } }, ms);
}
/** @param {string} text */
function showHeard(text) { heard.textContent = text; heard.classList.add('show'); clearTimeout(heardTimer); }
function hideHeard(delay = 0) { clearTimeout(heardTimer); heardTimer = setTimeout(() => heard.classList.remove('show'), delay); }

function bindEars() {
  ears.addEventListener('partial', (e) => {
    const text = /** @type {CustomEvent} */ (e).detail.text;
    const busy = conductor.state === 'speaking' || conductor.state === 'thinking';
    if (busy && isEcho(text)) return;
    userTalking = true;
    showHeard(text);
    if (busy && wantsFloor(text) && !isContinue(text)) conductor.hold();
    if (conductor.state === 'paused') armResume();
  });
  ears.addEventListener('speechstart', () => {
    // VAD mode has no partial words, so the onset itself takes the floor.
    userTalking = true;
    if (conductor.state === 'speaking' || conductor.state === 'thinking') { conductor.hold(); armResume(9000); }
  });
  ears.addEventListener('final', (e) => {
    const text = /** @type {CustomEvent} */ (e).detail.text || '';
    userTalking = false;
    clearTimeout(resumeTimer);
    const busy = conductor.state !== 'idle';
    if (!text || (busy && isEcho(text))) { if (conductor.state === 'paused') conductor.resume(); hideHeard(); return; }
    showHeard(text); hideHeard(1600);
    if (busy && isContinue(text)) { if (conductor.state === 'paused') conductor.resume(); return; }
    ask(text, { interrupted: busy });
  });
  ears.addEventListener('error', (e) => {
    mic.setAttribute('aria-pressed', 'false');
    $('#hint').textContent = /** @type {CustomEvent} */ (e).detail.message + ' You can still type.';
  });
}
bindEars();

// ── Keyboard ─────────────────────────────────────────────────────────────────
addEventListener('keydown', (e) => {
  voice.unlock();
  if (e.key === 'Escape') { conductor.stop(); hideHeard(); input.blur(); return; }
  const typing = document.activeElement === input || /** @type {HTMLElement} */ (document.activeElement)?.closest?.('dialog');
  if (typing) return;
  if (e.key === ' ') { e.preventDefault(); toggleMic(); }
  else if (e.key === 'r' || e.key === 'R') scene?.resetView();
  else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) input.focus();   // start typing anywhere
});
addEventListener('pointerdown', () => voice.unlock(), { once: true });

// ── Settings dialog ──────────────────────────────────────────────────────────
const dlg = /** @type {HTMLDialogElement} */ ($('#settings'));
const engineSel = /** @type {HTMLSelectElement} */ ($('#engine'));
const voiceSel = /** @type {HTMLSelectElement} */ ($('#browserVoice'));
const rate = /** @type {HTMLInputElement} */ ($('#rate'));
$('#settingsBtn').addEventListener('click', () => {
  engineSel.value = voice.engine;
  rate.value = String(voice.rate);
  voiceSel.innerHTML = '';
  for (const v of voice.voices()) {
    const o = new Option(`${v.name} (${v.lang})`, v.voiceURI, false, v.voiceURI === voice.browserVoice?.voiceURI);
    voiceSel.add(o);
  }
  $('#browserVoiceRow').hidden = voice.engine !== 'browser';
  dlg.showModal();
});
engineSel.addEventListener('change', () => {
  voice.engine = /** @type {any} */ (engineSel.value);
  store.set('engine', voice.engine);
  $('#browserVoiceRow').hidden = voice.engine !== 'browser';
});
voiceSel.addEventListener('change', () => {
  voice.browserVoice = voice.voices().find((v) => v.voiceURI === voiceSel.value) || voice.browserVoice;
});
rate.addEventListener('input', () => { voice.rate = +rate.value; store.set('rate', voice.rate); });

// ── Readout + captions ───────────────────────────────────────────────────────
const stateEl = $('#state'), metricEl = $('#metric'), caption = $('#caption');
const LABEL = { idle: 'ready', thinking: 'thinking', speaking: 'speaking', paused: 'listening' };
conductor.addEventListener('state', () => {
  const s = conductor.state;
  document.body.dataset.state = s === 'paused' ? 'paused' : s;
  stateEl.textContent = LABEL[s];
  if (s === 'idle') setTimeout(() => { if (conductor.state === 'idle') caption.classList.add('fade'); }, 2500);
});
conductor.addEventListener('metric', (e) => {
  const m = /** @type {CustomEvent} */ (e).detail;
  // Honest numbers: time from asking to first beat, and to the first spoken word.
  metricEl.textContent = m.firstWordMs ? `first word ${(m.firstWordMs / 1000).toFixed(2)} s` : m.firstBeatMs ? `model ${(m.firstBeatMs / 1000).toFixed(2)} s` : '';
});
let capIndex = -1, capLit = -1;
/** @type {HTMLElement[]} */ let capWords = [];
conductor.addEventListener('caption', (e) => {
  const { text, p, index } = /** @type {CustomEvent} */ (e).detail;
  caption.classList.remove('fade');
  if (index !== capIndex) {
    capIndex = index; capLit = -1;
    caption.textContent = '';
    capWords = text.split(/\s+/).map((/** @type {string} */ w) => {
      const span = document.createElement('span');
      span.className = 'w'; span.textContent = w + ' ';
      caption.append(span);
      return span;
    });
  }
  // Light words as they're spoken; only touch the DOM when the count changes.
  const lit = Math.min(capWords.length, Math.ceil(p * capWords.length + 0.3));
  if (lit !== capLit) { for (let i = 0; i < capWords.length; i++) capWords[i].classList.toggle('on', i < lit); capLit = lit; }
});

// ── The loop ─────────────────────────────────────────────────────────────────
// One requestAnimationFrame drives speech timing, ink and the 3D scene.
// When nothing is happening it renders every other frame to save battery.
const t0 = performance.now();
let last = t0, skip = false, lastBusy = t0;
/** @param {number} now */
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(1 / 30, (now - last) / 1000);   // clamp: a background tab must not jump
  conductor.tick(now);
  board.update(now);
  if (board.dirty) { scene?.inkChanged(); board.dirty = false; }
  if (!scene) { last = now; return; }

  const busy = conductor.state !== 'idle' || board.animating || userTalking;
  if (busy) lastBusy = now;
  const sleepy = now - lastBusy > 8000 && now - scene.lastInput > 8000;
  if (sleepy && (skip = !skip)) return;
  last = now;

  const mode = conductor.state === 'paused' || userTalking ? 'listening' : conductor.state === 'idle' ? 'idle' : conductor.state;
  scene.render(dt, (now - t0) / 1000, {
    mode: /** @type {any} */ (mode),
    level: mode === 'listening' ? ears.level : conductor.level,
    pen: board.pen,
    ink: Math.min(1, board.items.size / 14),
  });
}
requestAnimationFrame(frame);

// ── Hooks for demos and tests ────────────────────────────────────────────────
if (params.get('ask')) fontsReady.then(() => ask(/** @type {string} */ (params.get('ask'))));
// @ts-ignore
window.__daod = { board, conductor, voice, get ears() { return ears; }, get scene() { return scene; }, ask };
