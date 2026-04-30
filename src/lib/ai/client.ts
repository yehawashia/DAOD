import Groq from "groq-sdk";
import { DAODSchema, type DAOD } from "./schema";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const MODEL = "llama-3.3-70b-versatile";
const MAX_RETRIES = 2;
const GROQ_TIMEOUT_MS = 15000;

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Groq request timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

/**
 * Calls Groq with JSON mode enforced, validates the response against the DAOD
 * Zod schema, and returns a typed DAOD object. Retries up to MAX_RETRIES times
 * on schema validation failures (LLMs are stochastic).
 */
export async function generateScene(
  systemPrompt: string,
  userPrompt: string
): Promise<DAOD> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt++) {
    let raw: string | null | undefined;

    try {
      console.log(`[groq] generateScene attempt ${attempt} starting`);
      const completion = await withTimeout(
        groq.chat.completions.create({
          model: MODEL,
          response_format: { type: "json_object" },
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: attempt === 1 ? 0.7 : 0.4,
          max_tokens: 4096,
        }),
        GROQ_TIMEOUT_MS
      );
      console.log(`[groq] generateScene attempt ${attempt} completed`);

      raw = completion.choices[0]?.message?.content;
    } catch (err) {
      console.error(
        `[groq] generateScene attempt ${attempt} failed:`,
        err instanceof Error ? err.message : String(err)
      );
      throw err instanceof Error ? err : new Error(String(err));
    }

    if (!raw) {
      lastError = new Error("Groq returned an empty response");
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      lastError = new Error(
        `Groq response was not valid JSON: ${raw.slice(0, 200)}`
      );
      continue;
    }

    const result = DAODSchema.safeParse(parsed);
    if (!result.success) {
      lastError = new Error(
        `DAOD schema validation failed (attempt ${attempt}): ${result.error.message}`
      );
      console.warn(`[groq] Attempt ${attempt} failed validation, retrying...`);
      continue;
    }

    const data = result.data;

    // Auto-align narration length to steps length.
    // The LLM often generates a mismatch. We trim or pad with empty strings
    // so the player always has a narration entry for every step index.
    if (data.narration.length !== data.steps.length) {
      const target = data.steps.length;
      if (data.narration.length > target) {
        data.narration = data.narration.slice(0, target);
      } else {
        while (data.narration.length < target) {
          data.narration.push("");
        }
      }
    }

    return data;
  }

  throw lastError ?? new Error("generateScene: exhausted retries");
}

/**
 * Calls Groq for free-form JSON, used for interruption continuation steps.
 */
export async function callGroqJSON(
  systemPrompt: string,
  userPrompt: string
): Promise<unknown> {
  const completion = await groq.chat.completions.create({
    model: MODEL,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    temperature: 0.7,
    max_tokens: 2048,
  });

  const raw = completion.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("Groq returned an empty response");
  }

  return JSON.parse(raw);
}
