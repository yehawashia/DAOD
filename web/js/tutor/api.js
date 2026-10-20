// @ts-check
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · beat stream client
// Reads the server's NDJSON stream and yields beats the moment each line
// lands. Abort the signal to cancel instantly (the server then stops the model).
// ─────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{say:string, draw:any[], error?:string}} Beat
 */

/**
 * @param {object} body  request body for /api/lesson
 * @param {AbortSignal} signal
 * @returns {AsyncGenerator<Beat>}
 */
export async function* streamBeats(body, signal) {
  /** @type {Response|null} */
  let res = null;
  try {
    res = await fetch('/api/lesson', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
  }
  // No DAOD server here (opened as a static page): play the built-in lessons
  // in the browser so the 3D board still works end to end.
  const isOurs = !!res && (res.ok ? /ndjson/.test(res.headers.get('content-type') || '') : res.status === 400 || res.status === 429);
  if (!isOurs) {
    const { demoBeats } = await import('./demo.js');
    yield* demoBeats(body, signal);
    return;
  }
  if (!res || !res.ok || !res.body) {
    const msg = await res?.text().catch(() => '');
    throw new Error(`lesson ${res?.status} ${String(msg).slice(0, 120)}`);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      try { yield JSON.parse(line); } catch { /* a corrupt line is skipped, not fatal */ }
    }
  }
  if (buf.trim()) { try { yield JSON.parse(buf); } catch { /* ignore */ } }
}

/** @returns {Promise<{demo:boolean, model:string, tts:{model:string,voice:string}|null, stt:{model:string}|null}>} */
export async function getConfig() {
  try {
    const r = await fetch('/api/config');
    if (r.ok) return await r.json();
  } catch { /* offline: fall through */ }
  return { demo: true, model: 'offline', tts: null, stt: null };
}
