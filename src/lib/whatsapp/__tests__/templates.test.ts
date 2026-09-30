import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeSupabase, type FakeSupabase } from "@/test/helpers/fakeSupabase";
import {
  toMetaComponents,
  fromMetaComponents,
  catalogueKeyFromName,
  placeholderCount,
  syncTemplatesFromMeta,
  createMissingCatalogueTemplates,
} from "../templates";
import { CATALOGUE, catalogueEntry } from "../catalogue";
import type { WhatsAppConfig } from "../config";
import type { WhatsAppClient, MetaTemplate } from "../client";

/**
 * The registry is what the drain and the composer read; Meta is what it
 * mirrors. Sync must never lose a manager's event mapping, and the one-click
 * catalogue creation must submit exactly what Meta accepts (examples for
 * every placeholder, an image handle for the header).
 */
const TN = "00000000-0000-0000-0000-000000000001";
const CFG: WhatsAppConfig = {
  id: "cfg-tn", marketId: TN, wabaId: "444", phoneNumberId: "111", appId: "777", graphVersion: "v26.0",
  accessToken: "EAA", appSecret: "s", verifyToken: "v", displayPhone: null, verifiedName: null, qualityRating: null,
  messagingLimitTier: null, status: "active", statusReason: null, sendRatePerSec: 3, lastWebhookAt: null, decryptFailed: false,
};

const metaTpl = (over: Partial<MetaTemplate>): MetaTemplate => ({
  id: "meta-1", name: "ordra_shipped_v1", language: "fr", category: "UTILITY", status: "APPROVED", rejectedReason: null, qualityScore: null,
  components: [{ type: "BODY", text: "Bonjour {{1}}, votre colis est en route avec {{2}}.\nN° de suivi : {{3}}.\nMontant à préparer : {{4}}.\nMerci de garder votre téléphone à portée de main." }],
  ...over,
});

describe("toMetaComponents", () => {
  it("builds BODY with examples for every placeholder, in the sample language", () => {
    const e = catalogueEntry("shipped")!;
    const comps = toMetaComponents(e, "fr") as Record<string, unknown>[];
    expect(comps).toHaveLength(1);
    expect(comps[0]).toEqual({
      type: "BODY",
      text: e.body.fr,
      example: { body_text: [["Amel", "Navex", "NX48213", "89 TND"]] },
    });
  });

  it("adds an IMAGE header with the upload handle and a FOOTER for marketing entries", () => {
    const e = catalogueEntry("product_share")!;
    const comps = toMetaComponents(e, "ar", "4:handle") as Record<string, unknown>[];
    expect(comps[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["4:handle"] } });
    expect(comps[1]).toMatchObject({ type: "BODY", text: e.body.ar });
    expect(comps[2]).toEqual({ type: "FOOTER", text: e.footer!.ar });
  });

  it("omits the example key when there is no placeholder", () => {
    const e = catalogueEntry("delivered")!;
    const comps = toMetaComponents(e, "fr") as Record<string, unknown>[];
    expect(comps[0]).toEqual({ type: "BODY", text: e.body.fr, example: { body_text: [["Amel"]] } });
    // delivered has {{1}}; a truly variable-free body is exercised below
    expect(toMetaComponents({ ...e, variables: [], body: { fr: "Merci.", ar: "شكراً." } }, "fr")).toEqual([{ type: "BODY", text: "Merci." }]);
  });

  it("refuses to build an IMAGE header without a handle", () => {
    expect(() => toMetaComponents(catalogueEntry("product_share")!, "fr", null)).toThrow(/handle/);
  });
});

describe("fromMetaComponents / helpers", () => {
  it("extracts body, header format and footer from Meta's components", () => {
    expect(
      fromMetaComponents([
        { type: "HEADER", format: "IMAGE" },
        { type: "BODY", text: "Hi {{1}}" },
        { type: "FOOTER", text: "STOP" },
        { type: "BUTTONS", buttons: [] },
      ]),
    ).toEqual({ bodyText: "Hi {{1}}", headerFormat: "IMAGE", footerText: "STOP" });
    expect(fromMetaComponents([])).toEqual({ bodyText: "", headerFormat: null, footerText: null });
  });

  it("recognises our own names and their version", () => {
    expect(catalogueKeyFromName("ordra_shipped_v1")).toEqual({ key: "shipped", version: 1 });
    expect(catalogueKeyFromName("ordra_product_share_v2")).toEqual({ key: "product_share", version: 2 });
    expect(catalogueKeyFromName("ordra_camp_serum_260925")).toBeNull();
    expect(catalogueKeyFromName("hello_world")).toBeNull();
  });

  it("counts distinct placeholders", () => {
    expect(placeholderCount("a {{1}} b {{2}} c {{1}}")).toBe(2);
    expect(placeholderCount("none")).toBe(0);
  });
});

