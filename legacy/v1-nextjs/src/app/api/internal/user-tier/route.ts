import { NextRequest, NextResponse } from "next/server";
import { query } from "@/lib/db/client";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "daod-internal";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-internal-secret") !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const id = req.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  try {
    const rows = await query<{ tier: string }>(
      `SELECT tier FROM users WHERE clerk_id = $1 LIMIT 1`,
      [id]
    );
    const tier = rows[0]?.tier ?? "free";
    return NextResponse.json({ tier });
  } catch {
    return NextResponse.json({ tier: "free" });
  }
}
