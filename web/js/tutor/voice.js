// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · the tutor's voice
//
// Every beat's line becomes an Utterance with one tiny interface:
//   ready (Promise) · start() · stop() · progress 0..1 · ended · duration · level
//
// Three engines:
//   browser  speechSynthesis. Zero latency, zero cost, works offline.
//   cloud    Groq Orpheus via /api/tts. Natural voice; each beat's audio is
//            fetched while the previous beat is still being spoken
//            (prefetch), so there is no gap between beats.
//   silent   a timer (no speech available, or tests). Captions still run.
// ─────────────────────────────────────────────────────────────────────────────

/** @typedef {'browser'|'cloud'|'silent'} Engine */

/** Rough spoken duration of a line, in seconds. */
export function estimateSeconds(/** @type {string} */ text, rate = 1) {
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const digits = (text.match(/\d/g) || []).length;  // numbers take longer to say
  return words ? (words / 2.6 + digits * 0.08) / rate + 0.25 : 0;
}

/** Make maths symbols the model may slip into "say" speakable. */
export function speakable(/** @type {string} */ s) {
  return s
    .replace(/π/g, ' pi ').replace(/²/g, ' squared').replace(/³/g, ' cubed').replace(/√/g, ' root ')
    .replace(/×/g, ' times ').replace(/÷/g, ' divided by ').replace(/≈/g, ' approximately ')
    .replace(/≤/g, ' less than or equal to ').replace(/≥/g, ' greater than or equal to ').replace(/≠/g, ' not equal to ')
    .replace(/θ/g, ' theta ').replace(/°/g, ' degrees').replace(/\s=\s/g, ' equals ')
    .replace(/\\[a-z]+/gi, ' ').replace(/[{}^_$]/g, ' ').replace(/\s+/g, ' ').trim();
}

export class Voice {
  constructor() {
    /** @type {Engine} */ this.engine = 'speechSynthesis' in window ? 'browser' : 'silent';
    this.rate = 1.0;
    this.speedup = 1;          // test hook: ?speed=4 makes silent beats 4× faster
    /** @type {SpeechSynthesisVoice|null} */ this.browserVoice = null;
    this.cloudVoice = '';
    /** @type {AudioContext|null} */ this.ctx = null;
    /** @type {AnalyserNode|null} */ this.analyser = null;
    this.browserBroken = false;   // set if the browser accepts speech but never plays it
    this.misfires = 0;            // consecutive lines that never started
    this.primed = false;
    if ('speechSynthesis' in window) {
      const pick = () => { this.browserVoice = this.browserVoice || bestVoice(speechSynthesis.getVoices()); };
      pick();
      speechSynthesis.addEventListener?.('voiceschanged', pick);
    }
  }

  /** All browser voices, English first, for the settings menu. */
  voices() {
    if (!('speechSynthesis' in window)) return [];
    return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang)).sort((a, b) => score(b) - score(a));
  }

  /** Call from a click/keypress: browsers only allow audio after a user gesture. */
  unlock() {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext({ latencyHint: 'interactive' });
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 512;
        this.analyser.connect(this.ctx.destination);
      } catch { /* no Web Audio: cloud voice falls back to browser speech */ }
    }
    if (this.ctx?.state === 'suspended') this.ctx.resume();
    // iOS Safari only lets speech start inside a tap; speaking one silent
    // character now unlocks it for the real lines that follow a frame later.
    if (!this.primed && 'speechSynthesis' in window) {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
      this.primed = true;
    }
  }

  /**
   * Create (and for cloud, start fetching) the audio for one line.
   * @param {string} text
   * @returns {Utterance}
   */
  prepare(text) {
    const said = speakable(text || '');
    if (!said) return new SilentUtterance('', 1);
    if (this.engine === 'cloud' && this.ctx && this.analyser) return new CloudUtterance(said, this);
    if (this.engine === 'browser' && !this.browserBroken && 'speechSynthesis' in window) return new BrowserUtterance(said, this);
    return new SilentUtterance(said, this.rate * this.speedup);
  }

  /** Stop anything that might still be talking. */
  hush() { if ('speechSynthesis' in window) speechSynthesis.cancel(); }
}

/**
 * @typedef {object} Utterance
 * @property {Promise<void>} ready
 * @property {() => void} start
 * @property {() => void} stop
 * @property {number} progress
 * @property {boolean} ended
 * @property {number} duration   seconds (estimated until known)
 * @property {number} level      0..1 loudness for the presence animation
 */

/** A line with no audio: progress runs on a clock. */
class SilentUtterance {
  constructor(/** @type {string} */ text, /** @type {number} */ rate) {
    this.duration = estimateSeconds(text, rate);
    this.ready = Promise.resolve();
    this.t0 = 0; this.stopped = false;
  }
  start() { this.t0 = performance.now(); }
  stop() { this.stopped = true; }
  get progress() { return this.duration ? Math.min(1, (performance.now() - this.t0) / 1000 / this.duration) : 1; }
  get ended() { return this.stopped || this.progress >= 1; }
  get level() { return this.ended ? 0 : 0.35 + 0.25 * Math.sin(performance.now() / 90) * Math.sin(performance.now() / 157); }
}

