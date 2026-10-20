// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · the tutor's ears
//
// Hands-free listening that keeps running *while the tutor talks*, so the
// student can cut in at any moment.
//
//   webspeech  Chrome / Edge / Safari's built-in recogniser. Streams partial
//              words within a few hundred ms, which is what makes barge-in
//              feel instant. Free, no server round trip.
//   whisper    Everywhere else (e.g. Firefox): an energy voice-activity
//              detector on the mic; when you stop talking, the clip goes to
//              Groq Whisper via /api/stt. Barge-in fires on the VAD onset.
//
// Events: 'speechstart', 'partial' {text}, 'final' {text}, 'error' {message}
// ─────────────────────────────────────────────────────────────────────────────

export class Ears extends EventTarget {
  /** @param {{lang?: string, cloudStt?: boolean}} [opts] */
  constructor(opts = {}) {
    super();
    this.lang = opts.lang || 'en-GB';
    // @ts-ignore — vendor-prefixed in Chrome/Safari
    this.SR = window.SpeechRecognition || window.webkitSpeechRecognition || null;
    const canRecord = !!(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
    /** @type {'webspeech'|'whisper'|'none'} */
    this.mode = this.SR ? 'webspeech' : canRecord && opts.cloudStt ? 'whisper' : 'none';
    this.on = false;
    /** @type {MediaStream|null} */ this.stream = null;
    /** @type {AnalyserNode|null} */ this.analyser = null;
    this.buf = new Float32Array(1024);
    this._level = 0;
  }

  get available() { return this.mode !== 'none'; }

  /** Current mic loudness 0..1 (drives the presence while you talk). */
  get level() {
    if (!this.analyser) return this._level;
    this.analyser.getFloatTimeDomainData(this.buf);
    let s = 0;
    for (const v of this.buf) s += v * v;
    return Math.min(1, Math.sqrt(s / this.buf.length) * 9);
  }

  async start() {
    if (this.on || !this.available) return;
    this.on = true;
    // Open the mic once (echo-cancelled), for the level meter and, in whisper mode, the recorder.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      this.actx = ctx;
      this.analyser = ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      ctx.createMediaStreamSource(this.stream).connect(this.analyser);
    } catch (err) {
      if (this.mode === 'whisper') { this.on = false; this.emit('error', { message: 'Microphone permission was denied.' }); return; }
      // Web Speech asks for permission itself; the meter is optional.
    }
    if (this.mode === 'webspeech') this.startWebSpeech();
    else this.startVad();
  }

  stop() {
    this.on = false;
    try { this.rec?.abort(); } catch { /* not running */ }
    clearInterval(this.vadTimer);
    if (this.recorder?.state === 'recording') this.recorder.stop();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.actx?.close();
    this.stream = null; this.analyser = null;
  }

  /** @param {string} type @param {object} [detail] */
  emit(type, detail = {}) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  // ── Web Speech ─────────────────────────────────────────────────────────────
  startWebSpeech() {
    const rec = new this.SR();
    rec.continuous = true;        // keep listening across sentences
    rec.interimResults = true;    // partial words → instant barge-in
    rec.lang = this.lang;
    rec.maxAlternatives = 1;
    rec.onresult = (/** @type {any} */ e) => {
      let interim = '', final = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript; else interim += r[0].transcript;
      }
      if (interim.trim()) this.emit('partial', { text: interim.trim() });
      if (final.trim()) this.emit('final', { text: final.trim() });
    };
    rec.onerror = (/** @type {any} */ e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.on = false;
        this.emit('error', { message: 'Microphone permission was denied.' });
      }
      // 'no-speech' and 'aborted' are routine; onend restarts us.
    };
    // Recognisers stop after a pause or a minute; quietly restart while enabled.
    rec.onend = () => { if (this.on) setTimeout(() => { try { if (this.on) rec.start(); } catch { /* already started */ } }, 120); };
    this.rec = rec;
    try { rec.start(); } catch { /* already started */ }
  }

  // ── VAD + Whisper fallback ────────────────────────────────────────────────
  startVad() {
    let floor = -60, above = 0, below = 0, speaking = false, startedAt = 0;
    /** @type {Blob[]} */ let chunks = [];
    this.vadTimer = setInterval(() => {
      if (!this.analyser || !this.stream) return;
      this.analyser.getFloatTimeDomainData(this.buf);
      let s = 0;
      for (const v of this.buf) s += v * v;
      const db = 10 * Math.log10(s / this.buf.length + 1e-10);
      if (!speaking) floor = Math.max(-75, Math.min(-35, floor * 0.97 + db * 0.03));   // track background noise
      const thresh = Math.max(floor + 12, -50);
      if (db > thresh) { above += 40; below = 0; } else { below += 40; above = Math.max(0, above - 40); }

      if (!speaking && above >= 160) {
        speaking = true; startedAt = performance.now(); chunks = [];
        this.emit('speechstart');
        const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
        this.recorder = new MediaRecorder(/** @type {MediaStream} */ (this.stream), mime ? { mimeType: mime } : undefined);
        this.recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
        this.recorder.onstop = () => this.transcribe(new Blob(chunks, { type: this.recorder?.mimeType || 'audio/webm' }));
        this.recorder.start();
      } else if (speaking && (below >= 700 || performance.now() - startedAt > 20000)) {
        speaking = false; above = 0;
        if (this.recorder?.state === 'recording') this.recorder.stop();
      }
    }, 40);
  }

  /** @param {Blob} blob */
  async transcribe(blob) {
    if (blob.size < 2000) { this.emit('final', { text: '' }); return; }  // a click, not a sentence
    try {
      const r = await fetch('/api/stt', { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
      const j = await r.json();
      this.emit('final', { text: String(j.text || '').trim() });
    } catch {
      this.emit('final', { text: '' });
    }
  }
}
