import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { canManageCarriers } from "@/lib/settings-permissions";
import { getActor } from "@/lib/auth/actor";
import {
  hasCarrierAdapter,
  getCarrierAdapter,
} from "@/lib/carriers/adapter-registry";
import type { CarrierOrderData, CarrierConfig } from "@/lib/carriers/types";

interface TestResponse {
  reachable: boolean;
  status?: number;
  error?: string;
  adapter?: {
    code: string;
    known: boolean;
    dryRun?: {
      payloadPreview: Record<string, string>;
    };
  };
}

const SAMPLE_ORDER: CarrierOrderData = {
  customer_name: "Test Client",
  customer_phone: "+216 00 000 000",
  customer_address: "Rue de Test 1",
  customer_city: "Tunis",
  customer_note: null,
  product_name: "Test Product",
  variant_label: null,
  quantity: 1,
  total_price: 0,
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const supabase = await createClient();

  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;
  const role = actor.role;

  if (!canManageCarriers(role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data: carrier } = await supabase
    .from("carriers")
    .select("id, market_id, code, api_endpoint")
    .eq("id", id)
    .single();

  if (!carrier) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (role !== "super_admin" && carrier.market_id !== actor.market_id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const mode =
    req.nextUrl.searchParams.get("mode") === "dry_run" ? "dry_run" : "reachability";

  const known = hasCarrierAdapter(carrier.code);
  const response: TestResponse = {
    reachable: false,
    adapter: { code: carrier.code, known },
  };

  if (mode === "dry_run") {
    if (!known) {
      return NextResponse.json(
        {
          ...response,
          error: "Adapter inconnu — dry-run non disponible",
        },
        { status: 200 }
      );
    }
    try {
      const adapter = getCarrierAdapter(carrier.code);
      const config: CarrierConfig = {
        code: carrier.code,
        apiEndpoint: carrier.api_endpoint ?? "",
        apiCredentials: {},
        deliveryFee: 0,
        returnFee: 0,
      };
      const payloadPreview = adapter.formatPayload(SAMPLE_ORDER, config);
      response.adapter!.dryRun = { payloadPreview };
      response.reachable = true;
      return NextResponse.json(response);
    } catch (e) {
      return NextResponse.json({
        ...response,
        error:
          e instanceof Error ? e.message : "Formatage du payload a échoué",
      });
    }
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(carrier.api_endpoint, {
      method: "HEAD",
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));
    return NextResponse.json({
      ...response,
      reachable: res.ok || res.status < 500,
      status: res.status,
    });
  } catch {
    return NextResponse.json({ ...response, reachable: false, error: "Connection failed" });
  }
}
