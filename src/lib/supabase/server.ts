import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { capturingFetch } from "@/lib/journal/request-context";

/**
 * Both server clients fetch through this: a PostgREST error is noted as the
 * request's cause, so Journaux can say WHY a route answered 500 (the route
 * itself usually says only « Internal server error »). Resolved per call so
 * Next's patched fetch is still the one used.
 */
const journalFetch = capturingFetch((input, init) => fetch(input, init));

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
      global: { fetch: journalFetch },
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
      global: {
        fetch: journalFetch,
        ...(actorId ? { headers: { "x-ordra-actor": actorId } } : {}),
      },
    },
  );
}
