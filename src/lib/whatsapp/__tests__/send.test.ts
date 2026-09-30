import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";

vi.mock("@/lib/crypto", () => ({
  encrypt: (s: string) => `enc:${s}`,
  decrypt: (s: string) => s.replace(/^enc:/, ""),
  maskCredential: () => "••••••••",
}));
const client = { sendTemplate: vi.fn(), sendText: vi.fn(), sendImage: vi.fn() };
vi.mock("../client", () => ({ createWhatsAppClient: () => client }));

import { sendMessage, SendError } from "../send";
import { WhatsAppApiError } from "../errors";

/**
 * The synchronous agent path. Authorisation is proved with the USER client
 * (RLS decides visibility) before anything else happens; the message is
 * rendered server-side from the order; a Graph failure leaves a `failed` row
 * so the thread shows it; and the delivery ledger is written only when asked.
 */
const TN = "00000000-0000-0000-0000-000000000001";
const NOW = new Date("2026-09-25T12:00:00Z");
const CFG = { id: "cfg-tn", market_id: TN, waba_id: "444", phone_number_id: "111", app_id: "777", graph_version: "v26.0", access_token: "enc:EAA", app_secret: "enc:s", verify_token: "enc:v", status: "active", send_rate_per_sec: 3, created_at: "2026-09-25T00:00:00Z" };
const ORDER = {
  id: "o-1", market_id: TN, status: "dispatched", assigned_to: "ag-1", customer_id: "cust-1",
  customer_name: "Amel Ben Salah", customer_phone: "98 765 432", customer_phone_2: null, customer_address: "12 rue de Carthage", customer_city: "Sousse",
  product_name: "Sérum", total_price: 89, currency: "TND", tracking_number: "NX1", external_id: "TN-1042", carrier_id: "car-1",
};
const TPL = { id: "t-before-fr", market_id: TN, name: "ordra_before_delivery_v1", language: "fr", category: "UTILITY", status: "APPROVED", body_text: "Bonjour {{1}}, votre colis est en route avec {{2}}.\nMontant à préparer : {{3}}.\nPouvez-vous confirmer l'adresse et l'heure ?", header_format: null, variables: ["name", "carrier", "amount"], event_key: null, catalogue_key: "before_delivery", source: "catalogue" };
const SHARE = { id: "t-share-fr", market_id: TN, name: "ordra_product_share_v1", language: "fr", category: "MARKETING", status: "APPROVED", body_text: "Bonjour {{1}}, voici {{2}} à {{3}}.", header_format: "IMAGE", variables: ["name", "product", "amount"], event_key: null, catalogue_key: "product_share", source: "catalogue" };

let admin: FakeSupabase;
let user: FakeSupabase;
const actor = { id: "ag-1", role: "agent" as const, market_id: TN };
const rpcCalls: { name: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  rpcCalls.length = 0;
  admin = makeFakeSupabase({
    whatsapp_configs: [CFG],
    orders: [ORDER],
    customers: [{ id: "cust-1", market_id: TN, phone_normalized: "98765432", whatsapp_language: null, whatsapp_opted_out_at: null, whatsapp_undeliverable_at: null }],
    carriers: [{ id: "car-1", name: "Navex" }],
    whatsapp_templates: [TPL, SHARE],
    whatsapp_conversations: [],
    whatsapp_messages: [],
  });
  // The user client sees the order (RLS would hide it otherwise) and carries the RPCs.
  user = makeFakeSupabase({ orders: [ORDER] });
  user.rpcs.set_customer_whatsapp_language = (args) => {
    rpcCalls.push({ name: "set_customer_whatsapp_language", args });
    return null;
  };
  user.rpcs.record_delivery_action = (args) => {
    rpcCalls.push({ name: "record_delivery_action", args });
    return { id: "da-1" };
  };
  client.sendTemplate.mockResolvedValue({ wamid: "wamid.T1", waId: "21698765432", messageStatus: "accepted" });
  client.sendText.mockResolvedValue({ wamid: "wamid.X1", waId: "21698765432", messageStatus: "accepted" });
  client.sendImage.mockResolvedValue({ wamid: "wamid.I1", waId: "21698765432", messageStatus: "accepted" });
});

