import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getActor } from "@/lib/auth/actor";
import {
  STATUS_KEY_REGEX,
  STATUS_SCOPES,
  type StatusScope,
} from "@/types/status-config";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  const url = new URL(req.url);
  const queryMarketId = url.searchParams.get("market_id");
  const scope = url.searchParams.get("scope");

  let targetMarketId: string;
  if (actor.role === "super_admin") {
    if (!queryMarketId) {
      return NextResponse.json(
        { error: "market_id is required for super_admin" },
        { status: 400 }
      );
    }
    targetMarketId = queryMarketId;
  } else {
    if (!actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (queryMarketId && queryMarketId !== actor.market_id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    targetMarketId = actor.market_id;
  }

  if (scope && !STATUS_SCOPES.includes(scope as StatusScope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  const supabase = await createClient();
  let q = supabase
    .from("status_configs")
    .select("*")
    .eq("market_id", targetMarketId);
  if (scope) q = q.eq("scope", scope);

  const { data, error } = await q.order("sort_order", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ data: data ?? [] });
}

interface CreateBody {
  market_id?: string;
  scope?: string;
  key?: string;
  label_fr?: string;
  label_ar?: string;
  color?: string;
  sort_order?: number;
  is_initial?: boolean;
  is_terminal?: boolean;
  allowed_transitions?: string[];
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

  const {
    market_id,
    scope,
    key,
    label_fr,
    label_ar,
    color,
    sort_order,
    is_initial,
    is_terminal,
    allowed_transitions,
  } = body;

  if (!market_id || !scope || !key || !label_fr || !label_ar) {
    return NextResponse.json(
      {
        error:
          "market_id, scope, key, label_fr, label_ar are required",
      },
      { status: 400 }
    );
  }
  if (typeof sort_order !== "number") {
    return NextResponse.json(
      { error: "sort_order must be a number" },
      { status: 400 }
    );
  }

  if (
    actor.role === "market_manager" &&
    market_id !== actor.market_id
  ) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!STATUS_SCOPES.includes(scope as StatusScope)) {
    return NextResponse.json({ error: "Invalid scope" }, { status: 400 });
  }

  if (!STATUS_KEY_REGEX.test(key)) {
    return NextResponse.json(
      {
        error:
          "Invalid key: must match /^[a-z][a-z0-9_]*$/ (lowercase letter start, alphanumerics + underscores)",
      },
      { status: 400 }
    );
  }

  if (allowed_transitions !== undefined) {
    if (
      !Array.isArray(allowed_transitions) ||
      !allowed_transitions.every((k) => typeof k === "string")
    ) {
      return NextResponse.json(
        { error: "allowed_transitions must be an array of strings" },
        { status: 400 }
      );
    }
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("status_configs")
    .insert({
      market_id,
      scope,
      key,
      label_fr,
      label_ar,
      color: color ?? "#64748B",
      sort_order,
      is_initial: is_initial ?? false,
      is_terminal: is_terminal ?? false,
      allowed_transitions: allowed_transitions ?? [],
    })
    .select()
    .single();

  if (error) {
    const status = /duplicate key|unique/i.test(error.message) ? 409 : 400;
    return NextResponse.json({ error: error.message }, { status });
  }

  return NextResponse.json({ data }, { status: 201 });
}
