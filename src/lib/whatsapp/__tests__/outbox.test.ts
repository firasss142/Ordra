import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeSupabase, type Row } from "@/test/helpers/fakeSupabase";

vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskCredential: () => "••••••••",
}));
const client = { sendTemplate: vi.fn() };
vi.mock("../client", () => ({ createWhatsAppClient: () => client }));

import { drainOutbox } from "../outbox";
import { WhatsAppApiError } from "../errors";

/**
 * The drain against the in-memory DB, with the claim RPC stubbed to do what
 * the SQL does (pick due queued rows, mark them sending, bump attempts).
 */
const TN = "00000000-0000-0000-0000-000000000001";
const LY = "00000000-0000-0000-0000-000000000002";
const NOW = new Date("2026-09-25T12:00:00Z");
const iso = (d: Date) => d.toISOString();
const ago = (ms: number) => iso(new Date(NOW.getTime() - ms));

const CFG = (market: string, over: Row = {}) => ({
  id: `cfg-${market}`, market_id: market, waba_id: "4", phone_number_id: `pn-${market}`, app_id: "7", graph_version: "v26.0",
  access_token: "enc:a", app_secret: "enc:b", verify_token: "enc:c", status: "active", send_rate_per_sec: 4, created_at: ago(1), ...over,
});
const TPL = (over: Row) => ({
  id: "t", market_id: TN, name: "ordra_shipped_v1", language: "fr", status: "APPROVED", event_key: "shipped", catalogue_key: "shipped",
  body_text: "Bonjour {{1}}, votre colis est en route avec {{2}}.\nN° de suivi : {{3}}.\nMontant à préparer : {{4}}.", header_format: null, variables: ["name", "carrier", "tracking", "amount"], ...over,
});
const ROW = (over: Row) => ({
  id: "ob-1", market_id: TN, kind: "lifecycle", dedupe_key: "lifecycle:o-1:shipped", phone_e164: "21698765432", customer_id: "cust-1", order_id: "o-1", lead_id: null, campaign_id: null,
  event_key: "shipped", language: "fr", payload: {}, status: "queued", attempts: 0, max_attempts: 6, next_attempt_at: ago(60_000), not_before: null, locked_at: null, run_id: null, ...over,
});

let fake: FakeSupabase;
let sleeps: number[];

function stubClaim() {
  fake.rpcs.whatsapp_outbox_claim = (args) => {
    const rows = fake.tables.whatsapp_outbox
      .filter((r) => r.status === "queued" && new Date(r.next_attempt_at as string) <= NOW && (!r.not_before || new Date(r.not_before as string) <= NOW))
      .sort((a, b) => String(a.next_attempt_at).localeCompare(String(b.next_attempt_at)))
      .slice(0, Number(args.p_limit ?? 120));
    for (const r of rows) {
      r.status = "sending";
      r.locked_at = iso(NOW);
      r.run_id = args.p_run_id;
      r.attempts = Number(r.attempts) + 1;
    }
    return rows.map((r) => ({ ...r }));
  };
}

const drain = (over: Partial<Parameters<typeof drainOutbox>[1]> = {}) =>
  drainOutbox(fake.client, { trigger: "cron", deadlineAt: NOW.getTime() + 45_000, now: () => NOW, sleep: async (ms) => { sleeps.push(ms); }, random: () => 0, ...over });

const ob = (id = "ob-1") => fake.tables.whatsapp_outbox.find((r) => r.id === id)!;

beforeEach(() => {
  vi.clearAllMocks();
  sleeps = [];
  fake = makeFakeSupabase({
    whatsapp_configs: [CFG(TN), CFG(LY)],
    whatsapp_outbox_runs: [],
    whatsapp_outbox: [ROW({})],
    whatsapp_templates: [TPL({})],
    orders: [{ id: "o-1", status: "dispatched", customer_name: "Amel", customer_address: "x", customer_city: "Sousse", product_name: "Sérum", total_price: 89, currency: "TND", tracking_number: "NX1", external_id: "TN-1", carrier_id: "car-1", assigned_agent_name: "Sami" }],
    carriers: [{ id: "car-1", name: "Navex" }],
    customers: [{ id: "cust-1", whatsapp_opted_out_at: null, whatsapp_undeliverable_at: null }],
    whatsapp_conversations: [],
    whatsapp_messages: [],
    settings: [],
    markets: [{ id: TN, language: "fr" }, { id: LY, language: "ar" }],
  });
  stubClaim();
  client.sendTemplate.mockResolvedValue({ wamid: "wamid.1", waId: "21698765432", messageStatus: "accepted" });
});

