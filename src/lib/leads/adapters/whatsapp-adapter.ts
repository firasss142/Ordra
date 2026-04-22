import type {
  InternalLeadData,
  LeadEventType,
  LeadSourceAdapter,
} from "./types";

/**
 * STUB — WhatsApp Business API lead adapter. Schema-ready, implementation deferred.
 */
export class WhatsAppAdapter implements LeadSourceAdapter {
  readonly platform = "whatsapp";

  validateWebhook(): boolean {
    throw new Error("WhatsAppAdapter.validateWebhook not implemented");
  }

  parseEventType(): LeadEventType {
    throw new Error("WhatsAppAdapter.parseEventType not implemented");
  }

  mapToInternalLead(): InternalLeadData {
    throw new Error("WhatsAppAdapter.mapToInternalLead not implemented");
  }
}