/** speechSynthesis with a watchdog: some browsers queue speech and never play it. */
class BrowserUtterance {
  constructor(/** @type {string} */ text, /** @type {Voice} */ voice) {
    this.voice = voice;
    this.text = text;
    this.duration = estimateSeconds(text, voice.rate);
    this.ready = Promise.resolve();
    this.started = false; this._ended = false; this.t0 = 0; this.calledAt = 0;
    this.boundary = 0; this.hasBoundary = false; this.bump = 0;
    const u = new SpeechSynthesisUtterance(text);
    if (voice.browserVoice) { u.voice = voice.browserVoice; u.lang = voice.browserVoice.lang; } else u.lang = 'en-GB';
    u.rate = voice.rate;
    u.onstart = () => { this.started = true; this.t0 = performance.now(); voice.misfires = 0; };
    u.onboundary = (e) => {
      // Word boundaries let captions and the presence follow the real voice.
      this.hasBoundary = true; this.bump = 1;
      this.boundary = Math.max(this.boundary, (e.charIndex + (e.charLength || 0)) / text.length);
    };
    u.onend = u.onerror = () => { this._ended = true; };
    this.u = u;   // keep a reference: Chrome can garbage-collect an utterance mid-speech
  }
  start() {
    this.calledAt = performance.now();
    speechSynthesis.speak(this.u);
    // If speech hasn't begun within 1.5 s, run this line on a clock instead.
    // Two misfires in a row means this browser can't talk: captions only from then on.
    setTimeout(() => {
      if (this.started || this._ended) return;
      this.timerMode = true;
      if (++this.voice.misfires >= 2) this.voice.browserBroken = true;
    }, 1500);
  }
  stop() { this._ended = true; speechSynthesis.cancel(); }
  get elapsed() { return (performance.now() - (this.started ? this.t0 : this.calledAt)) / 1000; }
  get progress() {
    if (this._ended) return 1;
    const pt = this.elapsed / (this.duration || 1);
    const p = this.hasBoundary ? Math.max(this.boundary, Math.min(pt, this.boundary + 0.25)) : pt;
    return Math.min(this.timerMode ? 1 : 0.97, p);
  }
  get ended() {
    if (this.timerMode && this.elapsed >= this.duration) this._ended = true;
    // Watchdog: never wait forever for an 'end' event that got lost.
    if (this.started && this.elapsed > this.duration * 2.5 + 2) this._ended = true;
    return this._ended;
  }
  get level() {
    if (this._ended || !this.started) return 0;
    this.bump *= 0.9;
    const t = performance.now();
    return 0.3 + 0.2 * Math.abs(Math.sin(t / 95) * Math.sin(t / 151)) + this.bump * 0.3;
  }
}

/** Groq Orpheus (or any OpenAI-style /audio/speech) through the server. */
class CloudUtterance {
  constructor(/** @type {string} */ text, /** @type {Voice} */ voice) {
    this.voice = voice; this.text = text;
    this.duration = estimateSeconds(text, 1);
    this._ended = false; this.t0 = 0;
    /** @type {AudioBuffer|null} */ this.buffer = null;
    /** @type {AudioBufferSourceNode|null} */ this.src = null;
    /** @type {Utterance|null} */ this.fallback = null;
    this.data = new Uint8Array(256);
    const ctx = /** @type {AudioContext} */ (voice.ctx);
    this.ready = fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: voice.cloudVoice || undefined }) })
      .then((r) => { if (!r.ok) throw new Error(`tts ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => ctx.decodeAudioData(buf))
      .then((b) => { this.buffer = b; this.duration = b.duration; })
      .catch((err) => {
        // Never go quiet: fall back to the browser voice for this line.
        console.warn('[voice] cloud TTS failed, using browser voice', err);
        this.fallback = 'speechSynthesis' in window && !voice.browserBroken ? new BrowserUtterance(text, voice) : new SilentUtterance(text, 1);
        this.duration = this.fallback.duration;
      });
  }
  start() {
    if (this.fallback) return this.fallback.start();
    const ctx = /** @type {AudioContext} */ (this.voice.ctx);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    src.connect(/** @type {AnalyserNode} */ (this.voice.analyser));
    src.onended = () => { this._ended = true; };
    this.t0 = ctx.currentTime;
    src.start();
    this.src = src;
  }
  stop() {
    this._ended = true;
    if (this.fallback) return this.fallback.stop();
    try { this.src?.stop(); } catch { /* already stopped */ }
  }
  get progress() {
    if (this.fallback) return this.fallback.progress;
    if (this._ended) return 1;
    return this.src ? Math.min(1, (/** @type {AudioContext} */ (this.voice.ctx).currentTime - this.t0) / this.duration) : 0;
  }
  get ended() { return this.fallback ? this.fallback.ended : this._ended; }
  get level() {
    if (this.fallback) return this.fallback.level;
    const a = this.voice.analyser;
    if (!a || this._ended || !this.src) return 0;
    a.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) sum += (v - 128) * (v - 128);
    return Math.min(1, Math.sqrt(sum / this.data.length) / 40);
  }
}

// ── Choosing a nice default browser voice (British English first) ───────────
/** @param {SpeechSynthesisVoice} v */
function score(v) {
  let s = 0;
  if (/en-GB/i.test(v.lang)) s += 4; else if (/^en/i.test(v.lang)) s += 2;
  if (/natural|neural|online|premium|enhanced/i.test(v.name)) s += 5;   // Edge/Windows natural voices, macOS premium
  if (/google/i.test(v.name)) s += 3;
  if (/sonia|libby|ryan|serena|daniel|kate|arthur|martha/i.test(v.name)) s += 2;
  if (v.localService) s += 1;   // local voices start faster
  return s;
}
/** @param {SpeechSynthesisVoice[]} list */
function bestVoice(list) {
  const en = list.filter((v) => /^en/i.test(v.lang));
  return en.sort((a, b) => score(b) - score(a))[0] || list[0] || null;
}
