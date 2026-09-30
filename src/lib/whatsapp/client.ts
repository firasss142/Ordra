/**
 * WhatsApp Cloud API client — one instance per market config.
 *
 * SERVER-SIDE ONLY. Nothing here may be imported from a client component, and
 * outside `src/lib/whatsapp/**` nothing but the config test route may import
 * it at all: every send goes through `gate.ts` first (the choke point), and a
 * direct import is how a screen ends up messaging an opted-out customer.
 */
import type { CustomerLang, TemplateCategory, TemplateStatus } from "./types";
import { asRecord, deleteJson, getJson, graphBase, postBinary, postJson, stripToken } from "./http";
import { WhatsAppApiError } from "./errors";

export { WhatsAppApiError };

export interface WhatsAppClientConfig {
  phoneNumberId: string;
  wabaId: string;
  appId: string;
  accessToken: string;
  graphVersion?: string | null;
}

export interface SendResult {
  wamid: string;
  /** The wa_id Meta resolved the recipient to (may differ from `to`). */
  waId: string | null;
  /** "accepted" | "held_for_quality_assessment" — informational. */
  messageStatus: string | null;
}

export interface SendTemplateInput {
  to: string;
  name: string;
  language: CustomerLang;
  bodyParameters: string[];
  headerImageLink?: string | null;
  headerImageId?: string | null;
}

export interface SendTextInput {
  to: string;
  body: string;
  previewUrl?: boolean;
  contextWamid?: string | null;
}

export interface SendImageInput {
  to: string;
  link?: string;
  mediaId?: string;
  caption?: string | null;
  contextWamid?: string | null;
}

export interface PhoneStatus {
  id: string | null;
  verifiedName: string | null;
  displayPhone: string | null;
  qualityRating: string | null;
  messagingLimitTier: string | null;
  codeVerificationStatus: string | null;
  nameStatus: string | null;
  status: string | null;
  platformType: string | null;
}

export interface MetaTemplate {
  id: string;
  name: string;
  language: string;
  category: TemplateCategory | string;
  status: TemplateStatus | string;
  components: unknown[];
  rejectedReason: string | null;
  qualityScore: string | null;
}

export interface CreateTemplateInput {
  name: string;
  language: CustomerLang;
  category: TemplateCategory;
  components: unknown[];
  allowCategoryChange?: boolean;
}

export interface CreateTemplateResult {
  id: string;
  status: string;
  category: string;
}

const PHONE_FIELDS = [
  "verified_name",
  "display_phone_number",
  "quality_rating",
  "messaging_limit_tier",
  "code_verification_status",
  "name_status",
  "status",
  "platform_type",
].join(",");

const TEMPLATE_FIELDS = ["id", "name", "language", "category", "status", "components", "rejected_reason", "quality_score"].join(",");

/** Hard stop on pagination; a WABA holds at most 250 templates. */
const MAX_TEMPLATE_PAGES = 20;

