import { NextRequest, NextResponse } from "next/server";
import { callGroqJSON } from "@/lib/ai/client";
import { INTERRUPT_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { DAODStep, type DAODStepType } from "@/lib/ai/schema";
import { z } from "zod";

const InterruptRequestSchema = z.object({
  question: z.string().min(1),
  currentState: z.unknown().optional(),
  completedSteps: z.array(z.unknown()).optional(),
  remainingSteps: z.array(z.unknown()).optional(),
  conversationHistory: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      })
    )
    .optional(),
});

const InterruptResponseSchema = z.object({
  narration: z.array(z.string()).min(1).max(4),
  steps: z.array(DAODStep).min(1).max(4),
});

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = InterruptRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: `Invalid request: ${parsed.error.message}` },
      { status: 400 }
    );
  }

  const { question, currentState, conversationHistory = [] } = parsed.data;

  // Build the user prompt with full context
  const userPrompt = buildInterruptPrompt(
    question,
    currentState,
    conversationHistory
  );

  let raw: unknown;
  try {
    raw = await callGroqJSON(INTERRUPT_SYSTEM_PROMPT, userPrompt);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[interrupt]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const result = InterruptResponseSchema.safeParse(raw);
  if (!result.success) {
    console.error("[interrupt] schema validation failed:", result.error.message);
    return NextResponse.json(
      { error: `AI response did not match expected format: ${result.error.message}` },
      { status: 500 }
    );
  }

  const response: { narration: string[]; steps: DAODStepType[] } = {
    narration: result.data.narration,
    steps: result.data.steps,
  };

  return NextResponse.json(response);
}

function buildInterruptPrompt(
  question: string,
  currentState: unknown,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): string {
  const stateSummary =
    currentState && typeof currentState === "object"
      ? summariseState(currentState as Record<string, unknown>)
      : "No scene state available.";

  const historyText =
    conversationHistory.length > 0
      ? conversationHistory
          .map((m) => `${m.role === "user" ? "Student" : "DAOD"}: ${m.content}`)
          .join("\n")
      : "No prior conversation.";

  return `## Current scene state
${stateSummary}

## Conversation so far
${historyText}

## Student's question
"${question}"

Generate 2–4 continuation steps that directly answer this question, then smoothly return to the original explanation.`;
}

function summariseState(state: Record<string, unknown>): string {
  if (!state.objects || !Array.isArray(state.objects)) {
    return "Empty scene.";
  }

  const objects = state.objects as Array<{
    id: string;
    type: string;
    position?: { x: number; y: number };
    visible?: boolean;
  }>;

  const visible = objects.filter((o) => o.visible !== false);
  if (visible.length === 0) return "Scene has no visible objects.";

  return visible
    .map((o) => {
      const pos = o.position
        ? ` at (${o.position.x.toFixed(1)}, ${o.position.y.toFixed(1)})`
        : "";
      return `- ${o.id} [${o.type}]${pos}`;
    })
    .join("\n");
}