describe("drainOutbox — happy path", () => {
  it("claims, renders from the fresh order, sends, logs the message and links it back", async () => {
    const r = await drain();
    expect(r).toMatchObject({ status: "succeeded", claimed: 1, sent: 1, failed: 0, skipped: 0 });
    expect(client.sendTemplate).toHaveBeenCalledWith({ to: "21698765432", name: "ordra_shipped_v1", language: "fr", bodyParameters: ["Amel", "Navex", "NX1", "89 TND"], headerImageLink: null });
    const msg = fake.tables.whatsapp_messages[0];
    expect(msg).toMatchObject({ direction: "out", kind: "template", status: "sent", wamid: "wamid.1", outbox_id: "ob-1", event_key: "shipped", actor_type: "system", order_id: "o-1" });
    expect(ob()).toMatchObject({ status: "sent", message_id: msg.id });
    expect(fake.tables.whatsapp_conversations[0]).toMatchObject({ phone_e164: "21698765432", current_order_id: "o-1" });
    expect(fake.tables.customers[0].whatsapp_last_outbound_at).toBe(iso(NOW));
    const run = fake.tables.whatsapp_outbox_runs[0];
    expect(run).toMatchObject({ status: "succeeded", claimed: 1, sent: 1 });
    expect(run.finished_at).toBeTruthy();
  });

  it("paces rows of one market by the config's rate and runs markets in parallel", async () => {
    fake.tables.whatsapp_outbox.push(ROW({ id: "ob-2", dedupe_key: "k2", order_id: "o-1" }), ROW({ id: "ob-3", dedupe_key: "k3", order_id: "o-1" }));
    await drain();
    // 4 msg/s → 250 ms between rows, two gaps for three rows.
    expect(sleeps).toEqual([250, 250]);
  });

  it("skips_locked when another run is in flight", async () => {
    fake.failNext("whatsapp_outbox_runs", { message: "duplicate", code: "23505" });
    const r = await drain();
    expect(r.status).toBe("skipped_locked");
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("the reaper requeues a stale sending row and buries a poison row", async () => {
    fake.tables.whatsapp_outbox.push(
      ROW({ id: "stale", dedupe_key: "ks", status: "sending", locked_at: ago(10 * 60_000), run_id: "old" }),
      ROW({ id: "poison", dedupe_key: "kp", attempts: 6 }),
    );
    await drain();
    expect(ob("stale").status).toBe("sent"); // requeued, then sent in this very run
    expect(ob("poison")).toMatchObject({ status: "failed", last_error: "max_attempts" });
  });

  it("stops at the deadline and releases what it did not reach, without burning attempts", async () => {
    fake.tables.whatsapp_outbox.push(ROW({ id: "ob-2", dedupe_key: "k2" }));
    let calls = 0;
    const clock = () => (calls++ < 6 ? NOW : new Date(NOW.getTime() + 60_000));
    const r = await drain({ now: clock });
    expect(r.released).toBeGreaterThanOrEqual(1);
    const released = fake.tables.whatsapp_outbox.find((x) => x.status === "queued")!;
    expect(released.attempts).toBe(0);
    expect(released.run_id).toBeNull();
  });
});

describe("drainOutbox — refusals and templates", () => {
  it("skips an opted-out customer discovered at drain time", async () => {
    fake.tables.customers[0].whatsapp_opted_out_at = ago(1);
    const r = await drain();
    expect(r.skipped).toBe(1);
    expect(ob()).toMatchObject({ status: "skipped", skip_reason: "opted_out" });
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("a could_not_reach whose order got confirmed or cancelled is stale", async () => {
    fake.tables.whatsapp_outbox[0] = ROW({ event_key: "could_not_reach", dedupe_key: "lifecycle:o-1:could_not_reach" });
    fake.tables.orders[0].status = "confirmed";
    await drain();
    expect(ob()).toMatchObject({ status: "skipped", skip_reason: "stale" });
  });

  it("no mapping at all → skipped/no_template; a PENDING mapping → wait, not skip", async () => {
    fake.tables.whatsapp_templates = [];
    await drain();
    expect(ob()).toMatchObject({ status: "skipped", skip_reason: "no_template" });

    fake.tables.whatsapp_outbox = [ROW({ id: "ob-9", dedupe_key: "k9" })];
    fake.tables.whatsapp_templates = [TPL({ status: "PENDING" })];
    const r = await drain();
    expect(r.deferred).toBe(1);
    expect(ob("ob-9")).toMatchObject({ status: "queued", attempts: 0, last_error: "template_pending" });
    expect(new Date(ob("ob-9").next_attempt_at as string).getTime()).toBeGreaterThan(NOW.getTime());
  });

  it("falls back to the market's default language when the customer's has no approved template", async () => {
    fake.tables.whatsapp_outbox[0] = ROW({ language: "ar" });
    fake.tables.settings = [{ market_id: TN, key: "whatsapp_default_language", value: { value: "fr" } }];
    await drain();
    expect(client.sendTemplate.mock.calls[0][0].language).toBe("fr");
    expect(fake.tables.whatsapp_messages[0].language).toBe("fr");
  });

  it("defers rows of a paused market without touching Meta", async () => {
    fake.tables.whatsapp_configs[0].status = "paused";
    const r = await drain();
    expect(r.deferred).toBe(1);
    expect(ob()).toMatchObject({ status: "queued", attempts: 0 });
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });
});

describe("drainOutbox — Graph errors", () => {
  it("a throttle requeues with backoff and keeps the attempt", async () => {
    client.sendTemplate.mockRejectedValue(new WhatsAppApiError("Too many", { code: 4, httpStatus: 400 }));
    const r = await drain();
    expect(r).toMatchObject({ status: "succeeded", deferred: 1, failed: 0 });
    expect(ob()).toMatchObject({ status: "queued", attempts: 1, last_error_code: 4 });
    expect(ob().next_attempt_at).toBe(iso(new Date(NOW.getTime() + 30_000)));
    expect(fake.tables.whatsapp_messages).toHaveLength(0);
  });

  it("131026 skips the row, marks the number undeliverable, and logs a failed message", async () => {
    client.sendTemplate.mockRejectedValue(new WhatsAppApiError("Undeliverable", { code: 131026, httpStatus: 400 }));
    const r = await drain();
    expect(r.skipped).toBe(1);
    expect(ob()).toMatchObject({ status: "skipped", skip_reason: "undeliverable" });
    expect(fake.tables.customers[0].whatsapp_undeliverable_at).toBe(iso(NOW));
    expect(fake.tables.whatsapp_conversations[0].undeliverable_at).toBe(iso(NOW));
    expect(fake.tables.whatsapp_messages[0]).toMatchObject({ status: "failed", error_code: 131026 });
  });

  it("131049 skips as marketing_cap", async () => {
    client.sendTemplate.mockRejectedValue(new WhatsAppApiError("Cap", { code: 131049, httpStatus: 400 }));
    await drain();
    expect(ob()).toMatchObject({ status: "skipped", skip_reason: "marketing_cap" });
  });

  it("190 pauses the market as auth_failed, requeues the row and releases the rest of that market", async () => {
    fake.tables.whatsapp_outbox.push(ROW({ id: "ob-2", dedupe_key: "k2" }), ROW({ id: "ly-1", dedupe_key: "kly", market_id: LY, phone_e164: "218916063026", language: "ar" }));
    fake.tables.whatsapp_templates.push(TPL({ id: "t-ly", market_id: LY, language: "ar" }));
    client.sendTemplate.mockImplementation(async (input: { to: string }) => {
      if (input.to.startsWith("216")) throw new WhatsAppApiError("Invalid OAuth", { code: 190, httpStatus: 401 });
      return { wamid: "wamid.ly", waId: input.to, messageStatus: "accepted" };
    });
    const r = await drain();
    expect(fake.tables.whatsapp_configs[0]).toMatchObject({ status: "auth_failed" });
    expect(ob()).toMatchObject({ status: "queued", attempts: 0, last_error_code: 190 });
    expect(ob("ob-2")).toMatchObject({ status: "queued", attempts: 0 });
    // Libya was unaffected.
    expect(ob("ly-1").status).toBe("sent");
    expect(r.status).toBe("partial");
  });

  it("an invalid request fails the row for good with a failed message", async () => {
    client.sendTemplate.mockRejectedValue(new WhatsAppApiError("Bad param", { code: 100, httpStatus: 400 }));
    const r = await drain();
    expect(r).toMatchObject({ status: "partial", failed: 1 });
    expect(ob()).toMatchObject({ status: "failed", last_error_code: 100 });
    expect(fake.tables.whatsapp_messages[0]).toMatchObject({ status: "failed", error_code: 100 });
  });

  it("131000 retries, but only three times", async () => {
    client.sendTemplate.mockRejectedValue(new WhatsAppApiError("Unknown", { code: 131000, httpStatus: 500 }));
    fake.tables.whatsapp_outbox[0].attempts = 2; // becomes 3 at claim
    await drain();
    expect(ob().status).toBe("failed");
  });
});