function str(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function parseSendResult(body: unknown): SendResult {
  const rec = asRecord(body);
  const messages = Array.isArray(rec.messages) ? rec.messages : [];
  const contacts = Array.isArray(rec.contacts) ? rec.contacts : [];
  const first = asRecord(messages[0]);
  const wamid = str(first.id);
  if (!wamid) {
    throw new WhatsAppApiError("Meta accepted the request but returned no message id", { httpStatus: 200 });
  }
  return {
    wamid,
    waId: str(asRecord(contacts[0]).wa_id),
    messageStatus: str(first.message_status),
  };
}

export function createWhatsAppClient(cfg: WhatsAppClientConfig) {
  const base = graphBase(cfg.graphVersion);
  const messagesUrl = `${base}/${cfg.phoneNumberId}/messages`;
  const token = cfg.accessToken;

  const send = async (payload: Record<string, unknown>, signal?: AbortSignal): Promise<SendResult> =>
    parseSendResult(
      await postJson(messagesUrl, token, { messaging_product: "whatsapp", recipient_type: "individual", ...payload }, signal),
    );

  return {
    async sendTemplate(input: SendTemplateInput, signal?: AbortSignal): Promise<SendResult> {
      const components: unknown[] = [];
      if (input.headerImageLink || input.headerImageId) {
        components.push({
          type: "header",
          parameters: [
            {
              type: "image",
              image: input.headerImageId ? { id: input.headerImageId } : { link: input.headerImageLink },
            },
          ],
        });
      }
      if (input.bodyParameters.length > 0) {
        components.push({
          type: "body",
          parameters: input.bodyParameters.map((text) => ({ type: "text", text })),
        });
      }
      const template: Record<string, unknown> = {
        name: input.name,
        language: { code: input.language },
      };
      if (components.length > 0) template.components = components;
      return send({ to: input.to, type: "template", template }, signal);
    },

    async sendText(input: SendTextInput, signal?: AbortSignal): Promise<SendResult> {
      const payload: Record<string, unknown> = {
        to: input.to,
        type: "text",
        text: { body: input.body, preview_url: input.previewUrl ?? false },
      };
      if (input.contextWamid) payload.context = { message_id: input.contextWamid };
      return send(payload, signal);
    },

    async sendImage(input: SendImageInput, signal?: AbortSignal): Promise<SendResult> {
      const image: Record<string, unknown> = input.mediaId ? { id: input.mediaId } : { link: input.link };
      if (input.caption) image.caption = input.caption;
      const payload: Record<string, unknown> = { to: input.to, type: "image", image };
      if (input.contextWamid) payload.context = { message_id: input.contextWamid };
      return send(payload, signal);
    },

    async markRead(wamid: string, signal?: AbortSignal): Promise<void> {
      await postJson(messagesUrl, token, { messaging_product: "whatsapp", status: "read", message_id: wamid }, signal);
    },

    async getPhoneStatus(signal?: AbortSignal): Promise<PhoneStatus> {
      const body = asRecord(await getJson(`${base}/${cfg.phoneNumberId}?fields=${PHONE_FIELDS}`, token, signal));
      return {
        id: str(body.id),
        verifiedName: str(body.verified_name),
        displayPhone: str(body.display_phone_number),
        qualityRating: str(body.quality_rating),
        messagingLimitTier: str(body.messaging_limit_tier),
        codeVerificationStatus: str(body.code_verification_status),
        nameStatus: str(body.name_status),
        status: str(body.status),
        platformType: str(body.platform_type),
      };
    },

    async listTemplates(signal?: AbortSignal): Promise<MetaTemplate[]> {
      let url: string | null = `${base}/${cfg.wabaId}/message_templates?fields=${TEMPLATE_FIELDS}&limit=100`;
      const out: MetaTemplate[] = [];
      for (let page = 0; page < MAX_TEMPLATE_PAGES && url; page++) {
        const body = asRecord(await getJson(url, token, signal));
        const data = Array.isArray(body.data) ? body.data : [];
        for (const raw of data) {
          const t = asRecord(raw);
          const id = str(t.id);
          const name = str(t.name);
          if (!id || !name) continue;
          out.push({
            id,
            name,
            language: str(t.language) ?? "",
            category: str(t.category) ?? "UNKNOWN",
            status: str(t.status) ?? "UNKNOWN",
            components: Array.isArray(t.components) ? t.components : [],
            rejectedReason: str(t.rejected_reason),
            qualityScore: str(asRecord(t.quality_score).score),
          });
        }
        const next = asRecord(body.paging).next;
        // Meta echoes the token back in the cursor; we supply it as a header.
        url = typeof next === "string" && next ? stripToken(next) : null;
      }
      return out;
    },

    async createTemplate(input: CreateTemplateInput, signal?: AbortSignal): Promise<CreateTemplateResult> {
      const body = asRecord(
        await postJson(
          `${base}/${cfg.wabaId}/message_templates`,
          token,
          {
            name: input.name,
            language: input.language,
            category: input.category,
            components: input.components,
            allow_category_change: input.allowCategoryChange ?? true,
          },
          signal,
        ),
      );
      return { id: str(body.id) ?? "", status: str(body.status) ?? "PENDING", category: str(body.category) ?? input.category };
    },

    async deleteTemplate(name: string, signal?: AbortSignal): Promise<void> {
      await deleteJson(`${base}/${cfg.wabaId}/message_templates?name=${encodeURIComponent(name)}`, token, signal);
    },

    /** Step 1 of the resumable upload: open a session, get its id. */
    async createUploadSession(
      input: { fileLength: number; fileType: string; fileName: string },
      signal?: AbortSignal,
    ): Promise<string> {
      const q = new URLSearchParams({
        file_length: String(input.fileLength),
        file_type: input.fileType,
        file_name: input.fileName,
      });
      const body = asRecord(await postJson(`${base}/${cfg.appId}/uploads?${q}`, token, {}, signal));
      const id = str(body.id);
      if (!id) throw new WhatsAppApiError("Upload session returned no id", { httpStatus: 200 });
      return id;
    },

    /** Step 2: push the bytes; the returned handle goes into a template's header example. */
    async uploadChunk(
      input: { sessionId: string; bytes: Uint8Array; offset?: number },
      signal?: AbortSignal,
    ): Promise<string> {
      const body = asRecord(await postBinary(`${base}/${input.sessionId}`, token, input.bytes, input.offset ?? 0, signal));
      const handle = str(body.h);
      if (!handle) throw new WhatsAppApiError("Upload returned no handle", { httpStatus: 200 });
      return handle;
    },

    async subscribeApp(signal?: AbortSignal): Promise<void> {
      await postJson(`${base}/${cfg.wabaId}/subscribed_apps`, token, {}, signal);
    },

    async getSubscribedApps(signal?: AbortSignal): Promise<string[]> {
      const body = asRecord(await getJson(`${base}/${cfg.wabaId}/subscribed_apps`, token, signal));
      const data = Array.isArray(body.data) ? body.data : [];
      return data
        .map((d) => str(asRecord(asRecord(d).whatsapp_business_api_data).id))
        .filter((id): id is string => id !== null);
    },
  };
}

export type WhatsAppClient = ReturnType<typeof createWhatsAppClient>;
