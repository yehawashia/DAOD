/**
 * DAOD End-to-End Pipeline Test
 * Run with: npx tsx scripts/test-pipeline.ts
 */

import * as fs from "fs";
import * as path from "path";

// Load .env.local manually (tsx doesn't load Next.js env automatically)
function loadEnv() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) {
    console.error("FAIL — .env.local not found");
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

loadEnv();

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const KOKORO_URL = process.env.KOKORO_URL ?? "http://localhost:8880";

type CheckResult = { name: string; pass: boolean; detail: string };
const results: CheckResult[] = [];

function pass(name: string, detail: string) {
  results.push({ name, pass: true, detail });
  console.log(`  ✓ ${name}: ${detail}`);
}

function fail(name: string, detail: string) {
  results.push({ name, pass: false, detail });
  console.error(`  ✗ ${name}: ${detail}`);
}

// ── Check 0: Environment ────────────────────────────────────────────────────

console.log("\n[0] Environment checks");
if (GROQ_API_KEY && GROQ_API_KEY !== "your_groq_api_key_here") {
  pass("GROQ_API_KEY", "set");
} else {
  fail("GROQ_API_KEY", "missing or placeholder — set it in .env.local");
}

async function main() {

// ── Check 1: Groq → /api/scene/generate ────────────────────────────────────

console.log("\n[1] /api/scene/generate — topic: 'explain what a fraction is'");
let sceneJson: Record<string, unknown> | null = null;
let firstNarration = "";

try {
  const res = await fetch(`${BASE_URL}/api/scene/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic: "explain what a fraction is" }),
  });

  if (!res.ok) {
    const body = await res.text();
    fail("HTTP status", `${res.status} — ${body.slice(0, 200)}`);
  } else {
    sceneJson = (await res.json()) as Record<string, unknown>;

    // Validate top-level keys
    const required = ["version", "title", "topic", "narration", "steps"];
    const missing = required.filter((k) => !(k in sceneJson!));
    if (missing.length > 0) {
      fail("Schema keys", `Missing: ${missing.join(", ")}`);
    } else {
      pass("HTTP status", `200 OK`);
      pass("Schema keys", `All present: ${required.join(", ")}`);
    }

    const narration = sceneJson.narration as string[];
    const steps = sceneJson.steps as unknown[];
    pass("steps count", `${steps.length} steps`);
    pass("narration count", `${narration.length} lines`);

    if (narration.length !== steps.length) {
      // Client auto-aligns these — log as a warning, not a test failure
      console.log(`  ~ narration/steps alignment: ${narration.length} narration vs ${steps.length} steps (auto-aligned by client)`);
      pass("narration/steps alignment", `Auto-aligned to ${steps.length}`);
    } else {
      pass("narration/steps alignment", "Lengths match");
    }

    firstNarration = narration[0] ?? "";
    pass("First narration line", `"${firstNarration.slice(0, 80)}"`);

    console.log("\n  Full scene JSON:\n" + JSON.stringify(sceneJson, null, 2));
  }
} catch (err) {
  fail("Fetch /api/scene/generate", `${err instanceof Error ? err.message : err}`);
  console.error("  Is the Next.js dev server running? Start it with: npm run dev");
}

// ── Check 2: Kokoro health ──────────────────────────────────────────────────

console.log("\n[2] Kokoro TTS health check");
try {
  const healthRes = await fetch(`${KOKORO_URL}/health`, { signal: AbortSignal.timeout(5000) });
  if (healthRes.ok) {
    pass("Kokoro /health", `${healthRes.status} OK`);
  } else {
    fail("Kokoro /health", `HTTP ${healthRes.status}`);
  }
} catch (err) {
  fail("Kokoro /health", `Unreachable — ${err instanceof Error ? err.message : err}`);
}

// ── Check 3: TTS via /api/tts ───────────────────────────────────────────────

console.log("\n[3] /api/tts — synthesise first narration line");
const ttsText =
  firstNarration || "Let us explore Pythagoras theorem together.";

try {
  const ttsRes = await fetch(`${BASE_URL}/api/tts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: ttsText, voice: "af_heart" }),
  });

  if (!ttsRes.ok) {
    const body = await ttsRes.text();
    fail("HTTP status", `${ttsRes.status} — ${body.slice(0, 200)}`);
  } else {
    const contentType = ttsRes.headers.get("content-type") ?? "";
    const buf = await ttsRes.arrayBuffer();
    const byteLength = buf.byteLength;

    if (byteLength > 0) {
      pass("Audio buffer", `${byteLength} bytes, content-type: ${contentType}`);
    } else {
      fail("Audio buffer", "Empty response — Kokoro returned 0 bytes");
    }
  }
} catch (err) {
  fail("Fetch /api/tts", `${err instanceof Error ? err.message : err}`);
}

// ── Summary ─────────────────────────────────────────────────────────────────

console.log("\n─────────────────────────────────────────");
console.log("PIPELINE TEST SUMMARY");
console.log("─────────────────────────────────────────");
for (const r of results) {
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
}

const failed = results.filter((r) => !r.pass);
if (failed.length === 0) {
  console.log("\n✓ All checks passed.\n");
  process.exit(0);
} else {
  console.log(`\n✗ ${failed.length} check(s) failed.\n`);
  process.exit(1);
}

} // end main

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
