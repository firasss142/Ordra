import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(_req: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    await supabase
      .from("users")
      .update({ last_seen_at: null })
      .eq("id", user.id);
  }

  const { error } = await supabase.auth.signOut();
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  const res = NextResponse.json({ success: true });
  res.cookies.set("oms_profile", "", { maxAge: 0, path: "/" });
  return res;
}
