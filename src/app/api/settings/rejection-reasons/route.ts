import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import { REJECTION_KEY_REGEX } from "@/types/rejection-config";

export const dynamic = "force-dynamic";

/**
 * The market's rejection taxonomy.
 *
 * GET is readable by every role in the market — the agent's rejection picker is
 * built from exactly the rows the manager edits here, so there is only ever one
 * list.
 *
 * POST creates SUB-REASONS only. A group's key is a value of the
 * `rejection_reason` Postgres enum and 1,800 orders carry one; an enum cannot
 * grow from a form, and it certainly cannot shrink. Groups are seeded by
 * migration and edited (label, colour, order) through PATCH.
 */

function resolveMarket(
  actor: { role: string; market_id: string | null },
  queryMarketId: string | null,
): { marketId: string } | { error: NextResponse } {
  if (actor.role === "super_admin") {
    if (!queryMarketId) {
      return {
        error: NextResponse.json(
          { error: "market_id is required for super_admin" },
          { status: 400 },
        ),
      };
    }
    return { marketId: queryMarketId };
  }

  if (!actor.market_id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  if (queryMarketId && queryMarketId !== actor.market_id) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { marketId: actor.market_id };
}

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const url = new URL(req.url);
  const resolved = resolveMarket(actor, url.searchParams.get("market_id"));
  if ("error" in resolved) return resolved.error;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("rejection_reason_configs")
    .select("*")
    .eq("market_id", resolved.marketId)
    .order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

interface CreateBody {
  market_id?: string;
  parent_key?: string | null;
  key?: string;
  label_fr?: string;
  label_ar?: string;
  short_fr?: string;
  short_ar?: string;
  sort_order?: number;
}

export async function POST(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (actor.role !== "super_admin" && actor.role !== "market_manager") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: CreateBody;
  try {
    body = (await req.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { market_id, parent_key, key, label_fr, label_ar, short_fr, short_ar } =
    body;

  if (!market_id) {
    return NextResponse.json({ error: "market_id is required" }, { status: 400 });
  }
  if (actor.role === "market_manager" && market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Checked before the field validation so the message names the real problem:
  // someone trying to add a sixth group gets told groups are fixed, not that
  // they forgot a label.
  if (!parent_key) {
    return NextResponse.json(
      {
        error:
          "Cannot create a rejection group: groups mirror the rejection_reason Postgres enum and are fixed. Create a sub-reason by naming its parent_key.",
      },
      { status: 409 },
    );
  }

  if (!key || !REJECTION_KEY_REGEX.test(key)) {
    return NextResponse.json(
      {
        error:
          "Invalid key: must match /^[a-z][a-z0-9_]*$/ (lowercase letter start, alphanumerics and underscores)",
      },
      { status: 400 },
    );
  }

  if (!label_fr || !label_ar || !short_fr || !short_ar) {
    return NextResponse.json(
      {
        error:
          "label_fr, label_ar, short_fr and short_ar are all required — the long label is for the agent's picker, the short one for the status badge",
      },
      { status: 400 },
    );
  }

  const supabase = await createClient();

  // The parent has to exist *in this market*: taxonomies diverge, and a
  // sub-reason hung off a group Libya does not have would be unpickable.
  const { data: parent } = await supabase
    .from("rejection_reason_configs")
    .select("key")
    .eq("market_id", market_id)
    .eq("key", parent_key)
    .is("parent_key", null)
    .single();

  if (!parent) {
    return NextResponse.json(
      { error: `Unknown rejection group "${parent_key}" in this market` },
      { status: 404 },
    );
  }

  const { data, error } = await supabase
    .from("rejection_reason_configs")
    .insert({
      market_id,
      parent_key,
      key,
      label_fr,
      label_ar,
      short_fr,
      short_ar,
      sort_order: typeof body.sort_order === "number" ? body.sort_order : 0,
      is_active: true,
      // No `hue`: colour is not configurable at any level. A rejection wears
      // the rejected red, and its group's icon says which kind it was.
    })
    .select()
    .single();

  if (error) {
    const status = /duplicate key|unique/i.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ data }, { status: 201 });
}
