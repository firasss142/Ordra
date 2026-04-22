import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Fetch the notification — RLS ensures agent_id = auth.uid()
  const { data: notif, error } = await supabase
    .from("agent_notifications")
    .select("id, agent_id, read_at")
    .eq("id", id)
    .single();

  if (error || !notif) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Already read — no-op
  if (notif.read_at) {
    return NextResponse.json({ data: notif });
  }

  const { data: updated, error: updateError } = await supabase
    .from("agent_notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .single();

  if (updateError) {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ data: updated });
}
