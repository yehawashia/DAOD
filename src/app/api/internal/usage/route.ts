import { NextRequest, NextResponse } from "next/server";
import { getUsageToday, getIpUsageToday } from "@/lib/db/usage";

const INTERNAL_SECRET = process.env.INTERNAL_SECRET ?? "daod-internal";

export async function GET(req: NextRequest) {
  if (req.headers.get("x-internal-secret") !== INTERNAL_SECRET) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const type = req.nextUrl.searchParams.get("type");
  const id = req.nextUrl.searchParams.get("id");

  if (!type || !id) {
    return NextResponse.json({ error: "Missing type or id" }, { status: 400 });
  }

  try {
    const count =
      type === "user"
        ? await getUsageToday(id)
        : await getIpUsageToday(id);
    return NextResponse.json({ count });
  } catch {
    return NextResponse.json({ count: 0 });
  }
}
