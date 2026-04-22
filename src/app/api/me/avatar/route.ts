import { NextRequest, NextResponse } from "next/server";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { uploadAvatarDataUrl } from "@/lib/avatars";

export async function PUT(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const avatar = body.avatar as string | null | undefined;

  let avatarUrl: string | null = null;
  if (avatar) {
    const upload = await uploadAvatarDataUrl(user.id, avatar);
    if (!upload.ok) {
      return NextResponse.json({ error: upload.error }, { status: upload.status });
    }
    avatarUrl = upload.url;
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("users")
    .update({ avatar_url: avatarUrl })
    .eq("id", user.id);

  if (error) {
    console.error("[PUT /api/me/avatar] update error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }

  return NextResponse.json({ avatar_url: avatarUrl });
}