const send = (req: Record<string, unknown>) =>
  sendMessage({ admin: admin.client, user: user.client, actor, now: () => NOW }, { target: { order_id: "o-1" }, language: "fr", mode: "template", template_id: "t-before-fr", ...req } as never);

describe("sendMessage — template to an order", () => {
  it("renders from the order, sends, and records the row with the wamid", async () => {
    const msg = await send({});
    expect(client.sendTemplate).toHaveBeenCalledWith({
      to: "21698765432",
      name: "ordra_before_delivery_v1",
      language: "fr",
      bodyParameters: ["Amel", "Navex", "89 TND"],
      headerImageLink: null,
    });
    expect(msg).toMatchObject({ direction: "out", kind: "template", status: "sent", wamid: "wamid.T1", order_id: "o-1", template_id: "t-before-fr", language: "fr", actor_type: "agent", sent_by: "ag-1" });
    expect(msg.body).toContain("Bonjour Amel, votre colis est en route avec Navex.");
    const conv = admin.tables.whatsapp_conversations[0];
    expect(conv).toMatchObject({ market_id: TN, phone_e164: "21698765432", customer_id: "cust-1", current_order_id: "o-1" });
    expect(conv.last_outbound_at).toBe(NOW.toISOString());
    expect(admin.tables.customers[0].whatsapp_last_outbound_at).toBe(NOW.toISOString());
  });

  it("persists the language only when it changed", async () => {
    admin.tables.whatsapp_templates.push({ ...TPL, id: "t-before-ar", language: "ar", body_text: "مرحباً {{1}}، طلبك مع {{2}} في طريقه إليك.\nالمبلغ عند الاستلام {{3}}." });
    await send({ language: "ar", template_id: "t-before-ar" });
    expect(rpcCalls.filter((c) => c.name === "set_customer_whatsapp_language")).toEqual([{ name: "set_customer_whatsapp_language", args: { p_customer_id: "cust-1", p_lang: "ar" } }]);
    admin.tables.customers[0].whatsapp_language = "ar";
    rpcCalls.length = 0;
    await send({ language: "ar", template_id: "t-before-ar" });
    expect(rpcCalls.filter((c) => c.name === "set_customer_whatsapp_language")).toEqual([]);
  });

  it("writes the delivery ledger when asked, through the user client's RPC, with the template key", async () => {
    await send({ log_delivery_action: true });
    const call = rpcCalls.find((c) => c.name === "record_delivery_action")!;
    expect(call.args).toMatchObject({ p_order_id: "o-1", p_action_type: "whatsapp_customer", p_channel: "whatsapp", p_outcome: "sent", p_template_key: "before_delivery", p_actor_id: "ag-1", p_actor_type: "agent" });
  });

  it("does not write the ledger when not asked, and a ledger failure never undoes the send", async () => {
    await send({});
    expect(rpcCalls.find((c) => c.name === "record_delivery_action")).toBeUndefined();
    user.rpcs.record_delivery_action = () => {
      throw new Error("42501");
    };
    const msg = await send({ log_delivery_action: true });
    expect(msg.status).toBe("sent");
  });

  it("refuses an agent who does not own the order before any Graph call", async () => {
    user.tables.orders = [];
    await expect(send({})).rejects.toMatchObject({ status: 404, code: "not_found" });
    expect(client.sendTemplate).not.toHaveBeenCalled();
  });

  it("refuses an agent who sees but does not own the order (manager path is fine)", async () => {
    user.tables.orders = [{ ...ORDER, assigned_to: "ag-2" }];
    await expect(send({})).rejects.toMatchObject({ status: 403, code: "not_owner" });
    const mgr = { id: "mgr-1", role: "market_manager" as const, market_id: TN };
    const msg = await sendMessage({ admin: admin.client, user: user.client, actor: mgr, now: () => NOW }, { target: { order_id: "o-1" }, language: "fr", mode: "template", template_id: "t-before-fr" });
    expect(msg.actor_type).toBe("manager");
  });

  it("409s on each gate refusal with the reason", async () => {
    admin.tables.whatsapp_configs[0].status = "paused";
    await expect(send({})).rejects.toMatchObject({ status: 409, code: "config_inactive" });
    admin.tables.whatsapp_configs[0].status = "active";
    admin.tables.orders[0].customer_phone = "12";
    await expect(send({})).rejects.toMatchObject({ status: 409, code: "invalid_phone" });
    admin.tables.orders[0].customer_phone = "98765432";
    admin.tables.customers[0].whatsapp_opted_out_at = "2026-09-20T00:00:00Z";
    await expect(send({})).rejects.toMatchObject({ status: 409, code: "opted_out" });
    admin.tables.customers[0].whatsapp_opted_out_at = null;
    await expect(send({ mode: "text", text: "Bonjour" })).rejects.toMatchObject({ status: 409, code: "window_closed" });
    expect(client.sendTemplate).not.toHaveBeenCalled();
    expect(client.sendText).not.toHaveBeenCalled();
  });

  it("falls back to the second phone when the first is not a mobile", async () => {
    admin.tables.orders[0].customer_phone = "12";
    admin.tables.orders[0].customer_phone_2 = "+216 55 000 111";
    await send({});
    expect(client.sendTemplate.mock.calls[0][0].to).toBe("21655000111");
  });

  it("a Graph failure leaves a failed row and throws 502 with the classification", async () => {
    client.sendTemplate.mockRejectedValue(new WhatsAppApiError("Undeliverable", { code: 131026, httpStatus: 400 }));
    await expect(send({})).rejects.toMatchObject({ status: 502, code: "graph_failed", graphCode: 131026, kind: "undeliverable" });
    const row = admin.tables.whatsapp_messages[0];
    expect(row).toMatchObject({ status: "failed", error_code: 131026, wamid: null });
    // 131026 marks the number undeliverable on the conversation and the customer.
    expect(admin.tables.whatsapp_conversations[0].undeliverable_at).toBeTruthy();
    expect(admin.tables.customers[0].whatsapp_undeliverable_at).toBeTruthy();
  });

  it("refuses a template that is not APPROVED, not this market's, or not in the requested language", async () => {
    admin.tables.whatsapp_templates[0].status = "PENDING";
    await expect(send({})).rejects.toMatchObject({ status: 409, code: "template_unavailable" });
    admin.tables.whatsapp_templates[0].status = "APPROVED";
    await expect(send({ language: "ar" })).rejects.toMatchObject({ status: 409, code: "template_unavailable" });
  });
});

