import type { LeadSourceAdapter } from "./types";
import { ManualAdapter } from "./manual-adapter";
import { MetaAdapter } from "./meta-adapter";
import { WhatsAppAdapter } from "./whatsapp-adapter";

const adapters: Record<string, () => LeadSourceAdapter> = {
  manual: () => new ManualAdapter(),
  meta: () => new MetaAdapter(),
  whatsapp: () => new WhatsAppAdapter(),
};

export function getLeadAdapter(platform: string): LeadSourceAdapter {
  const factory = adapters[platform];
  if (!factory) {
    throw new Error(`Unknown lead platform: ${platform}`);
  }
  return factory();
}

export type { LeadSourceAdapter, InternalLeadData, LeadEventType } from "./types";
