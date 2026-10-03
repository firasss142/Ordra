import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { SWRConfig } from "swr";
import { vi } from "vitest";
import type { ReactNode } from "react";
import { ToastProvider } from "@/components/ui/Toast";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";
import type { UserAuditEvent, UserWithStats } from "@/types";
import { BENGHAZI, LY, TN, TRIPOLI } from "./accessUsers";

/**
 * The Accès page against a fake of the five routes it calls — GET /api/users,
 * GET /api/warehouse/sites, GET /api/admin/audit-log, PATCH|DELETE
 * /api/agents/:id and POST /api/users — with the real intl, toast and SWR
 * providers, so plurals, toasts and revalidation behave as in the app.
 */

export interface ApiCall {
  method: string;
  url: string;
  body: Record<string, unknown> | null;
}

export interface FakeApi {
  calls: ApiCall[];
  /** Answer the next write to this path with an error status. */
  failNext: (path: string, status?: number, error?: string) => void;
  users: UserWithStats[];
}

const SITES: Record<string, { id: string; code: string; name: string; isDefault: boolean; marketId: string }[]> = {
  [LY]: [
    { id: TRIPOLI, code: "tripoli", name: "Tripoli", isDefault: true, marketId: LY },
    { id: BENGHAZI, code: "benghazi", name: "Benghazi", isDefault: false, marketId: LY },
  ],
  [TN]: [{ id: "site-tunis", code: "tunis", name: "Tunis", isDefault: true, marketId: TN }],
};

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

export function installFakeApi(users: UserWithStats[], audit: Record<string, UserAuditEvent[]> = {}): FakeApi {
  const api: FakeApi = { calls: [], users: users.map((u) => ({ ...u })), failNext: () => {} };
  const failures = new Map<string, { status: number; error: string }>();
  api.failNext = (path, status = 500, error = "boom") => failures.set(path, { status, error });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : null;
      const path = url.split("?")[0];
      const params = new URLSearchParams(url.split("?")[1] ?? "");
      if (method !== "GET") api.calls.push({ method, url, body });

      const failure = method !== "GET" ? failures.get(path) : undefined;
      if (failure) {
        failures.delete(path);
        return json({ error: failure.error }, failure.status);
      }

      if (path === "/api/users" && method === "GET") return json({ data: api.users });
      if (path === "/api/users" && method === "POST") {
        const slug = String(body?.username).trim().toLowerCase().replace(/\s+/g, ".");
        const created: UserWithStats = {
          id: `u-new-${slug}`,
          email: `${slug}@oms.local`,
          full_name: String(body?.username).trim(),
          avatar_url: null,
          role: body?.role as UserWithStats["role"],
          market_id: (body?.market_id as string) ?? LY,
          warehouse_id: (body?.warehouse_id as string) ?? null,
          is_active: true,
          invitation_sent_at: null,
          invitation_accepted_at: null,
          deactivation_reason: null,
          last_seen_at: null,
          created_at: "2026-10-03T13:30:00Z",
        };
        api.users = [created, ...api.users];
        return json({ data: created }, 201);
      }
      if (path === "/api/warehouse/sites") return json({ sites: SITES[params.get("market_id") ?? ""] ?? [], mine: null, pinned: false, unassigned: false });
      if (path === "/api/admin/audit-log") return json({ data: audit[params.get("target_id") ?? ""] ?? [] });

      const agent = path.match(/^\/api\/agents\/([^/]+)$/);
      if (agent) {
        const id = decodeURIComponent(agent[1]);
        const u = api.users.find((x) => x.id === id);
        if (!u) return json({ error: "Not found" }, 404);
        if (method === "DELETE") {
          api.users = api.users.filter((x) => x.id !== id);
          return json({ ordersReturned: 2 });
        }
        const action = body?.action;
        if (action === "deactivate") Object.assign(u, { is_active: false, deactivation_reason: body?.reason });
        if (action === "reactivate") Object.assign(u, { is_active: true, deactivation_reason: null });
        if (action === "set_warehouse") Object.assign(u, { warehouse_id: body?.warehouse_id ?? null });
        return json({ ok: true, ordersReturned: action === "deactivate" ? 3 : 0 });
      }
      return json({ error: `unhandled ${method} ${url}` }, 404);
    }),
  );
  return api;
}

export function renderAccess(ui: ReactNode, { locale = "fr" }: { locale?: "fr" | "ar" } = {}) {
  return render(
    <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>
      <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages} timeZone="Africa/Tripoli">
        <ToastProvider>{ui}</ToastProvider>
      </NextIntlClientProvider>
    </SWRConfig>,
  );
}