describe("sendMessage — text and image inside the window", () => {
  beforeEach(() => {
    admin.tables.whatsapp_conversations.push({ id: "conv-1", market_id: TN, phone_e164: "21698765432", customer_id: "cust-1", current_order_id: "o-1", last_inbound_at: "2026-09-25T10:00:00Z", opted_out_at: null, undeliverable_at: null });
  });

  it("sends free text and stores it", async () => {
    const msg = await send({ mode: "text", text: "  Bonjour, je vous rappelle à 14h.  ", template_id: undefined });
    expect(client.sendText).toHaveBeenCalledWith({ to: "21698765432", body: "Bonjour, je vous rappelle à 14h." });
    expect(msg).toMatchObject({ kind: "text", body: "Bonjour, je vous rappelle à 14h.", status: "sent", wamid: "wamid.X1", conversation_id: "conv-1" });
  });

  it("rejects empty or over-long text", async () => {
    await expect(send({ mode: "text", text: "   " })).rejects.toMatchObject({ status: 400 });
    await expect(send({ mode: "text", text: "x".repeat(4097) })).rejects.toMatchObject({ status: 400 });
  });

  it("image mode is free-form inside the window…", async () => {
    const msg = await send({ mode: "image", image_url: "https://cdn.example.com/p.jpg", caption: "Sérum — 89 TND", product: { name: "Sérum", price: 89, currency: "TND" } });
    expect(client.sendImage).toHaveBeenCalledWith({ to: "21698765432", link: "https://cdn.example.com/p.jpg", caption: "Sérum — 89 TND" });
    expect(msg).toMatchObject({ kind: "image", media_link: "https://cdn.example.com/p.jpg", media_caption: "Sérum — 89 TND" });
  });

  it("…and the product_share template with an image header outside it", async () => {
    admin.tables.whatsapp_conversations[0].last_inbound_at = "2026-09-20T10:00:00Z";
    const msg = await send({ mode: "image", image_url: "https://cdn.example.com/p.jpg", caption: "x", product: { name: "Sérum", price: 89, currency: "TND" } });
    expect(client.sendImage).not.toHaveBeenCalled();
    expect(client.sendTemplate).toHaveBeenCalledWith({
      to: "21698765432",
      name: "ordra_product_share_v1",
      language: "fr",
      bodyParameters: ["Amel", "Sérum", "89 TND"],
      headerImageLink: "https://cdn.example.com/p.jpg",
    });
    expect(msg).toMatchObject({ kind: "template", template_id: "t-share-fr", media_link: "https://cdn.example.com/p.jpg" });
  });

  it("refuses a non-https image link", async () => {
    await expect(send({ mode: "image", image_url: "http://x/p.jpg" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("sendMessage — to a lead", () => {
  beforeEach(() => {
    admin.tables.leads = [{ id: "l-1", market_id: TN, assigned_to: "ag-1", customer_name: "Nour", customer_phone: "0021698765432", customer_city: "Sousse", product_interest_id: "p-1", campaign_id: "camp-1", status: "assigned" }];
    admin.tables.products = [{ id: "p-1", name: "Crème", default_price: 59 }];
    admin.tables.prospect_campaigns = [{ id: "camp-1", offer: "-20 %" }];
    admin.tables.whatsapp_templates.push({ id: "t-fu-fr", market_id: TN, name: "ordra_prospect_follow_up_v1", language: "fr", category: "MARKETING", status: "APPROVED", body_text: "Bonjour {{1}}, vous vous étiez intéressé(e) à {{2}}. Nous vous proposons {{3}} si vous commandez aujourd'hui.", header_format: null, variables: ["name", "product", "discount"], event_key: null, catalogue_key: "prospect_follow_up", source: "catalogue" });
    user.tables.leads = [{ id: "l-1", assigned_to: "ag-1", market_id: TN }];
  });

  it("renders the lead's product and the campaign's offer, anchors the conversation on the lead", async () => {
    const msg = await sendMessage({ admin: admin.client, user: user.client, actor, now: () => NOW }, { target: { lead_id: "l-1" }, language: "fr", mode: "template", template_id: "t-fu-fr" });
    expect(client.sendTemplate.mock.calls[0][0].bodyParameters).toEqual(["Nour", "Crème", "-20 %"]);
    expect(msg).toMatchObject({ lead_id: "l-1", order_id: null, campaign_id: "camp-1" });
    expect(admin.tables.whatsapp_conversations[0]).toMatchObject({ current_lead_id: "l-1", current_order_id: null });
  });

  it("an agent who does not hold the lead is refused", async () => {
    user.tables.leads = [];
    await expect(
      sendMessage({ admin: admin.client, user: user.client, actor, now: () => NOW }, { target: { lead_id: "l-1" }, language: "fr", mode: "template", template_id: "t-fu-fr" }),
    ).rejects.toBeInstanceOf(SendError);
  });
});
