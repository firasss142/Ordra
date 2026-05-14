import { NextRequest, NextResponse } from "next/server";

/**
 * STUB — Meta (Facebook / Instagram) webhook endpoint for inbound leads.
 *
 * Not yet implemented. Returns 501 so external senders get a clear signal
 * rather than a silent failure. Route path is reserved so the schema
 * (lead_sources: facebook_comment, facebook_dm, instagram_dm) can be
 * populated as soon as the adapter ships.
 *
 * Planned shape:
 *   POST /api/webhooks/meta/[sourceId]
 *     body: Meta webhook event payload
 *     flow: validateWebhook (HMAC) → parseEventType → mapToInternalLead
 *           → idempotency check against (source_platform, source_external_id)
 *           → INSERT lead + history → tryAutoAssignLead()
 */

export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ sourceId: string }> }
) {
  const { sourceId } = await params;
  return NextResponse.json(
    {
      error: "Meta webhook adapter not yet implemented",
      sourceId,
    },
    { status: 501 }
  );
}

// GET is used by Meta for webhook subscription verification (hub.challenge).
// Return 501 for now — when implemented, this will echo hub.challenge.
export async function GET() {
  return NextResponse.json(
    { error: "Meta webhook adapter not yet implemented" },
    { status: 501 }
  );
}
