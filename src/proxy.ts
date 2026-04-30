import { NextRequest, NextResponse } from "next/server";

const FREE_SCENE_LIMIT = 2;

/**
 * Extracts the best IP from the request.
 * Cloudflare sets CF-Connecting-IP; otherwise falls back to x-forwarded-for.
 */
function getClientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
    "unknown"
  );
}

/**
 * Fetches IP usage count for today via an internal API call.
 * Returns 0 on any error (fail open).
 */
async function getIpUsageCount(ip: string, baseUrl: string): Promise<number> {
  try {
    const res = await fetch(
      `${baseUrl}/api/internal/usage?type=ip&id=${encodeURIComponent(ip)}`,
      {
        headers: {
          "x-internal-secret":
            process.env.INTERNAL_SECRET ?? "daod-internal-dev",
        },
        signal: AbortSignal.timeout(3000),
      }
    );
    if (!res.ok) return 0;
    const data = (await res.json()) as { count?: number };
    return data.count ?? 0;
  } catch {
    return 0;
  }
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const baseUrl = req.nextUrl.origin;

  // ── /api/scene/generate ────────────────────────────────────────────────────
  if (pathname === "/api/scene/generate") {
    const ip = getClientIp(req);
    const count = await getIpUsageCount(ip, baseUrl);

    if (count >= FREE_SCENE_LIMIT) {
      return NextResponse.json(
        { error: "limit_reached", upgrade: true },
        { status: 402 }
      );
    }

    // Pass IP header through so the route handler can track usage
    const res = NextResponse.next();
    res.headers.set("x-daod-ip", ip);
    return res;
  }

  // ── /api/interrupt ─────────────────────────────────────────────────────────
  // Without auth, interrupt is open for the demo — no gating
  if (pathname === "/api/interrupt") {
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/scene/generate", "/api/interrupt"],
};
