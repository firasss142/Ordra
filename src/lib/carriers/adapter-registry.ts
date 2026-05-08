import type { CarrierAdapter } from "./types";
import { NavexAdapter } from "./navex-adapter";
import { DexpressAdapter } from "./dexpress/adapter";

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
  markets: string[];
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
    markets: ["tn"],
  },
  dexpress: {
    code: "dexpress",
    label: "Dexpress",
    description:
      "Intégration Dexpress (Libye). Authentification par compte marchand sur le portail.",
    defaultEndpoint: "https://portal.dexpress.ly",
    credentialFields: [
      { key: "email", label: "Email du compte marchand", secret: false },
      { key: "password", label: "Mot de passe", secret: true },
      { key: "merchant_id", label: "ID marchand", placeholder: "807", secret: false },
      { key: "from_state", label: "État d'origine (ID)", placeholder: "62", secret: false },
    ],
    markets: ["ly"],
  },
};

export function listAdapterDescriptors(
  marketCode?: string
): AdapterDescriptor[] {
  const all = Object.values(ADAPTER_DESCRIPTORS);
  if (!marketCode) return all;
  return all.filter((d) => supportsMarketCode(d, marketCode));
}

export function getAdapterDescriptor(
  code: string
): AdapterDescriptor | null {
  return ADAPTER_DESCRIPTORS[code] ?? null;
}

export function adapterSupportsMarket(
  code: string,
  marketCode: string
): boolean {
  const descriptor = ADAPTER_DESCRIPTORS[code];
  return descriptor ? supportsMarketCode(descriptor, marketCode) : false;
}

function supportsMarketCode(
  descriptor: AdapterDescriptor,
  marketCode: string
): boolean {
  return descriptor.markets.includes(marketCode.toLowerCase());
}

export const CUSTOM_ADAPTER_LABEL = "Personnalisé";
