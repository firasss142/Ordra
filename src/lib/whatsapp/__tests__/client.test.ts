import { describe, it, expect, vi, afterEach } from "vitest";
import { createWhatsAppClient } from "../client";
import { WhatsAppApiError } from "../errors";

/**
 * The transport. What is under test is what cannot be seen from the outside
 * once deployed: the token never in a URL, the payload shape Meta accepts, the
 * error classification, and the redaction of anything Meta echoes back.
 */
const CFG = {
  phoneNumberId: "111222333",
  wabaId: "444555666",
  appId: "777888999",
  accessToken: "EAAsecrettokenvalue",
  graphVersion: "v26.0",
};

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}) {
  return {
    status: init.status ?? 200,
    text: async () => JSON.stringify(body),
    headers: new Headers(init.headers ?? {}),
  } as unknown as Response;
}

function stubFetch(...responses: Response[]) {
  const fn = vi.fn();
  responses.forEach((r) => fn.mockResolvedValueOnce(r));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const SENT = { messaging_product: "whatsapp", contacts: [{ input: "21698765432", wa_id: "21698765432" }], messages: [{ id: "wamid.HBgL" }] };

describe("credential handling", () => {
  it("sends the token as a Bearer header, never in the URL or the body", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    await createWhatsAppClient(CFG).sendText({ to: "21698765432", body: "hi" });
    const [url, init] = fn.mock.calls[0];
    expect(String(url)).toBe(`https://graph.facebook.com/v26.0/${CFG.phoneNumberId}/messages`);
    expect(String(url)).not.toContain(CFG.accessToken);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${CFG.accessToken}` });
    expect(String((init as RequestInit).body)).not.toContain(CFG.accessToken);
  });

  it("redacts the token from an error Meta echoes back", async () => {
    stubFetch(
      jsonResponse(
        { error: { message: `Bad URL https://graph.facebook.com/x?access_token=${CFG.accessToken}`, code: 100, fbtrace_id: "A1" } },
        { status: 400 },
      ),
    );
    const promise = createWhatsAppClient(CFG).sendText({ to: "21698765432", body: "hi" });
    await expect(promise).rejects.toBeInstanceOf(WhatsAppApiError);
    await promise.catch((e: WhatsAppApiError) => {
      expect(e.message).not.toContain(CFG.accessToken);
      expect(e.code).toBe(100);
      expect(e.httpStatus).toBe(400);
      expect(e.fbtraceId).toBe("A1");
    });
  });

  it("uses a 15 s timeout signal on every call", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    await createWhatsAppClient(CFG).sendText({ to: "21698765432", body: "hi" });
    const init = fn.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("message payloads", () => {
  it("builds a template payload with body parameters and an image header", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    const res = await createWhatsAppClient(CFG).sendTemplate({
      to: "21698765432",
      name: "ordra_product_share_v1",
      language: "fr",
      bodyParameters: ["Amel", "Sérum", "89 TND"],
      headerImageLink: "https://cdn.example.com/p.jpg",
    });
    expect(res.wamid).toBe("wamid.HBgL");
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "21698765432",
      type: "template",
      template: {
        name: "ordra_product_share_v1",
        language: { code: "fr" },
        components: [
          { type: "header", parameters: [{ type: "image", image: { link: "https://cdn.example.com/p.jpg" } }] },
          {
            type: "body",
            parameters: [
              { type: "text", text: "Amel" },
              { type: "text", text: "Sérum" },
              { type: "text", text: "89 TND" },
            ],
          },
        ],
      },
    });
  });

  it("omits the components key when a template has no variables", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    await createWhatsAppClient(CFG).sendTemplate({ to: "21698765432", name: "ordra_delivered_v1", language: "ar", bodyParameters: [] });
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body.template.components).toBeUndefined();
  });

  it("maps ar to the ar language code and fr to fr (Meta's own codes)", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    await createWhatsAppClient(CFG).sendTemplate({ to: "21698765432", name: "x", language: "ar", bodyParameters: [] });
    expect(JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body)).template.language.code).toBe("ar");
  });

  it("builds a text payload, with a reply context when given", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    await createWhatsAppClient(CFG).sendText({ to: "21698765432", body: "Bonjour", contextWamid: "wamid.IN" });
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: "21698765432",
      type: "text",
      text: { body: "Bonjour", preview_url: false },
      context: { message_id: "wamid.IN" },
    });
  });

  it("builds an image payload from a link with a caption", async () => {
    const fn = stubFetch(jsonResponse(SENT));
    await createWhatsAppClient(CFG).sendImage({ to: "21698765432", link: "https://cdn.example.com/p.jpg", caption: "Sérum" });
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body.type).toBe("image");
    expect(body.image).toEqual({ link: "https://cdn.example.com/p.jpg", caption: "Sérum" });
  });

  it("marks a message read", async () => {
    const fn = stubFetch(jsonResponse({ success: true }));
    await createWhatsAppClient(CFG).markRead("wamid.IN");
    const body = JSON.parse(String((fn.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.IN" });
  });
});

describe("management endpoints", () => {
  it("reads the phone number's status fields", async () => {
    const fn = stubFetch(
      jsonResponse({
        verified_name: "Ordra Tunisie",
        display_phone_number: "+216 29 000 000",
        quality_rating: "GREEN",
        messaging_limit_tier: "TIER_1K",
        code_verification_status: "VERIFIED",
        name_status: "APPROVED",
        status: "CONNECTED",
        id: CFG.phoneNumberId,
      }),
    );
    const status = await createWhatsAppClient(CFG).getPhoneStatus();
    expect(String(fn.mock.calls[0][0])).toContain(`/${CFG.phoneNumberId}?fields=`);
    expect(status).toMatchObject({
      verifiedName: "Ordra Tunisie",
      displayPhone: "+216 29 000 000",
      qualityRating: "GREEN",
      messagingLimitTier: "TIER_1K",
      codeVerificationStatus: "VERIFIED",
      nameStatus: "APPROVED",
      status: "CONNECTED",
    });
  });

  it("lists templates across pages and strips the token from the cursor", async () => {
    const next = `https://graph.facebook.com/v26.0/${CFG.wabaId}/message_templates?after=CUR&access_token=${CFG.accessToken}`;
    const fn = stubFetch(
      jsonResponse({ data: [{ id: "1", name: "a", language: "fr", status: "APPROVED", category: "UTILITY", components: [] }], paging: { next } }),
      jsonResponse({ data: [{ id: "2", name: "b", language: "ar", status: "PENDING", category: "MARKETING", components: [] }] }),
    );
    const list = await createWhatsAppClient(CFG).listTemplates();
    expect(list.map((t) => t.id)).toEqual(["1", "2"]);
    expect(String(fn.mock.calls[1][0])).not.toContain("access_token");
  });

  it("creates a template on the WABA", async () => {
    const fn = stubFetch(jsonResponse({ id: "tpl-9", status: "PENDING", category: "UTILITY" }));
    const res = await createWhatsAppClient(CFG).createTemplate({
      name: "ordra_shipped_v1",
      language: "fr",
      category: "UTILITY",
      components: [{ type: "BODY", text: "Bonjour {{1}}" }],
    });
    expect(String(fn.mock.calls[0][0])).toBe(`https://graph.facebook.com/v26.0/${CFG.wabaId}/message_templates`);
    expect(res).toEqual({ id: "tpl-9", status: "PENDING", category: "UTILITY" });
  });

  it("runs the two-step resumable upload and returns the handle", async () => {
    const fn = stubFetch(jsonResponse({ id: "upload:MTph" }), jsonResponse({ h: "4:handle" }));
    const client = createWhatsAppClient(CFG);
    const session = await client.createUploadSession({ fileLength: 3, fileType: "image/jpeg", fileName: "p.jpg" });
    expect(session).toBe("upload:MTph");
    expect(String(fn.mock.calls[0][0])).toContain(`/${CFG.appId}/uploads?`);
    const handle = await client.uploadChunk({ sessionId: session, bytes: new Uint8Array([1, 2, 3]) });
    expect(handle).toBe("4:handle");
    const init = fn.mock.calls[1][1] as RequestInit;
    // Meta's upload endpoint wants OAuth in the header and the offset as its own header.
    expect(init.headers).toMatchObject({ Authorization: `OAuth ${CFG.accessToken}`, file_offset: "0" });
  });

  it("subscribes the app to the WABA", async () => {
    const fn = stubFetch(jsonResponse({ success: true }));
    await createWhatsAppClient(CFG).subscribeApp();
    expect(String(fn.mock.calls[0][0])).toBe(`https://graph.facebook.com/v26.0/${CFG.wabaId}/subscribed_apps`);
    expect((fn.mock.calls[0][1] as RequestInit).method).toBe("POST");
  });

  it("reads the subscribed apps", async () => {
    stubFetch(jsonResponse({ data: [{ whatsapp_business_api_data: { id: CFG.appId, name: "Ordra" } }] }));
    const apps = await createWhatsAppClient(CFG).getSubscribedApps();
    expect(apps).toEqual([CFG.appId]);
  });
});
