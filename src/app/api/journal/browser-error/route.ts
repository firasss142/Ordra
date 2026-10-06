import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { recordAppError } from "@/lib/journal/app-errors";
import { withRouteErrors } from "@/lib/journal/route-errors";
import { firstFrame, isNoise, normalisePage, shortHash, type BrowserErrorReport } from "@/lib/journal/browser-error";

export const dynamic = "force-dynamic";

/**
 * POST /api/journal/browser-error — a page crashed in someone's browser.
 * Signed-in users only; noise (extensions, ResizeObserver, aborted requests)
 * is dropped. Grouped per page pattern + error name + message hash, so the
 * detector's `browser_error` rule sees one problem per real crash.
 */
async function handlePOST(req: NextRequest) {
  const a = await getActor(req);
  if ("response" in a) return a.response;

  let body: BrowserErrorReport;
  try {
    body = (await req.json()) as BrowserErrorReport;
  } catch {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  if (isNoise(body)) return new NextResponse(null, { status: 204 });

  const name = (body.name || "Error").slice(0, 30);
  const message = String(body.message).slice(0, 500);
  const page = typeof body.page === "string" ? body.page : "/";
  const route = normalisePage(page);

  await recordAppError({
    source: "browser",
    route,
    method: "BROWSER",
    status: 0,
    errorCode: `${name}:${shortHash(route + "|" + message)}`,
    message,
    actorId: a.actor.id,
    page,
    cause: { kind: "code", code: name, detail: message, target: firstFrame(body.stack) },
  });
  return new NextResponse(null, { status: 204 });
}

export const POST = withRouteErrors("/api/journal/browser-error", "POST", handlePOST);
