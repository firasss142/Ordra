import { NextRequest, NextResponse } from "next/server";
import { getActor } from "@/lib/auth/actor";
import { canManageCarriers } from "@/lib/settings-permissions";
import { listAdapterDescriptors } from "@/lib/carriers/adapter-registry";

export async function GET(req: NextRequest) {
  const actorResult = await getActor(req);
  if ("response" in actorResult) return actorResult.response;
  const { actor } = actorResult;

  if (!canManageCarriers(actor.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  return NextResponse.json({ data: listAdapterDescriptors() });
}
