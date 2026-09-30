/**
 * Binding variable NAMES to Meta's POSITIONS, and the values that fill them.
 *
 * Values are always resolved server-side from the order / lead / product —
 * the browser never supplies them, so a composer cannot be talked into
 * sending another customer's data.
 */
import type { TemplatePart, TemplateVariable, VariableValues } from "./types";

const PLACEHOLDER = /\{\{(\d+)\}\}/g;
const MISSING = "—";
/** Meta rejects newlines/tabs and >1024 chars inside a body parameter. */
const PARAM_MAX = 1024;

/** The `{text, variable}` runs the WhatsApp sheet already highlights. */
export function previewParts(bodyText: string, variables: readonly TemplateVariable[], values: VariableValues): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let last = 0;
  for (const m of bodyText.matchAll(PLACEHOLDER)) {
    const idx = m.index ?? 0;
    if (idx > last) parts.push({ text: bodyText.slice(last, idx), variable: false });
    const name = variables[Number(m[1]) - 1];
    const value = name ? values[name] : undefined;
    parts.push({ text: value && value.trim() ? value : MISSING, variable: true });
    last = idx + m[0].length;
  }
  if (last < bodyText.length) parts.push({ text: bodyText.slice(last), variable: false });
  if (parts.length === 0) parts.push({ text: "", variable: false });
  return parts;
}

export function bodyToText(bodyText: string, variables: readonly TemplateVariable[], values: VariableValues): string {
  return previewParts(bodyText, variables, values).map((p) => p.text).join("");
}

function cleanParameter(v: string | undefined): string {
  const flat = (v ?? "").replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();
  const text = flat || MISSING;
  return text.length > PARAM_MAX ? text.slice(0, PARAM_MAX) : text;
}

/** Positional body parameters in the template's variable order. */
export function toBodyParameters(variables: readonly TemplateVariable[], values: VariableValues): string[] {
  return variables.map((name) => cleanParameter(values[name]));
}

/** "89 TND", "150.5 LYD" — the customer's own currency, no locale grouping. */
export function formatAmount(amount: number | string | null | undefined, currency: string | null | undefined): string {
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (n === null || n === undefined || !Number.isFinite(n)) return MISSING;
  const num = Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000);
  return `${num} ${(currency ?? "").toUpperCase() || ""}`.trim();
}

/**
 * The name the greeting uses: the first name, as a person would write
 * (« مرحباً محمود », « Bonjour Amel »). Prototype: whatsapp-agent-v1.html
 * `varsFor`.
 */
export function greetingName(fullName: string | null | undefined): string {
  const name = (fullName ?? "").trim().replace(/\s+/g, " ");
  if (!name) return MISSING;
  return name.split(" ")[0];
}

/** How an Arabic message writes each currency. */
const CURRENCY_AR: Record<string, string> = { TND: "د.ت", LYD: "د.ل" };
/** Carriers whose Arabic name the customer knows them by. */
const CARRIER_AR: { match: RegExp; ar: string }[] = [{ match: /darb/i, ar: "درب السبيل" }];

/**
 * The values as the TEMPLATE's language writes them. Resolvers are
 * language-blind ("249 LYD", "Darb Assabil"); an Arabic message says
 * « 249 د.ل » and « درب السبيل ». Applied on the server before sending and
 * in the composer before previewing, so the preview is what is sent.
 */
export function localizeVariables<T extends VariableValues>(values: T, language: string | null | undefined): T {
  if (language !== "ar") return values;
  const out: VariableValues = { ...values };
  const amount = values.amount;
  if (amount) {
    out.amount = amount.replace(/\b(TND|LYD)$/i, (code) => CURRENCY_AR[code.toUpperCase()] ?? code);
  }
  const carrier = values.carrier;
  if (carrier) {
    const hit = CARRIER_AR.find((c) => c.match.test(carrier));
    if (hit) out.carrier = hit.ar;
  }
  return out as T;
}

export interface OrderForVariables {
  order_number?: string | null;
  customer_name: string | null;
  customer_address?: string | null;
  customer_city?: string | null;
  product_name?: string | null;
  total_price: number | string | null;
  currency?: string | null;
  tracking_number?: string | null;
  carrier_name?: string | null;
  courier_name?: string | null;
  agent_name?: string | null;
}

export function resolveOrderVariables(order: OrderForVariables): Record<TemplateVariable, string> {
  const or = (v: string | null | undefined) => (v && v.trim() ? v.trim() : MISSING);
  return {
    name: greetingName(order.customer_name),
    order_ref: or(order.order_number),
    carrier: or(order.carrier_name),
    tracking: or(order.tracking_number),
    amount: formatAmount(order.total_price, order.currency),
    product: or(order.product_name),
    city: or(order.customer_city),
    address: or(order.customer_address),
    courier: or(order.courier_name),
    agent: or(order.agent_name),
    discount: MISSING,
  };
}

export interface LeadForVariables {
  customer_name: string | null;
  customer_city?: string | null;
  product_name?: string | null;
  offer?: string | null;
  agent_name?: string | null;
}

export function resolveLeadVariables(lead: LeadForVariables): Record<TemplateVariable, string> {
  const or = (v: string | null | undefined) => (v && v.trim() ? v.trim() : MISSING);
  return {
    name: greetingName(lead.customer_name),
    order_ref: MISSING,
    carrier: MISSING,
    tracking: MISSING,
    amount: MISSING,
    product: or(lead.product_name),
    city: or(lead.customer_city),
    address: MISSING,
    courier: MISSING,
    agent: or(lead.agent_name),
    discount: or(lead.offer),
  };
}

export interface ProductForVariables {
  name: string | null;
  price: number | string | null;
  currency?: string | null;
}

export function resolveProductVariables(product: ProductForVariables, customerName: string | null): Record<TemplateVariable, string> {
  return {
    name: greetingName(customerName),
    order_ref: MISSING,
    carrier: MISSING,
    tracking: MISSING,
    amount: formatAmount(product.price, product.currency),
    product: product.name && product.name.trim() ? product.name.trim() : MISSING,
    city: MISSING,
    address: MISSING,
    courier: MISSING,
    agent: MISSING,
    discount: MISSING,
  };
}
