import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";

/**
 * Cookie-based server client — for Server Components, Route Handlers, middleware.
 * Uses ANON key + user's session cookie. Safe to use in any server context.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — cookies cannot be mutated.
            // The middleware handles session refresh.
          }
        },
      },
    },
  );
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface AdminClientOptions {
  /**
   * The signed-in user this service-role client writes FOR. Sent as the
   * `x-ordra-actor` header, which `journal_actor()` reads so that audit_events
   * names the person instead of « service ». Only a uuid is forwarded.
   */
  actorId?: string | null;
}

/**
 * Service-role admin client — for webhooks and server-side admin operations ONLY.
 * NEVER expose this to the browser. NEVER import from client components.
 */
export function createAdminClient(options: AdminClientOptions = {}) {
  const actorId = options.actorId && UUID_RE.test(options.actorId) ? options.actorId : null;
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      ...(actorId ? { global: { headers: { "x-ordra-actor": actorId } } } : {}),
    },
  );
}
