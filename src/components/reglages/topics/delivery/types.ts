/** Shapes read by Réglages › Livraison (see the carriers API routes). */

export interface CarrierRow {
  id: string;
  market_id: string;
  name: string;
  code: string;
  delivery_fee: number;
  return_fee: number;
  is_active: boolean;
  /** Uploaded logo (public URL); null = the brand file, else the truck. */
  logo_url?: string | null;
  warehouse_id: string | null;
}

export interface SiteRow {
  id: string;
  nameFr: string;
  nameAr: string;
  isDefault: boolean;
  isActive: boolean;
}

export interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
  type?: "text" | "switch";
}

export interface AdapterDescriptor {
  code: string;
  label: string;
  defaultEndpoint?: string;
  credentialFields: CredentialField[];
}

export const ORDER_OPTIONS = [
  "is_pickup",
  "allow_inspection",
  "is_fragile",
  "allow_card_payment",
  "allow_testing",
  "is_replacement",
] as const;
export type OrderOption = (typeof ORDER_OPTIONS)[number];
export type Preferences = Record<OrderOption, { value: boolean; canOverride: boolean }>;

/** Credential fields with a translated label; any other falls back to the adapter's own. */
export const KNOWN_CREDENTIALS: ReadonlySet<string> = new Set([
  "token",
  "sender_name",
  "sender_location",
  "email",
  "password",
  "merchant_id",
  "from_state",
  "cost_type",
  "api_key",
  "account_id",
  "default_service_id",
]);
