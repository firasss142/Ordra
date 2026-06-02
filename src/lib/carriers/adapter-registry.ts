import type { CarrierAdapter } from "./types";
import { NavexAdapter } from "./navex-adapter";
import { DexpressAdapter } from "./dexpress/adapter";
import { DarbAssabilAdapter } from "./darb-assabil-adapter";

export type CarrierCode = "navex" | "dexpress" | "darb_assabil";

const adapters: Record<CarrierCode, () => CarrierAdapter> = {
  navex: () => new NavexAdapter(),
  dexpress: () => new DexpressAdapter(),
  darb_assabil: () => new DarbAssabilAdapter(),
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
  /**
   * Input rendering hint. "text" (default) renders a text/password input.
   * "switch" renders an on/off toggle storing "1" (on) / "0" (off).
   */
  type?: "text" | "switch";
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
      {
        key: "cost_type",
        label: "Frais de livraison à la charge du client",
        secret: false,
        type: "switch",
      },
    ],
    markets: ["ly"],
  },
  darb_assabil: {
    code: "darb_assabil",
    label: "Darb Assabil",
    description:
      "Intégration Darb Assabil (Libye). Authentification par clé API + ID de compte.",
    defaultEndpoint: "https://v2.sabil.ly",
    credentialFields: [
      { key: "api_key", label: "Clé API", secret: true },
      {
        key: "account_id",
        label: "ID de compte (X-ACCOUNT-ID)",
        placeholder: "692637b42f63874515cebd63",
        secret: false,
      },
      {
        key: "default_service_id",
        label: "ID du service par défaut (livreur homme)",
        placeholder: "6783c612dcf305c9e775c987",
        secret: false,
      },
      {
        key: "payment_by",
        label: "Frais de livraison inclus dans le prix",
        secret: false,
        type: "switch",
      },
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
