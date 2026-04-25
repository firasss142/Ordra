import type { CarrierAdapter } from "./types";
import { NavexAdapter } from "./navex-adapter";
import { DexpressAdapter } from "./dexpress-adapter";

export type CarrierCode = "navex" | "dexpress";

const adapters: Record<CarrierCode, () => CarrierAdapter> = {
  navex: () => new NavexAdapter(),
  dexpress: () => new DexpressAdapter(),
};

export function getCarrierAdapter(carrierCode: string): CarrierAdapter {
  const factory = adapters[carrierCode as CarrierCode];
  if (!factory) {
    throw new Error(`Unknown carrier code: ${carrierCode}`);
  }
  return factory();
}

export function hasCarrierAdapter(carrierCode: string): carrierCode is CarrierCode {
  return Object.prototype.hasOwnProperty.call(adapters, carrierCode);
}

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
}

export interface AdapterDescriptor {
  code: string;
  label: string;
  description: string;
  defaultEndpoint?: string;
  credentialFields: CredentialField[];
}

const ADAPTER_DESCRIPTORS: Record<string, AdapterDescriptor> = {
  navex: {
    code: "navex",
    label: "Navex",
    description: "Intégration Navex (Tunisie). Dispatch via token + expéditeur.",
    defaultEndpoint: "https://app.navex.tn/api",
    credentialFields: [
      { key: "token", label: "Token API", secret: true },
      { key: "sender_name", label: "Nom expéditeur", secret: false },
      { key: "sender_location", label: "Localité expéditeur", secret: false },
    ],
  },
  dexpress: {
    code: "dexpress",
    label: "DExpress",
    description: "Intégration DExpress (Libye). Bearer auth + create-order.",
    defaultEndpoint: "https://api.dexpress.ly",
    credentialFields: [
      { key: "api_base_url", label: "URL de base API", secret: false },
      { key: "api_key", label: "Clé API", secret: true },
    ],
  },
};

export function listAdapterDescriptors(): AdapterDescriptor[] {
  return Object.values(ADAPTER_DESCRIPTORS);
}

export function getAdapterDescriptor(
  code: string
): AdapterDescriptor | null {
  return ADAPTER_DESCRIPTORS[code] ?? null;
}

export const CUSTOM_ADAPTER_LABEL = "Personnalisé";
