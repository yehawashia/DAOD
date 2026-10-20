import { NextRequest, NextResponse } from "next/server";
import { generateScene } from "@/lib/ai/client";
import { SCENE_SYSTEM_PROMPT, buildTopicPrompt } from "@/lib/ai/prompts";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "daod-internal";

async function trackUsage(req: NextRequest): Promise<void> {
  const userId = req.headers.get("x-daod-user-id");
  const ip = req.headers.get("x-daod-ip");

  const type = userId ? "user" : "ip";
  const id = userId ?? ip;
  if (!id) return;

  try {
    await fetch(`${req.nextUrl.origin}/api/internal/track-usage`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-internal-secret": INTERNAL_SECRET,
      },
      body: JSON.stringify({ type, id }),
    });
  } catch {
    // Non-fatal — usage tracking must never block scene generation
  }
}

export async function POST(req: NextRequest) {
  console.log("[scene/generate] request received");
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    typeof (body as Record<string, unknown>).topic !== "string" ||
    !(body as Record<string, unknown>).topic
  ) {
    return NextResponse.json(
      { error: 'Request body must include a non-empty "topic" string' },
      { status: 400 }
    );
  }

  const topic = (body as { topic: string }).topic.trim();
  console.log("[scene/generate] topic:", topic);

  try {
    const scene = await generateScene(SCENE_SYSTEM_PROMPT, buildTopicPrompt(topic));
    console.log("[scene/generate] scene generated with steps:", scene.steps.length);

    // Fire-and-forget usage tracking (don't await — don't block the response)
    trackUsage(req).catch(() => {});

    return NextResponse.json(scene);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[scene/generate]", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
