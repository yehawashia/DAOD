#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// DAOD · server
//
// A zero-dependency Node (≥18) server. It does three things:
//   1. serves the static client (web/, or dist/ after `npm run build`)
//   2. proxies the LLM as a *beat stream* (NDJSON) — the key to low latency
//   3. proxies speech: text-to-speech and speech-to-text (Groq / OpenAI-style)
//
// The API key never reaches the browser. Any OpenAI-compatible endpoint works
// (Groq by default; Cerebras, OpenRouter, Together, or a local Ollama/LM Studio
// for open-source models) — set LLM_BASE_URL + LLM_MODEL in .env.
// With no key at all it runs in DEMO mode with hand-made lessons.
// ─────────────────────────────────────────────────────────────────────────────

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { buildMessages } from './prompt.mjs';
import { createObjectScanner, sanitizeBeat } from './beats.mjs';
import { demoBeats } from '../web/js/tutor/demo.js';   // shared with the browser (offline demo)

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
loadDotEnv(path.join(ROOT, '.env'));

// ── Configuration (all optional) ─────────────────────────────────────────────
const KEY = process.env.LLM_API_KEY || process.env.GROQ_API_KEY || '';
const CFG = {
  port: +(process.env.PORT || 8787),
  llmBase: (process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
  // gpt-oss-120b on Groq streams ~500 tok/s; with reasoning_effort=low it
  // starts talking fast and gets the maths right. llama-3.3-70b-versatile is a
  // good non-reasoning alternative; openai/gpt-oss-20b is ~2× faster again.
  llmModel: process.env.LLM_MODEL || 'openai/gpt-oss-120b',
  reasoning: process.env.LLM_REASONING_EFFORT || 'low',
  // Speech goes to Groq too unless pointed elsewhere.
  speechBase: (process.env.SPEECH_BASE_URL || 'https://api.groq.com/openai/v1').replace(/\/$/, ''),
  speechKey: process.env.SPEECH_API_KEY || process.env.GROQ_API_KEY || '',
  ttsModel: process.env.TTS_MODEL || 'canopylabs/orpheus-v1-english',
  ttsVoice: process.env.TTS_VOICE || 'autumn',
  sttModel: process.env.STT_MODEL || 'whisper-large-v3-turbo',
  demo: !KEY || process.env.DAOD_DEMO === '1',
};
const STATIC_DIR = fs.existsSync(path.join(ROOT, 'dist', 'index.html')) && process.env.DAOD_DEV !== '1'
  ? path.join(ROOT, 'dist') : path.join(ROOT, 'web');

// ── Tiny per-IP rate limit so a public deploy can't burn the key ─────────────
const hits = new Map();
function limited(ip, max = 40, windowMs = 60_000) {
  const now = Date.now(), h = hits.get(ip) || { n: 0, t: now };
  if (now - h.t > windowMs) { h.n = 0; h.t = now; }
  h.n++; hits.set(ip, h);
  return h.n > max;
}

// ── Routes ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/config') return json(res, 200, {
      demo: CFG.demo,
      model: CFG.demo ? 'demo' : CFG.llmModel,
      // The client uses these to decide which voice/ears are available.
      tts: CFG.speechKey ? { model: CFG.ttsModel, voice: CFG.ttsVoice } : null,
      stt: CFG.speechKey ? { model: CFG.sttModel } : null,
    });
    if (url.pathname.startsWith('/api/') && limited(req.socket.remoteAddress || '?')) {
      return json(res, 429, { error: 'Slow down a little.' });
    }
    if (url.pathname === '/api/lesson' && req.method === 'POST') return lesson(req, res);
    if (url.pathname === '/api/tts' && req.method === 'POST') return tts(req, res);
    if (url.pathname === '/api/stt' && req.method === 'POST') return stt(req, res);
    if (url.pathname.startsWith('/api/')) return json(res, 404, { error: 'Not found' });
    return serveStatic(url.pathname, req, res);
  } catch (err) {
    console.error('[daod]', err);
    if (!res.headersSent) json(res, 500, { error: String(err.message || err) });
    else res.end();
  }
});

/**
 * POST /api/lesson → text/plain stream, one beat JSON per line.
 * The client aborts this request the instant the student interrupts; we
 * propagate that abort upstream so the model stops generating (and billing).
 */
async function lesson(req, res) {
  const body = await readJson(req, 64_000);
  if (!body || typeof body.question !== 'string' || !body.question.trim()) {
    return json(res, 400, { error: 'Missing "question".' });
  }
  const ctrl = new AbortController();
  // 'close' on the response fires when the client goes away mid-stream.
  res.on('close', () => ctrl.abort());

  res.writeHead(200, {
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Accel-Buffering': 'no', // stop nginx-style proxies from buffering the stream
  });
  res.socket?.setNoDelay(true); // send each beat immediately, no Nagle batching

  const t0 = performance.now();
  let n = 0;
  const send = (beat) => {
    if (ctrl.signal.aborted) return;
    if (n === 0) console.log(`[lesson] first beat after ${Math.round(performance.now() - t0)} ms`);
    n++;
    res.write(JSON.stringify(beat) + '\n');
  };

  try {
    if (CFG.demo) {
      for await (const beat of demoBeats(body, ctrl.signal)) {
        const clean = sanitizeBeat(beat);
        if (clean) send(clean);
      }
    } else {
      const scanner = createObjectScanner((src) => {
        const beat = sanitizeBeat(src);
        if (beat) send(beat);
      });
      for await (const text of llmStream(buildMessages(body), ctrl.signal)) scanner.push(text);
    }
    console.log(`[lesson] ${n} beats in ${Math.round(performance.now() - t0)} ms`);
  } catch (err) {
    if (!ctrl.signal.aborted) {
      console.error('[lesson]', err.message);
      // Tell the student something rather than going silent.
      send({ say: 'Sorry — my connection to the model dropped. Could you ask that again?', draw: [], error: String(err.message).slice(0, 200) });
    }
  }
  res.end();
}