describe("syncTemplatesFromMeta", () => {
  let fake: FakeSupabase;
  let client: Pick<WhatsAppClient, "listTemplates">;
  beforeEach(() => {
    fake = makeFakeSupabase({
      whatsapp_templates: [
        // A row the manager mapped by hand: sync must keep event_key and variables.
        { id: "t-existing", market_id: TN, meta_template_id: "meta-1", name: "ordra_shipped_v1", language: "fr", category: "UTILITY", status: "PENDING", event_key: "shipped", variables: ["name", "carrier", "tracking", "amount"], source: "catalogue", catalogue_key: "shipped" },
        // A row Meta no longer has.
        { id: "t-gone", market_id: TN, meta_template_id: "meta-gone", name: "old_one", language: "fr", category: "UTILITY", status: "APPROVED", event_key: null, variables: [], source: "synced" },
      ],
    });
    client = {
      listTemplates: vi.fn().mockResolvedValue([
        metaTpl({}),
        metaTpl({ id: "meta-2", name: "ordra_shipped_v1", language: "ar", status: "PENDING", components: [{ type: "BODY", text: catalogueEntry("shipped")!.body.ar }] }),
        metaTpl({ id: "meta-3", name: "hello_world", language: "en_US", status: "APPROVED", components: [{ type: "BODY", text: "Welcome {{1}}" }] }),
        metaTpl({ id: "meta-4", name: "ordra_product_share_v1", language: "fr", category: "MARKETING", status: "REJECTED", rejectedReason: "INVALID_FORMAT", components: [{ type: "HEADER", format: "IMAGE" }, { type: "BODY", text: catalogueEntry("product_share")!.body.fr }, { type: "FOOTER", text: "x" }] }),
      ]),
    };
  });

  it("updates existing rows without touching their mapping, inserts the new ones, infers ours from the name", async () => {
    const r = await syncTemplatesFromMeta(fake.client, CFG, client as WhatsAppClient);
    expect(r).toMatchObject({ inserted: 3, updated: 1, deleted: 1 });
    const rows = fake.tables.whatsapp_templates;
    const existing = rows.find((t) => t.id === "t-existing")!;
    expect(existing).toMatchObject({ status: "APPROVED", event_key: "shipped", variables: ["name", "carrier", "tracking", "amount"] });
    expect(existing.synced_at).toBeTruthy();
    expect(existing.body_text).toContain("Bonjour {{1}}");

    const ar = rows.find((t) => t.name === "ordra_shipped_v1" && t.language === "ar")!;
    expect(ar).toMatchObject({ status: "PENDING", event_key: "shipped", catalogue_key: "shipped", variables: ["name", "carrier", "tracking", "amount"], source: "catalogue", meta_template_id: "meta-2" });

    const foreign = rows.find((t) => t.name === "hello_world")!;
    // en_US is not one of ours; kept for visibility, unmappable, variables unknown.
    expect(foreign).toMatchObject({ language: "en", status: "APPROVED", event_key: null, variables: [], source: "synced", body_text: "Welcome {{1}}" });

    const share = rows.find((t) => t.name === "ordra_product_share_v1")!;
    expect(share).toMatchObject({ status: "REJECTED", rejected_reason: "INVALID_FORMAT", header_format: "IMAGE", event_key: null, catalogue_key: "product_share", variables: ["name", "product", "amount"] });

    expect(rows.find((t) => t.id === "t-gone")!.status).toBe("DELETED");
  });

  it("does not map an event twice for the same language (partial unique index)", async () => {
    fake.tables.whatsapp_templates.push({ id: "t-v2", market_id: TN, meta_template_id: "meta-v2", name: "ordra_shipped_v2", language: "ar", status: "APPROVED", event_key: "shipped", variables: [], source: "catalogue" });
    (client.listTemplates as ReturnType<typeof vi.fn>).mockResolvedValue([
      metaTpl({ id: "meta-v2", name: "ordra_shipped_v2", language: "ar" }),
      metaTpl({ id: "meta-2", name: "ordra_shipped_v1", language: "ar", status: "PENDING" }),
    ]);
    await syncTemplatesFromMeta(fake.client, CFG, client as WhatsAppClient);
    const v1ar = fake.tables.whatsapp_templates.find((t) => t.name === "ordra_shipped_v1" && t.language === "ar")!;
    expect(v1ar.event_key).toBeNull();
  });
});

