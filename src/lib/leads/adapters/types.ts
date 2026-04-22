import type { LeadSource } from "@/types/lead";

export interface InternalLeadData {
  source: LeadSource;
  source_external_id: string | null;
  source_platform: string | null;
  customer_name: string;
  customer_phone: string;
  customer_city: string | null;
  customer_address: string | null;
  product_interest_note: string | null;
  notes: string | null;
  raw_payload: Record<string, unknown>;
}

export type LeadEventType =
  | "lead.created"
  | "lead.updated"
  | "unknown";

export interface LeadSourceAdapter {
  readonly platform: string;
  validateWebhook(
    rawBody: string,
    headers: Record<string, string | string[] | undefined>,
    secret: string
  ): boolean;
  parseEventType(payload: unknown): LeadEventType;
  mapToInternalLead(payload: unknown): InternalLeadData;
}
