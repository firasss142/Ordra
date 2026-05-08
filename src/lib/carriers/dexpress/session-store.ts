import { createAdminClient } from "@/lib/supabase/server";

export interface DexpressSession {
  laravelSession: string;
  xsrfToken: string | null;
  csrfToken: string | null;
  expiresAt: Date;
}

interface Row {
  carrier_id: string;
  laravel_session: string;
  xsrf_token: string | null;
  csrf_token: string | null;
  expires_at: string;
}

export async function loadSession(carrierId: string): Promise<DexpressSession | null> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("dexpress_sessions")
    .select("carrier_id, laravel_session, xsrf_token, csrf_token, expires_at")
    .eq("carrier_id", carrierId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load Dexpress session: ${error.message}`);
  }
  if (!data) return null;

  const row = data as Row;
  return {
    laravelSession: row.laravel_session,
    xsrfToken: row.xsrf_token,
    csrfToken: row.csrf_token,
    expiresAt: new Date(row.expires_at),
  };
}

export async function saveSession(
  carrierId: string,
  session: DexpressSession
): Promise<void> {
  const admin = createAdminClient();
  const row: Row = {
    carrier_id: carrierId,
    laravel_session: session.laravelSession,
    xsrf_token: session.xsrfToken,
    csrf_token: session.csrfToken,
    expires_at: session.expiresAt.toISOString(),
  };
  const { error } = await admin.from("dexpress_sessions").upsert(row);
  if (error) {
    throw new Error(`Failed to save Dexpress session: ${error.message}`);
  }
}

export async function invalidateSession(carrierId: string): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("dexpress_sessions")
    .delete()
    .eq("carrier_id", carrierId);
  if (error) {
    throw new Error(`Failed to invalidate Dexpress session: ${error.message}`);
  }
}

export async function refreshExpiry(carrierId: string, until: Date): Promise<void> {
  const admin = createAdminClient();
  const { error } = await admin
    .from("dexpress_sessions")
    .update({ expires_at: until.toISOString() })
    .eq("carrier_id", carrierId);
  if (error) {
    throw new Error(`Failed to refresh Dexpress session expiry: ${error.message}`);
  }
}
