/** Meta webhook payloads, in the shapes documented for the Cloud API (v26.0). */

export const WABA = "444555666";
export const PNID = "111222333";

const value = (extra: Record<string, unknown>) => ({
  messaging_product: "whatsapp",
  metadata: { display_phone_number: "21629000000", phone_number_id: PNID },
  ...extra,
});

export const entry = (field: string, v: Record<string, unknown>, wabaId = WABA) => ({
  object: "whatsapp_business_account",
  entry: [{ id: wabaId, changes: [{ field, value: v }] }],
});

export const textMessage = (over: Partial<{ from: string; id: string; body: string; name: string; timestamp: string }> = {}) =>
  entry("messages", value({
    contacts: [{ profile: { name: over.name ?? "Amel" }, wa_id: over.from ?? "21698765432" }],
    messages: [
      {
        from: over.from ?? "21698765432",
        id: over.id ?? "wamid.IN1",
        timestamp: over.timestamp ?? "1758800000",
        type: "text",
        text: { body: over.body ?? "Oui c'est bon" },
      },
    ],
  }));

export const imageMessage = entry("messages", value({
  contacts: [{ profile: { name: "Amel" }, wa_id: "21698765432" }],
  messages: [
    {
      from: "21698765432",
      id: "wamid.IMG1",
      timestamp: "1758800100",
      type: "image",
      image: { id: "media-9", mime_type: "image/jpeg", sha256: "abc", caption: "voilà" },
      context: { from: "21629000000", id: "wamid.OUT1" },
    },
  ],
}));

export const unsupportedMessage = entry("messages", value({
  contacts: [{ profile: { name: "Amel" }, wa_id: "21698765432" }],
  messages: [
    {
      from: "21698765432",
      id: "wamid.UNS1",
      timestamp: "1758800200",
      type: "unsupported",
      errors: [{ code: 131051, title: "Message type unknown", message: "Message type is currently not supported." }],
    },
  ],
}));

export const reactionMessage = entry("messages", value({
  contacts: [{ profile: { name: "Amel" }, wa_id: "21698765432" }],
  messages: [
    { from: "21698765432", id: "wamid.REACT1", timestamp: "1758800300", type: "reaction", reaction: { message_id: "wamid.OUT1", emoji: "👍" } },
  ],
}));

export const statusEvent = (
  status: "sent" | "delivered" | "read" | "failed",
  over: Partial<{ id: string; timestamp: string; errors: unknown[] }> = {},
) =>
  entry("messages", value({
    statuses: [
      {
        id: over.id ?? "wamid.OUT1",
        status,
        timestamp: over.timestamp ?? "1758800400",
        recipient_id: "21698765432",
        ...(status === "sent"
          ? {
              conversation: { id: "conv-meta-1", origin: { type: "utility" }, expiration_timestamp: "1758886800" },
              pricing: { billable: true, pricing_model: "PMP", category: "utility" },
            }
          : {}),
        ...(over.errors ? { errors: over.errors } : {}),
      },
    ],
  }));

export const failed131026 = statusEvent("failed", {
  errors: [{ code: 131026, title: "Message undeliverable", message: "Message Undeliverable.", error_data: { details: "Message Undeliverable." } }],
});

export const templateStatus = (event: string, over: Partial<{ id: string; name: string; language: string; reason: string | null }> = {}) =>
  entry("message_template_status_update", {
    event,
    message_template_id: over.id ?? "tpl-meta-1",
    message_template_name: over.name ?? "ordra_shipped_v1",
    message_template_language: over.language ?? "fr",
    reason: over.reason ?? null,
  });

export const qualityUpdate = (event: string, currentLimit = "TIER_1K") =>
  entry("phone_number_quality_update", {
    display_phone_number: "21629000000",
    event,
    current_limit: currentLimit,
    old_limit: "TIER_250",
  });

export const accountUpdate = (event: string) =>
  entry("account_update", { phone_number: "21629000000", event });

export const mixed = {
  object: "whatsapp_business_account",
  entry: [
    { id: WABA, changes: [{ field: "messages", value: value({ statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1758800400", recipient_id: "21698765432" }] }) }] },
    { id: WABA, changes: [{ field: "messages", value: value({ contacts: [{ profile: { name: "Amel" }, wa_id: "21698765432" }], messages: [{ from: "21698765432", id: "wamid.IN2", timestamp: "1758800500", type: "text", text: { body: "STOP" } }] }) }] },
    { id: "999", changes: [{ field: "something_new", value: { foo: 1 } }] },
  ],
};
