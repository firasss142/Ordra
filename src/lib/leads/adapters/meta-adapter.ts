import type {
  InternalLeadData,
  LeadEventType,
  LeadSourceAdapter,
} from "./types";

/**
 * STUB — Meta (Facebook/Instagram) lead adapter.
 * Schema shape documented here, implementation deferred.
 * Webhook route /api/webhooks/meta/[sourceId] returns 501 until this is built.
 */
export class MetaAdapter implements LeadSourceAdapter {
  readonly platform = "meta";

  validateWebhook(): boolean {
    throw new Error("MetaAdapter.validateWebhook not implemented");
  }

  parseEventType(): LeadEventType {
    throw new Error("MetaAdapter.parseEventType not implemented");
  }

  mapToInternalLead(): InternalLeadData {
    throw new Error("MetaAdapter.mapToInternalLead not implemented");
  }
}
