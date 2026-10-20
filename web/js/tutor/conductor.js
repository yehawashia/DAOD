// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · the conductor
//
// Turns a stream of beats into a performance. One beat at a time:
//   speak its line  +  draw its ops, with the pen timed to the voice.
// Beats start playing while later beats are still being generated.
//
// The conductor is driven by the app's single animation loop (tick(now)), so
// speech, ink and the 3D scene all share one clock and nothing drifts.
//
// Interruptions have two stages, so "mm-hmm" doesn't derail a lesson:
//   hold()      the student started talking: stop the voice, freeze the pen,
//               keep receiving beats in the background.
//   resume()    it was nothing (echo, "okay", "go on"): replay the line.
//   ask(q, {interrupted:true})  it was a real question: drop the rest of the
//               old answer, finish the half-drawn stroke, and ask the model,
//               telling it exactly where it was cut off.
// ─────────────────────────────────────────────────────────────────────────────

import { streamBeats } from './api.js';

/** @typedef {import('./voice.js').Utterance} Utterance */
/** @typedef {{say:string, draw:any[], utter?:Utterance, ready?:boolean, error?:string}} QueuedBeat */
/** @typedef {'idle'|'thinking'|'speaking'|'paused'} State */

const PREFETCH = 3;          // how many upcoming beats get their audio prepared early
const COMFORT_SPEED = 520;   // px of ink per second when there's time to spare
const MAX_SPEED = 2400;      // px/s: if the line is short and the drawing long, the pen hurries — up to here
const GAP_MS = 90;           // a breath between beats

export class Conductor extends EventTarget {
  /**
   * @param {{board: import('../board/board.js').Board, voice: import('./voice.js').Voice}} deps
   */
  constructor({ board, voice }) {
    super();
    this.board = board;
    this.voice = voice;
    /** @type {State} */ this.state = 'idle';
    /** @type {QueuedBeat[]} */ this.queue = [];
    /** @type {null|{beat:QueuedBeat, draw:any, t0:number, drawSecs:number, index:number, started:boolean, elapsedAtPause:number}} */ this.current = null;
    /** @type {AbortController|null} */ this.ctrl = null;
    this.streamDone = true;
    this.paused = false; this.pausedAt = 0;
    this.gapUntil = 0;
    /** @type {{role:'user'|'assistant', content:string}[]} */ this.history = [];
    /** @type {null|{question:string, said:string[], t0:number}} */ this.turn = null;
    this.topic = '';          // the lesson in progress (survives interruptions)
    this.beatsDone = 0;       // beats completed in that lesson (demo mode resumes from here)
    this.beatIndex = 0;
    this.metrics = { firstBeatMs: 0, firstWordMs: 0 };
  }

