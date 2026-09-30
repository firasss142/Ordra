import { describe, it, expect } from "vitest";
import { parseWebhookPayload } from "../parse";
import * as fx from "./fixtures";

/**
 * Pure: Meta's envelope → typed events. Everything downstream (the route,
 * the handler) trusts these shapes, so every event kind Meta documents has a
 * fixture here, plus the ones it will invent later (unknown field).
 */
describe("parseWebhookPayload", () => {
  it("rejects a non-WhatsApp object", () => {
    expect(parseWebhookPayload({ object: "page", entry: [] }).ok).toBe(false);
    expect(parseWebhookPayload("garbage").ok).toBe(false);
    expect(parseWebhookPayload(null).ok).toBe(false);
  });

  it("parses an inbound text message with the contact's profile name", () => {
    const r = parseWebhookPayload(fx.textMessage({ body: "Oui" }));
    expect(r.ok).toBe(true);
    expect(r.phoneNumberIds).toEqual([fx.PNID]);
    expect(r.wabaIds).toEqual([fx.WABA]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({
      type: "message",
      wabaId: fx.WABA,
      phoneNumberId: fx.PNID,
      wamid: "wamid.IN1",
      from: "21698765432",
      profileName: "Amel",
      kind: "text",
      text: "Oui",
      timestamp: new Date(1758800000 * 1000),
    });
  });

  it("parses a media message with its id, mime, caption and reply context", () => {
    const [e] = parseWebhookPayload(fx.imageMessage).events;
    expect(e).toMatchObject({
      type: "message",
      kind: "image",
      media: { id: "media-9", mime: "image/jpeg", caption: "voilà" },
      contextWamid: "wamid.OUT1",
      text: null,
    });
  });

  it("keeps an unsupported message as such, with Meta's error", () => {
    const [e] = parseWebhookPayload(fx.unsupportedMessage).events;
    expect(e).toMatchObject({ type: "message", kind: "unsupported", errorCode: 131051 });
  });

  it("parses a reaction as kind reaction pointing at the reacted wamid", () => {
    const [e] = parseWebhookPayload(fx.reactionMessage).events;
    expect(e).toMatchObject({ type: "message", kind: "reaction", contextWamid: "wamid.OUT1", text: "👍" });
  });

  it("parses a sent status with conversation and pricing", () => {
    const [e] = parseWebhookPayload(fx.statusEvent("sent")).events;
    expect(e).toMatchObject({
      type: "status",
      wamid: "wamid.OUT1",
      status: "sent",
      recipientId: "21698765432",
      conversation: { id: "conv-meta-1", origin: "utility", expiresAt: new Date(1758886800 * 1000) },
      pricing: { category: "utility", billable: true, model: "PMP" },
    });
  });

  it("parses a failed status with its error code, title and details", () => {
    const [e] = parseWebhookPayload(fx.failed131026).events;
    expect(e).toMatchObject({
      type: "status",
      status: "failed",
      errors: [{ code: 131026, title: "Message undeliverable", details: "Message Undeliverable." }],
    });
  });

  it("parses a template status update", () => {
    const [e] = parseWebhookPayload(fx.templateStatus("REJECTED", { reason: "INVALID_FORMAT" })).events;
    expect(e).toEqual({
      type: "template_status",
      wabaId: fx.WABA,
      metaTemplateId: "tpl-meta-1",
      name: "ordra_shipped_v1",
      language: "fr",
      event: "REJECTED",
      reason: "INVALID_FORMAT",
    });
  });

  it("parses a phone number quality update", () => {
    const [e] = parseWebhookPayload(fx.qualityUpdate("DOWNGRADE", "TIER_250")).events;
    expect(e).toMatchObject({ type: "phone_quality", wabaId: fx.WABA, event: "DOWNGRADE", currentLimit: "TIER_250", displayPhone: "21629000000" });
  });

  it("parses an account update", () => {
    const [e] = parseWebhookPayload(fx.accountUpdate("DISABLED_UPDATE")).events;
    expect(e).toMatchObject({ type: "account_update", wabaId: fx.WABA, event: "DISABLED_UPDATE" });
  });

  it("walks mixed entries in order and keeps an unknown field as unknown", () => {
    const r = parseWebhookPayload(fx.mixed);
    expect(r.events.map((e) => e.type)).toEqual(["status", "message", "unknown"]);
    expect(r.wabaIds).toEqual([fx.WABA, "999"]);
    expect(r.events[2]).toMatchObject({ type: "unknown", field: "something_new", wabaId: "999" });
  });
});