/**
 * Stream text deltas from any OpenAI-compatible chat endpoint (SSE).
 * @param {object[]} messages
 * @param {AbortSignal} signal
 */
async function* llmStream(messages, signal) {
  const body = {
    model: CFG.llmModel,
    messages,
    stream: true,
    temperature: 0.5,
    max_completion_tokens: 4096,
  };
  // Reasoning models: keep the thinking short so speech starts quickly.
  if (/gpt-oss|qwen3|o\d-|deepseek-r1|gemini/i.test(CFG.llmModel) && CFG.reasoning !== 'none') {
    body.reasoning_effort = CFG.reasoning;
  }
  const r = await fetch(`${CFG.llmBase}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!r.ok || !r.body) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 300)}`);

  const reader = r.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      try {
        // Only `content` is spoken output; `reasoning` deltas are ignored.
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) yield delta;
      } catch { /* keep-alive or partial line — ignore */ }
    }
  }
}

/** POST /api/tts {text, voice?} → audio/wav. The client prefetches the next beat's audio. */
async function tts(req, res) {
  if (!CFG.speechKey) return json(res, 501, { error: 'No speech key configured.' });
  const body = await readJson(req, 8_000);
  const text = String(body?.text || '').trim().slice(0, 500);
  if (!text) return json(res, 400, { error: 'Missing "text".' });
  const r = await fetch(`${CFG.speechBase}/audio/speech`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${CFG.speechKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: CFG.ttsModel, voice: String(body.voice || CFG.ttsVoice), input: text, response_format: 'wav' }),
  });
  if (!r.ok || !r.body) return json(res, 502, { error: `TTS ${r.status}: ${(await r.text()).slice(0, 300)}` });
  res.writeHead(200, { 'Content-Type': r.headers.get('content-type') || 'audio/wav', 'Cache-Control': 'no-store' });
  // Pipe the audio straight through without buffering it here.
  for await (const chunk of r.body) res.write(chunk);
  res.end();
}

/** POST /api/stt (raw audio body) → {text}. Fallback ears for browsers without Web Speech. */
async function stt(req, res) {
  if (!CFG.speechKey) return json(res, 501, { error: 'No speech key configured.' });
  const audio = await readBody(req, 8_000_000);
  const type = req.headers['content-type'] || 'audio/webm';
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), type.includes('ogg') ? 'speech.ogg' : type.includes('mp4') ? 'speech.mp4' : 'speech.webm');
  form.append('model', CFG.sttModel);
  form.append('language', 'en');
  form.append('response_format', 'json');
  const r = await fetch(`${CFG.speechBase}/audio/transcriptions`, {
    method: 'POST', headers: { Authorization: `Bearer ${CFG.speechKey}` }, body: form,
  });
  const out = await r.json().catch(() => ({}));
  if (!r.ok) return json(res, 502, { error: out?.error?.message || `STT ${r.status}` });
  json(res, 200, { text: String(out.text || '').trim() });
}

// ── Static files, gzipped once and cached in memory ──────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
const cache = new Map();

function serveStatic(pathname, req, res) {
  let rel = decodeURIComponent(pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(STATIC_DIR, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(STATIC_DIR)) return json(res, 403, { error: 'Forbidden' });
  let st;
  try { st = fs.statSync(file); } catch { return json(res, 404, { error: 'Not found' }); }
  if (st.isDirectory()) return serveStatic(rel + '/', req, res);

  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const textual = /text|javascript|json|svg|manifest/.test(type);
  const key = `${file}:${st.mtimeMs}`;
  let entry = cache.get(key);
  if (!entry) {
    const raw = fs.readFileSync(file);
    entry = { raw, gz: textual ? zlib.gzipSync(raw, { level: 9 }) : null, etag: `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"` };
    cache.set(key, entry);
  }
  if (req.headers['if-none-match'] === entry.etag) { res.writeHead(304); return res.end(); }
  const headers = {
    'Content-Type': type,
    ETag: entry.etag,
    // HTML always revalidates; everything else can sit in the browser cache briefly.
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  };
  if (entry.gz && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
    res.writeHead(200, headers);
    return res.end(entry.gz);
  }
  res.writeHead(200, headers);
  res.end(entry.raw);
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function json(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const parts = []; let size = 0;
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('Body too large')); req.destroy(); } else parts.push(c); });
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}
async function readJson(req, limit) {
  try { return JSON.parse((await readBody(req, limit)).toString('utf8')); } catch { return null; }
}
function loadDotEnv(file) {
  // Minimal .env reader: KEY=value lines, # comments, optional quotes.
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/i);
    if (m && !line.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
    }
  }
}

server.listen(CFG.port, () => {
  console.log(`\n  DAOD  →  http://localhost:${CFG.port}`);
  console.log(CFG.demo
    ? '  mode: DEMO (no LLM key found — set GROQ_API_KEY in .env for real lessons)\n'
    : `  model: ${CFG.llmModel} via ${CFG.llmBase}\n  voice: ${CFG.speechKey ? CFG.ttsModel : 'browser only'}\n`);
});
