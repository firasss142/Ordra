import { beforeEach, describe, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { resetTestActor, setTestActor } from "@/test/helpers/actorMock";
import { DEFAULT_MARKET_SETTINGS } from "@/types/settings";

let db: FakeSupabase;
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => db.client }));
vi.mock("@/lib/auth/actor", async () => {
  const { makeGetActor } = await import("@/test/helpers/actorMock");
  return { getActor: makeGetActor() };
});

import { PATCH } from "./route";

const TN = "00000000-0000-0000-0000-000000000001";
const patch = (over: Record<string, unknown>) =>
  PATCH(new NextRequest(new URL(`http://localhost:3000/api/settings/${TN}`), { method: "PATCH", body: JSON.stringify({ ...DEFAULT_MARKET_SETTINGS, ...over }) }), {
    params: Promise.resolve({ marketId: TN }),
  });
const saved = (key: string) => db.tables.settings.find((r) => r.key === key)?.value;

beforeEach(() => {
  resetTestActor();
  db = makeFakeSupabase({ settings: [{ market_id: TN, key: "whatsapp_lifecycle_enabled", value: { value: true } }] });
});

/**
 * Paramètres › WhatsApp is read-only for a market manager
 * (prototypes/whatsapp-manager-v1.html, role `manager`): turning automatic
 * customer messages on or off, and when they may leave, is a super_admin
 * decision. The screen disables the controls; the API must refuse too. The
 * settings screen saves the WHOLE object, so a manager saving another group
 * sends the WhatsApp keys unchanged — that must keep working.
 */
describe("PATCH /api/settings/[marketId] — WhatsApp keys", () => {
  test("a market manager changing a whatsapp_* value is refused, and nothing is written", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    const res = await patch({ whatsapp_lifecycle_enabled: false });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("whatsapp_settings_super_admin_only");
    expect(db.log.filter((l) => l.table === "settings" && l.op !== "select")).toEqual([]);
    expect(saved("whatsapp_lifecycle_enabled")).toEqual({ value: true });
  });

  test("a market manager saving another group (WhatsApp keys unchanged) goes through, and the WhatsApp rows are left alone", async () => {
    setTestActor({ role: "market_manager", market_id: TN });
    const res = await patch({ max_call_attempts: 4, whatsapp_lifecycle_enabled: true });
    expect(res.status).toBe(200);
    expect(saved("max_call_attempts")).toEqual({ value: 4 });
    expect(saved("whatsapp_lifecycle_enabled")).toEqual({ value: true });
    const upserted = db.log.filter((l) => l.table === "settings" && l.op === "upsert").flatMap((l) => (Array.isArray(l.payload) ? l.payload : [l.payload]));
    expect(upserted.some((r) => String((r as { key: string }).key).startsWith("whatsapp_"))).toBe(false);
  });

  test("a super_admin writes the WhatsApp settings", async () => {
    setTestActor({ role: "super_admin", market_id: null });
    const res = await patch({ whatsapp_lifecycle_enabled: false, whatsapp_send_window: "10-20" });
    expect(res.status).toBe(200);
    expect(saved("whatsapp_lifecycle_enabled")).toEqual({ value: false });
    expect(saved("whatsapp_send_window")).toEqual({ value: "10-20" });
  });
});
