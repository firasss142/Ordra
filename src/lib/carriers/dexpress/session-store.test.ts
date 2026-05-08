import { describe, test, expect, vi, beforeEach } from "vitest";

interface SessionRow {
  carrier_id: string;
  laravel_session: string;
  xsrf_token: string | null;
  csrf_token: string | null;
  expires_at: string;
}

let storage: Map<string, SessionRow>;

const adminClientMock = {
  from: (table: string) => {
    if (table !== "dexpress_sessions") {
      throw new Error(`unexpected table: ${table}`);
    }
    return {
      select: () => ({
        eq: (_col: string, value: string) => ({
          maybeSingle: async () => ({
            data: storage.get(value) ?? null,
            error: null,
          }),
        }),
      }),
      upsert: async (row: SessionRow) => {
        storage.set(row.carrier_id, row);
        return { error: null };
      },
      delete: () => ({
        eq: async (_col: string, value: string) => {
          storage.delete(value);
          return { error: null };
        },
      }),
      update: (patch: Partial<SessionRow>) => ({
        eq: async (_col: string, value: string) => {
          const existing = storage.get(value);
          if (existing) storage.set(value, { ...existing, ...patch });
          return { error: null };
        },
      }),
    };
  },
};

vi.mock("@/lib/supabase/server", () => ({
  createAdminClient: () => adminClientMock,
}));

import { loadSession, saveSession, invalidateSession, refreshExpiry } from "./session-store";

describe("session-store", () => {
  beforeEach(() => {
    storage = new Map();
  });

  test("loadSession returns null when no row exists", async () => {
    const result = await loadSession("c-1");
    expect(result).toBeNull();
  });

  test("saveSession then loadSession round-trips", async () => {
    const expiresAt = new Date("2026-05-08T12:00:00Z");
    await saveSession("c-1", {
      laravelSession: "cookie-value-1",
      xsrfToken: "xsrf-1",
      csrfToken: "csrf-1",
      expiresAt,
    });

    const loaded = await loadSession("c-1");
    expect(loaded).not.toBeNull();
    expect(loaded!.laravelSession).toBe("cookie-value-1");
    expect(loaded!.xsrfToken).toBe("xsrf-1");
    expect(loaded!.csrfToken).toBe("csrf-1");
    expect(loaded!.expiresAt).toBeInstanceOf(Date);
    expect(loaded!.expiresAt.toISOString()).toBe(expiresAt.toISOString());
  });

  test("saveSession overwrites an existing row (upsert)", async () => {
    await saveSession("c-1", {
      laravelSession: "old",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date("2026-05-08T12:00:00Z"),
    });
    await saveSession("c-1", {
      laravelSession: "new",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date("2026-05-08T14:00:00Z"),
    });

    const loaded = await loadSession("c-1");
    expect(loaded!.laravelSession).toBe("new");
  });

  test("invalidateSession removes the row", async () => {
    await saveSession("c-1", {
      laravelSession: "x",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date("2026-05-08T12:00:00Z"),
    });

    await invalidateSession("c-1");
    expect(await loadSession("c-1")).toBeNull();
  });

  test("invalidateSession is a no-op when no row exists", async () => {
    await expect(invalidateSession("c-nonexistent")).resolves.toBeUndefined();
  });

  test("refreshExpiry updates expires_at without changing the cookie", async () => {
    await saveSession("c-1", {
      laravelSession: "stable-cookie",
      xsrfToken: null,
      csrfToken: null,
      expiresAt: new Date("2026-05-08T12:00:00Z"),
    });

    const newExpiry = new Date("2026-05-08T16:00:00Z");
    await refreshExpiry("c-1", newExpiry);

    const loaded = await loadSession("c-1");
    expect(loaded!.laravelSession).toBe("stable-cookie");
    expect(loaded!.expiresAt.toISOString()).toBe(newExpiry.toISOString());
  });
});
