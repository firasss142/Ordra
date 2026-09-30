import { describe, it, expect, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import { handleWebhookEvents, type HandleContext } from "../handle";
import { parseWebhookPayload } from "../parse";
import * as fx from "./fixtures";
import type { WhatsAppConfig } from "../../config";

/**
 * The handler against an in-memory DB. What matters: statuses land on the
 * right row and never throw on the unknown ones; an inbound message finds
 * its customer, its order (or lead, or nothing), notifies the owning agent
 * once, and a STOP sets every brake at once.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-09-25T12:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();

const CFG: WhatsAppConfig = {
  id: "cfg-tn",
  marketId: TN,
  wabaId: fx.WABA,
  phoneNumberId: fx.PNID,
  appId: "777",
  graphVersion: "v26.0",
  accessToken: "EAA",
  appSecret: "secret",
  verifyToken: "verify",
  displayPhone: null,
  verifiedName: null,
  qualityRating: null,
  messagingLimitTier: null,
  status: "active",
  statusReason: null,
  sendRatePerSec: 3,
  lastWebhookAt: null,
  decryptFailed: false,
};

let fake: FakeSupabase;
let ctx: HandleContext;
const events = (payload: unknown) => parseWebhookPayload(payload).events;

beforeEach(() => {
  fake = makeFakeSupabase({
    whatsapp_configs: [{ id: "cfg-tn", market_id: TN, phone_number_id: fx.PNID, waba_id: fx.WABA, last_webhook_at: null }],
    customers: [{ id: "cust-1", market_id: TN, phone_normalized: "98765432", whatsapp_opted_out_at: null }],
    orders: [
      { id: "o-old", market_id: TN, customer_id: "cust-1", status: "delivered", assigned_to: "ag-0", created_at: daysAgo(40), updated_at: daysAgo(30) },
      { id: "o-1", market_id: TN, customer_id: "cust-1", status: "dispatched", assigned_to: "ag-1", created_at: daysAgo(2), updated_at: daysAgo(1) },
    ],
    leads: [],
    whatsapp_conversations: [{ id: "conv-1", market_id: TN, phone_e164: "21698765432", customer_id: "cust-1", current_order_id: null, current_lead_id: null, unread_count: 0, last_inbound_at: null }],
    whatsapp_messages: [
      { id: "m-out", market_id: TN, conversation_id: "conv-1", direction: "out", wamid: "wamid.OUT1", phone_e164: "21698765432", customer_id: "cust-1", order_id: "o-1", status: "sent", sent_at: daysAgo(0.1) },
    ],
    whatsapp_templates: [
      { id: "t-1", market_id: TN, meta_template_id: "tpl-meta-1", name: "ordra_shipped_v1", language: "fr", status: "PENDING", campaign_id: null },
      { id: "t-2", market_id: TN, meta_template_id: null, name: "ordra_camp_x", language: "ar", status: "PENDING", campaign_id: "camp-1" },
    ],
    prospect_campaigns: [{ id: "camp-1", wa_launch_status: "pending_template" }],
    agent_notifications: [],
    whatsapp_outbox: [{ id: "ob-1", phone_e164: "21698765432", status: "queued", skip_reason: null }],
  });
  ctx = {
    admin: fake.client,
    configsByPhone: new Map([[fx.PNID, CFG]]),
    configsByWaba: new Map([[fx.WABA, CFG]]),
    now: () => NOW,
    sleep: async () => undefined,
  };
});

const msg = (wamid = "wamid.OUT1") => fake.tables.whatsapp_messages.find((m) => m.wamid === wamid)!;
const conv = () => fake.tables.whatsapp_conversations.find((c) => c.id === "conv-1")!;

describe("statuses", () => {
  it("applies delivered and read to the row by wamid, with timestamps", async () => {
    await handleWebhookEvents(events(fx.statusEvent("delivered", { timestamp: "1758800400" })), ctx);
    expect(msg().status).toBe("delivered");
    expect(msg().delivered_at).toBe(new Date(1758800400 * 1000).toISOString());
    await handleWebhookEvents(events(fx.statusEvent("read", { timestamp: "1758800500" })), ctx);
    expect(msg().status).toBe("read");
    expect(msg().read_at).toBe(new Date(1758800500 * 1000).toISOString());
  });

  it("stores pricing and conversation facts from the sent status", async () => {
    await handleWebhookEvents(events(fx.statusEvent("sent")), ctx);
    expect(msg()).toMatchObject({ pricing_category: "utility", pricing_billable: true, pricing_model: "PMP", conversation_meta_id: "conv-meta-1", conversation_origin: "utility" });
  });

  it("failed with 131026 marks the message, the conversation and the customer undeliverable", async () => {
    const r = await handleWebhookEvents(events(fx.failed131026), ctx);
    expect(r.errors).toEqual([]);
    expect(msg()).toMatchObject({ status: "failed", error_code: 131026, error_title: "Message undeliverable" });
    expect(conv().undeliverable_at).toBeTruthy();
    expect(fake.tables.customers[0].whatsapp_undeliverable_at).toBeTruthy();
  });

  it("an unknown wamid is retried once, then ignored without error", async () => {
    let slept = 0;
    ctx.sleep = async () => {
      slept++;
    };
    const r = await handleWebhookEvents(events(fx.statusEvent("delivered", { id: "wamid.NOPE" })), ctx);
    expect(slept).toBe(1);
    expect(r.ignored).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it("stamps last_webhook_at on the config", async () => {
    await handleWebhookEvents(events(fx.statusEvent("delivered")), ctx);
    expect(fake.tables.whatsapp_configs[0].last_webhook_at).toBe(NOW.toISOString());
  });
});

describe("inbound messages", () => {
  it("links the customer, attributes to the live order, inserts the row and notifies the assigned agent", async () => {
    const r = await handleWebhookEvents(events(fx.textMessage({ body: "Oui c'est bon" })), ctx);
    expect(r.errors).toEqual([]);
    const m = msg("wamid.IN1");
    expect(m).toMatchObject({ direction: "in", kind: "text", body: "Oui c'est bon", status: "received", actor_type: "customer", customer_id: "cust-1", order_id: "o-1", conversation_id: "conv-1" });
    expect(conv()).toMatchObject({ current_order_id: "o-1", unread_count: 1, profile_name: "Amel", last_message_preview: "Oui c'est bon" });
    expect(conv().last_inbound_at).toBe(new Date(1758800000 * 1000).toISOString());
    expect(fake.tables.customers[0].whatsapp_last_inbound_at).toBeTruthy();
    expect(fake.tables.agent_notifications).toEqual([
      expect.objectContaining({ agent_id: "ag-1", order_id: "o-1", kind: "whatsapp_inbound" }),
    ]);
  });

  it("does not notify twice while the first notification is unread", async () => {
    await handleWebhookEvents(events(fx.textMessage({ id: "wamid.A" })), ctx);
    await handleWebhookEvents(events(fx.textMessage({ id: "wamid.B" })), ctx);
    expect(fake.tables.agent_notifications).toHaveLength(1);
    expect(conv().unread_count).toBe(2);
  });

  it("ignores a duplicate wamid", async () => {
    await handleWebhookEvents(events(fx.textMessage()), ctx);
    const r = await handleWebhookEvents(events(fx.textMessage()), ctx);
    expect(r.ignored).toBe(1);
    expect(fake.tables.whatsapp_messages.filter((m) => m.wamid === "wamid.IN1")).toHaveLength(1);
    expect(conv().unread_count).toBe(1);
  });

  it("prefers a terminal order closed within 7 days over an orphan, but not an old one", async () => {
    fake.tables.orders = [{ id: "o-recent", market_id: TN, customer_id: "cust-1", status: "delivered", assigned_to: "ag-2", created_at: daysAgo(6), updated_at: daysAgo(3) }];
    await handleWebhookEvents(events(fx.textMessage()), ctx);
    expect(msg("wamid.IN1").order_id).toBe("o-recent");

    fake.tables.orders = [{ id: "o-stale", market_id: TN, customer_id: "cust-1", status: "delivered", assigned_to: "ag-2", created_at: daysAgo(40), updated_at: daysAgo(30) }];
    conv().current_order_id = null;
    await handleWebhookEvents(events(fx.textMessage({ id: "wamid.IN9" })), ctx);
    expect(msg("wamid.IN9").order_id).toBeNull();
  });

  it("falls back to the phone's open lead, then to an orphan", async () => {
    fake.tables.orders = [];
    fake.tables.leads = [
      { id: "l-lost", market_id: TN, customer_phone: "98765432", status: "lost", assigned_to: "ag-3", created_at: daysAgo(3) },
      { id: "l-open", market_id: TN, customer_phone: "0021698765432", status: "assigned", assigned_to: "ag-3", created_at: daysAgo(1) },
    ];
    await handleWebhookEvents(events(fx.textMessage()), ctx);
    expect(msg("wamid.IN1")).toMatchObject({ order_id: null, lead_id: "l-open" });
    expect(conv().current_lead_id).toBe("l-open");
    // No order → no agent_notifications row (order_id is NOT NULL there).
    expect(fake.tables.agent_notifications).toHaveLength(0);

    fake.tables.leads = [];
    conv().current_lead_id = null;
    await handleWebhookEvents(events(fx.textMessage({ id: "wamid.IN2" })), ctx);
    expect(msg("wamid.IN2")).toMatchObject({ order_id: null, lead_id: null });
  });

  it("creates the conversation and the customer link for a first-time number", async () => {
    fake.tables.whatsapp_conversations = [];
    await handleWebhookEvents(events(fx.textMessage()), ctx);
    const c = fake.tables.whatsapp_conversations[0];
    expect(c).toMatchObject({ market_id: TN, phone_e164: "21698765432", customer_id: "cust-1", current_order_id: "o-1", unread_count: 1 });
    expect(msg("wamid.IN1").conversation_id).toBe(c.id);
  });

  it("STOP sets the opt-out on the conversation and the customer, and skips queued outbox rows", async () => {
    const r = await handleWebhookEvents(events(fx.textMessage({ body: "STOP", id: "wamid.STOP" })), ctx);
    expect(r.errors).toEqual([]);
    expect(conv().opted_out_at).toBeTruthy();
    expect(conv().opt_out_text).toBe("STOP");
    expect(fake.tables.customers[0].whatsapp_opted_out_at).toBeTruthy();
    expect(fake.tables.whatsapp_outbox[0]).toMatchObject({ status: "skipped", skip_reason: "opted_out" });
  });

  it("stores a media message with its media id and no body, and an unsupported one as such", async () => {
    await handleWebhookEvents(events(fx.imageMessage), ctx);
    expect(msg("wamid.IMG1")).toMatchObject({ kind: "image", media_id: "media-9", media_mime: "image/jpeg", media_caption: "voilà", context_wamid: "wamid.OUT1", body: null });
    expect(conv().last_message_preview).toBe("📷 voilà");
    await handleWebhookEvents(events(fx.unsupportedMessage), ctx);
    expect(msg("wamid.UNS1")).toMatchObject({ kind: "unsupported" });
  });

  it("ignores a message from a number of the other market or from abroad", async () => {
    const r = await handleWebhookEvents(events(fx.textMessage({ from: "218916063026", id: "wamid.LY" })), ctx);
    expect(r.ignored).toBe(1);
    const r2 = await handleWebhookEvents(events(fx.textMessage({ from: "33612345678", id: "wamid.FR" })), ctx);
    expect(r2.ignored).toBe(1);
    expect(fake.tables.whatsapp_messages.filter((m) => m.direction === "in")).toHaveLength(0);
  });

  it("ignores traffic for a phone number id with no config", async () => {
    ctx.configsByPhone = new Map();
    ctx.configsByWaba = new Map();
    const r = await handleWebhookEvents(events(fx.textMessage()), ctx);
    expect(r.ignored).toBe(1);
  });
});

describe("template and account events", () => {
  it("flips a template by meta id and records the rejection reason", async () => {
    await handleWebhookEvents(events(fx.templateStatus("REJECTED", { reason: "INVALID_FORMAT" })), ctx);
    expect(fake.tables.whatsapp_templates[0]).toMatchObject({ status: "REJECTED", rejected_reason: "INVALID_FORMAT" });
  });

  it("matches by (market, name, language) when the meta id is unknown, fills it in, and flips the campaign", async () => {
    await handleWebhookEvents(events(fx.templateStatus("APPROVED", { id: "tpl-meta-2", name: "ordra_camp_x", language: "ar" })), ctx);
    expect(fake.tables.whatsapp_templates[1]).toMatchObject({ status: "APPROVED", meta_template_id: "tpl-meta-2", rejected_reason: null });
    expect(fake.tables.prospect_campaigns[0].wa_launch_status).toBe("ready");
  });

  it("a rejected campaign template flips the campaign to rejected", async () => {
    await handleWebhookEvents(events(fx.templateStatus("REJECTED", { id: "tpl-meta-2", name: "ordra_camp_x", language: "ar", reason: "ABUSIVE_CONTENT" })), ctx);
    expect(fake.tables.prospect_campaigns[0].wa_launch_status).toBe("rejected");
  });

  it("an unknown template is ignored, not an error", async () => {
    const r = await handleWebhookEvents(events(fx.templateStatus("APPROVED", { id: "zzz", name: "nope", language: "fr" })), ctx);
    expect(r.ignored).toBe(1);
    expect(r.errors).toEqual([]);
  });

  it("a quality update moves the tier and a FLAGGED one notes it without pausing", async () => {
    await handleWebhookEvents(events(fx.qualityUpdate("UPGRADE", "TIER_10K")), ctx);
    expect(fake.tables.whatsapp_configs[0].messaging_limit_tier).toBe("TIER_10K");
    await handleWebhookEvents(events(fx.qualityUpdate("FLAGGED", "TIER_10K")), ctx);
    expect(fake.tables.whatsapp_configs[0].quality_rating).toBe("RED");
    expect(fake.tables.whatsapp_configs[0].status).toBeUndefined();
  });

  it("a disabling account update pauses the config with the reason", async () => {
    await handleWebhookEvents(events(fx.accountUpdate("DISABLED_UPDATE")), ctx);
    expect(fake.tables.whatsapp_configs[0]).toMatchObject({ status: "paused" });
    expect(String(fake.tables.whatsapp_configs[0].status_reason)).toMatch(/DISABLED_UPDATE/);
  });

  it("an unknown field is ignored and a throwing event does not stop the batch", async () => {
    fake.failNext("whatsapp_messages", { message: "boom" });
    const r = await handleWebhookEvents(events(fx.mixed), ctx);
    // status (failed by the forced error) → error; message → processed; unknown → ignored
    expect(r.errors).toHaveLength(1);
    expect(r.processed).toBe(1);
    expect(r.ignored).toBe(1);
  });
});
