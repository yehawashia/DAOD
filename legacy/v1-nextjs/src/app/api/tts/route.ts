import { NextRequest, NextResponse } from "next/server";

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { text, voice = "af_heart" } = body as {
    text?: unknown;
    voice?: unknown;
  };

  if (typeof text !== "string" || !text.trim()) {
    return NextResponse.json(
      { error: 'Request body must include a non-empty "text" string' },
      { status: 400 }
    );
  }

  const KOKORO_URL = process.env.KOKORO_URL ?? "http://localhost:8880";

  let kokoroResponse: Response;
  try {
    kokoroResponse = await fetch(`${KOKORO_URL}/v1/audio/speech`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "kokoro",
        input: text.trim(),
        voice: typeof voice === "string" ? voice : "af_heart",
        response_format: "mp3",
        speed: 1.0,
      }),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[tts] Kokoro unreachable at", KOKORO_URL, "—", message);
    return NextResponse.json(
      { error: `Kokoro TTS service unreachable: ${message}` },
      { status: 503 }
    );
  }

  if (!kokoroResponse.ok) {
    const errorText = await kokoroResponse.text().catch(() => "");
    console.error("[tts] Kokoro error:", kokoroResponse.status, errorText);
    console.error("[tts] Kokoro URL was:", KOKORO_URL);
    return NextResponse.json(
      { error: `Kokoro returned ${kokoroResponse.status}: ${errorText}` },
      { status: 502 }
    );
  }

  // Stream the audio response directly back to the client
  const audioStream = kokoroResponse.body;
  if (!audioStream) {
    return NextResponse.json(
      { error: "Kokoro returned no audio body" },
      { status: 502 }
    );
  }

  return new NextResponse(audioStream, {
    status: 200,
    headers: {
      "Content-Type": "audio/mpeg",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-store",
    },
  });
}