describe("createMissingCatalogueTemplates", () => {
  let fake: FakeSupabase;
  const client = {
    listTemplates: vi.fn(),
    createTemplate: vi.fn(),
    createUploadSession: vi.fn(),
    uploadChunk: vi.fn(),
  };
  const readSampleImage = vi.fn().mockResolvedValue({ bytes: new Uint8Array([1, 2, 3]), mime: "image/jpeg", name: "product-sample.jpg" });

  beforeEach(() => {
    vi.clearAllMocks();
    fake = makeFakeSupabase({ whatsapp_templates: [] });
    client.listTemplates.mockResolvedValue([metaTpl({ id: "meta-1", name: "ordra_shipped_v1", language: "fr" })]);
    client.createTemplate.mockImplementation(async (input: { name: string; language: string; category: string }) => ({ id: `meta-${input.name}-${input.language}`, status: "PENDING", category: input.category }));
    client.createUploadSession.mockResolvedValue("upload:1");
    client.uploadChunk.mockResolvedValue("4:handle");
  });

  it("creates every catalogue entry in both languages that Meta does not already hold, uploading the sample image once", async () => {
    const r = await createMissingCatalogueTemplates(fake.client, CFG, client as unknown as WhatsAppClient, { readSampleImage });
    const total = CATALOGUE.length * 2;
    expect(r.created).toHaveLength(total - 1);
    expect(r.skipped).toEqual(["ordra_shipped_v1/fr"]);
    expect(r.failed).toEqual([]);
    expect(client.createTemplate).toHaveBeenCalledTimes(total - 1);
    expect(client.createUploadSession).toHaveBeenCalledTimes(1);
    expect(client.uploadChunk).toHaveBeenCalledTimes(1);

    const share = client.createTemplate.mock.calls.map((c) => c[0]).find((i: { name: string; language: string }) => i.name === "ordra_product_share_v1" && i.language === "ar");
    expect(share.components[0]).toEqual({ type: "HEADER", format: "IMAGE", example: { header_handle: ["4:handle"] } });
    expect(share.category).toBe("MARKETING");

    // Registry rows: the skipped one is registered too (from Meta's list), mapped immediately.
    const rows = fake.tables.whatsapp_templates;
    expect(rows).toHaveLength(total);
    const shippedFr = rows.find((t) => t.name === "ordra_shipped_v1" && t.language === "fr")!;
    expect(shippedFr).toMatchObject({ status: "APPROVED", meta_template_id: "meta-1", event_key: "shipped", source: "catalogue" });
    const deliveredAr = rows.find((t) => t.name === "ordra_delivered_v1" && t.language === "ar")!;
    expect(deliveredAr).toMatchObject({ status: "PENDING", event_key: "delivered", variables: ["name"], catalogue_key: "delivered", body_text: catalogueEntry("delivered")!.body.ar });
    const before = rows.find((t) => t.name === "ordra_before_delivery_v1" && t.language === "fr")!;
    expect(before.event_key).toBeNull();
  });

  it("records a per-template failure and carries on", async () => {
    client.createTemplate.mockImplementation(async (input: { name: string; language: string; category: string }) => {
      if (input.name === "ordra_last_chance_v1" && input.language === "ar") throw new Error("(#100) Invalid parameter");
      return { id: `meta-${input.name}-${input.language}`, status: "PENDING", category: input.category };
    });
    const r = await createMissingCatalogueTemplates(fake.client, CFG, client as unknown as WhatsAppClient, { readSampleImage });
    expect(r.failed).toEqual([{ name: "ordra_last_chance_v1", language: "ar", error: "(#100) Invalid parameter" }]);
    expect(r.created).toHaveLength(CATALOGUE.length * 2 - 2);
  });

  it("does not resubmit a template the registry already holds as PENDING or APPROVED", async () => {
    fake.tables.whatsapp_templates.push({ id: "x", market_id: TN, name: "ordra_delivered_v1", language: "fr", status: "PENDING", event_key: "delivered", variables: ["name"], source: "catalogue" });
    const r = await createMissingCatalogueTemplates(fake.client, CFG, client as unknown as WhatsAppClient, { readSampleImage });
    expect(r.skipped).toContain("ordra_delivered_v1/fr");
    expect(client.createTemplate.mock.calls.some((c) => c[0].name === "ordra_delivered_v1" && c[0].language === "fr")).toBe(false);
  });

  it("resubmits a REJECTED one as the next version", async () => {
    fake.tables.whatsapp_templates.push({ id: "x", market_id: TN, name: "ordra_delivered_v1", language: "fr", status: "REJECTED", event_key: null, variables: ["name"], source: "catalogue", catalogue_key: "delivered" });
    const r = await createMissingCatalogueTemplates(fake.client, CFG, client as unknown as WhatsAppClient, { readSampleImage });
    expect(r.created).toContain("ordra_delivered_v2/fr");
    const v2 = fake.tables.whatsapp_templates.find((t) => t.name === "ordra_delivered_v2" && t.language === "fr")!;
    expect(v2).toMatchObject({ status: "PENDING", event_key: "delivered" });
  });
});
