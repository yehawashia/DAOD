import { NextRequest, NextResponse } from "next/server";
import { incrementUsage, incrementIpUsage } from "@/lib/db/usage";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "daod-internal";

export async function POST(req: NextRequest) {
  if (req.headers.get("x-internal-secret") !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { type, id } = body as { type?: string; id?: string };

  if (!type || !id) {
    return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
  }

  try {
    if (type === "user") {
      await incrementUsage(id);
    } else {
      await incrementIpUsage(id);
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[track-usage]", err);
    return NextResponse.json({ error: "DB error" }, { status: 500 });
  }
}
