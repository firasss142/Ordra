import type {
  InternalLeadData,
  LeadEventType,
  LeadSourceAdapter,
} from "./types";
import type { LeadSource } from "@/types/lead";
import { CREATABLE_LEAD_SOURCES } from "@/types/lead";

// Manual adapter: for leads entered directly by agents/managers.
// No webhook validation needed; "mapping" is identity-ish.
export class ManualAdapter implements LeadSourceAdapter {
  readonly platform = "manual";

  validateWebhook(): boolean {
    // Manual entries never come from a webhook.
    return false;
  }

  parseEventType(): LeadEventType {
    return "lead.created";
  }

  mapToInternalLead(payload: unknown): InternalLeadData {
    const p = (payload ?? {}) as Record<string, unknown>;
    const source = (p.source as string) ?? "manual_call";
    if (!CREATABLE_LEAD_SOURCES.includes(source as Exclude<LeadSource, "campaign">)) {
      throw new Error(`Invalid source: ${source}`);
    }
    if (!p.customer_name || !p.customer_phone) {
      throw new Error("customer_name and customer_phone are required");
    }
    return {
      source: source as LeadSource,
      source_external_id: null,
      source_platform: "manual",
      customer_name: p.customer_name as string,
      customer_phone: p.customer_phone as string,
      customer_city: (p.customer_city as string) ?? null,
      customer_address: (p.customer_address as string) ?? null,
      product_interest_note: (p.product_interest_note as string) ?? null,
      notes: (p.notes as string) ?? null,
      raw_payload: p,
    };
  }
}
