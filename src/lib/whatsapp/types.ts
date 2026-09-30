/**
 * Shared vocabulary of the WhatsApp module. Kept free of imports so both the
 * server modules and the client components can use it.
 */

/** The customer's language — never the agent's interface locale. */
export type CustomerLang = "ar" | "fr";

/**
 * Closed union of what a template body may ask for. Meta binds by position
 * ({{1}}..{{n}}); Ordra binds by NAME through `whatsapp_templates.variables`,
 * and the renderer is where the two meet.
 */
export type TemplateVariable =
  | "name"
  | "order_ref"
  | "carrier"
  | "tracking"
  | "amount"
  | "product"
  | "city"
  | "address"
  | "discount"
  | "agent"
  | "courier";

export const TEMPLATE_VARIABLES: readonly TemplateVariable[] = [
  "name",
  "order_ref",
  "carrier",
  "tracking",
  "amount",
  "product",
  "city",
  "address",
  "discount",
  "agent",
  "courier",
];

export function isTemplateVariable(v: unknown): v is TemplateVariable {
  return typeof v === "string" && (TEMPLATE_VARIABLES as readonly string[]).includes(v);
}

/** Lifecycle events a template can serve. Each is a per-market toggle. */
export type LifecycleEventKey =
  | "could_not_reach"
  | "shipped"
  | "out_for_delivery"
  | "last_chance"
  | "delivered";

export const LIFECYCLE_EVENT_KEYS: readonly LifecycleEventKey[] = [
  "could_not_reach",
  "shipped",
  "out_for_delivery",
  "last_chance",
  "delivered",
];

export function isLifecycleEventKey(v: unknown): v is LifecycleEventKey {
  return typeof v === "string" && (LIFECYCLE_EVENT_KEYS as readonly string[]).includes(v);
}

export type TemplateCategory = "UTILITY" | "MARKETING" | "AUTHENTICATION";

export type TemplateStatus =
  | "DRAFT"
  | "PENDING"
  | "APPROVED"
  | "REJECTED"
  | "PAUSED"
  | "DISABLED"
  | "DELETED"
  | "UNKNOWN";

export type ConfigStatus = "active" | "paused" | "auth_failed";

export type MessageStatus = "received" | "queued" | "sent" | "delivered" | "read" | "failed";

export type MessageDirection = "in" | "out";

export type ActorType = "agent" | "manager" | "system" | "campaign" | "customer";

/** A run of message text; `variable` runs are highlighted in the composer. */
export interface TemplatePart {
  text: string;
  variable: boolean;
}

/** Values bound to variable names for one render. */
export type VariableValues = Partial<Record<TemplateVariable, string>>;