  /** @param {State} s */
  setState(s) {
    if (s === this.state) return;
    this.state = s;
    this.emit('state', { state: s });
  }
  /** @param {string} type @param {object} detail */
  emit(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  /** Loudness of the tutor's voice right now (0..1). */
  get level() { return this.current && !this.paused ? this.current.beat.utter?.level ?? 0 : 0; }

  // ── Asking ─────────────────────────────────────────────────────────────────

  /**
   * Ask the tutor something. Anything in flight is cut off cleanly first.
   * @param {string} question
   * @param {{interrupted?: boolean}} [opts]
   */
  ask(question, opts = {}) {
    const q = question.trim();
    if (!q) return;
    const wasActive = this.state !== 'idle';
    const interrupted = !!opts.interrupted && wasActive;
    const saying = this.current?.beat.say || this.turn?.said.at(-1) || '';
    this.cut(); // stop voice, finish half-drawn strokes, abort the stream

    // Close out the interrupted turn in the history so the model sees it.
    if (this.turn && this.turn.said.length) {
      this.history.push({ role: 'assistant', content: this.turn.said.join(' ') + (interrupted ? ' —' : '') });
    }
    if (!interrupted) { this.topic = q; this.beatsDone = 0; }

    const body = {
      question: q,
      history: this.history.slice(-8),
      board: this.board.describe(),
      interrupted: interrupted ? { saying, topic: this.topic } : undefined,
      beatsDone: this.beatsDone,
    };
    this.history.push({ role: 'user', content: q });
    this.turn = { question: q, said: [], t0: performance.now() };
    this.metrics = { firstBeatMs: 0, firstWordMs: 0 };
    this.beatIndex = 0;
    this.setState('thinking');
    this.emit('asked', { question: q, interrupted });

    const ctrl = new AbortController();
    this.ctrl = ctrl;
    this.streamDone = false;
    (async () => {
      try {
        for await (const beat of streamBeats(body, ctrl.signal)) {
          if (ctrl.signal.aborted) return;
          if (!this.metrics.firstBeatMs && this.turn) {
            this.metrics.firstBeatMs = performance.now() - this.turn.t0;
            this.emit('metric', this.metrics);
          }
          this.queue.push(beat);
          this.prefetch();
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          console.warn('[conductor] stream failed', err);
          this.queue.push({ say: "Sorry, I couldn't reach my brain just then. Try asking again?", draw: [] });
          this.prefetch();
        }
      } finally {
        if (this.ctrl === ctrl) this.streamDone = true;
      }
    })();
  }

  /** Stop everything now (Esc). */
  stop() {
    if (this.turn && this.turn.said.length) this.history.push({ role: 'assistant', content: this.turn.said.join(' ') + ' —' });
    this.turn = null;
    this.cut();
    this.setState('idle');
  }

  /** Abort the stream, silence the voice, settle the board. */
  cut() {
    this.ctrl?.abort();
    this.ctrl = null;
    this.streamDone = true;
    if (this.current) {
      this.current.beat.utter?.stop();
      // Finish the stroke in progress so the board stays consistent with what
      // we tell the model; drop the rest of the answer.
      this.board.finish(this.current.draw);
      this.beatsDone++;   // its ink is on the board now, so it counts as delivered
      this.current = null;
    }
    for (const b of this.queue) b.utter?.stop();
    this.queue = [];
    this.voice.hush();
    this.paused = false;
  }

  // ── Barge-in ───────────────────────────────────────────────────────────────

  /** The student has started talking: freeze. */
  hold() {
    if (this.paused || this.state === 'idle') return;
    this.paused = true;
    this.pausedAt = performance.now();
    this.current?.beat.utter?.stop();
    this.voice.hush();
    this.setState('paused');
  }

  /** False alarm: pick up where we left off (the interrupted line is said again). */
  resume() {
    if (!this.paused) return;
    this.paused = false;
    if (this.current) {
      const beat = this.current.beat;
      beat.utter = this.voice.prepare(beat.say);
      beat.ready = false;
      beat.utter.ready.then(() => { beat.ready = true; });
      this.current.started = false;    // re-start the voice on the next tick; the pen carries on from where it froze
    }
    this.setState(this.current || this.queue.length ? 'speaking' : this.streamDone ? 'idle' : 'thinking');
  }

  // ── The clock ──────────────────────────────────────────────────────────────

  /** Prepare audio for the next few beats while the current one plays. */
  prefetch() {
    for (const b of this.queue.slice(0, PREFETCH)) {
      if (b.utter) continue;
      b.utter = this.voice.prepare(b.say);
      b.utter.ready.then(() => { b.ready = true; });
    }
  }

  /**
   * Advance the performance. Called once per animation frame.
   * @param {number} now performance.now()
   */
  tick(now) {
    if (this.paused) return;
    const cur = this.current;

    if (cur) {
      const u = /** @type {Utterance} */ (cur.beat.utter);
      // A resumed beat waits for its re-prepared audio, then speaks again.
      if (!cur.started) {
        if (!cur.beat.ready) { cur.t0 = now - (cur.elapsedAtPause || 0); return; }
        u.start(); cur.started = true;
      }
      const elapsed = (now - cur.t0) / 1000;
      cur.elapsedAtPause = now - cur.t0;
      const p = Math.min(1, elapsed / cur.drawSecs);
      this.board.setProgress(cur.draw, easeInOut(p));
      this.emit('caption', { text: cur.beat.say, p: u.progress, index: cur.index });
      if (p >= 1 && u.ended) {
        this.board.finish(cur.draw);
        this.turn?.said.push(cur.beat.say);
        this.beatsDone++;
        this.current = null;
        this.gapUntil = now + GAP_MS;
        this.emit('caption', { text: cur.beat.say, p: 1, index: cur.index });
      }
      return;
    }

    if (now < this.gapUntil) return;
    const next = this.queue[0];
    if (next) {
      if (!next.utter) this.prefetch();
      if (!next.ready) return;          // audio still downloading: wait (no gap if prefetched)
      this.queue.shift();
      this.prefetch();
      const u = /** @type {Utterance} */ (next.utter);
      const draw = this.board.begin(next.draw);
      // Pen timing: draw at a comfortable pace within the line's duration,
      // hurrying (up to MAX_SPEED) only if there's a lot to draw.
      const speech = u.duration;
      let drawSecs = speech > 0 ? Math.min(speech * 0.95, Math.max(0.4, draw.total / COMFORT_SPEED)) : Math.max(0.35, draw.total / 900);
      drawSecs = Math.max(drawSecs, draw.total / MAX_SPEED, 0.05);
      u.start();
      this.current = { beat: next, draw, t0: now, drawSecs, index: this.beatIndex++, started: true, elapsedAtPause: 0 };
      if (!this.metrics.firstWordMs && this.turn) {
        this.metrics.firstWordMs = now - this.turn.t0;
        this.emit('metric', this.metrics);
      }
      this.setState('speaking');
      return;
    }

    // Nothing queued: either the model is still thinking, or we're done.
    if (this.streamDone && this.state !== 'idle') {
      if (this.turn) this.history.push({ role: 'assistant', content: this.turn.said.join(' ') });
      this.turn = null;
      this.setState('idle');
      this.emit('done', {});
    } else if (!this.streamDone && this.state === 'speaking') {
      this.setState('thinking');   // waiting on the model mid-answer
    }
  }
}

/** Gentle start and finish, like a hand. @param {number} t */
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2) * 0.35 + t * 0.65;
