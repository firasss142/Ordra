import { NextRequest, NextResponse } from "next/server";
import { investorActor, INVESTOR_CACHE } from "@/lib/investors/investor-route";

export const dynamic = "force-dynamic";

/** Full statement incl. the day rows in `snapshot`. */
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const g = await investorActor(req);
  if ("response" in g) return g.response;
  const { data, error } = await g.admin
    .from("investor_deal_statements")
    .select("*, investor_deals!investor_deal_statements_deal_id_fkey(label, products(name, image_url))")
    .eq("id", params.id)
    .eq("investor_id", g.actor.id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ data }, { headers: INVESTOR_CACHE });
}
