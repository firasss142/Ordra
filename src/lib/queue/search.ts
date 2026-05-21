import type { QueueOrder } from "@/types/queue";

export type SearchField = "name" | "phone" | "city" | "product" | "note";

export interface ParsedQuery {
  /** Set when the user typed a field prefix like "phone:…" / "city:…". */
  field: SearchField | null;
  /** Whitespace-split, normalized tokens (AND-matched). */
  terms: string[];
  /** Original, untouched input. */
  raw: string;
}

/**
 * Field-prefix keywords. ASCII-only and locale-independent so agents on either
 * the FR or AR interface type the same thing. Aliases let "tel:" hit phone, etc.
 */
const FIELD_PREFIXES: Record<string, SearchField> = {
  name: "name",
  nom: "name",
  phone: "phone",
  tel: "phone",
  tél: "phone",
  city: "city",
  ville: "city",
  product: "product",
  produit: "product",
  note: "note",
};

/** lowercase, strip accents/diacritics (Latin + Arabic tashkeel), collapse spaces. */
export function normalize(s: string): string {
  if (!s) return "";
  return s
    .normalize("NFKD")
    // Strip combining marks: Latin accents AND Arabic harakat (U+064B–U+065F, U+0670).
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Reduce a phone-ish string to bare digits so formatting never breaks a match. */
export function digitsOnly(s: string): string {
  return (s ?? "").replace(/\D/g, "");
}

export function parseQuery(input: string): ParsedQuery {
  const raw = input ?? "";
  const trimmed = raw.trim();
  if (!trimmed) return { field: null, terms: [], raw };

  const colon = trimmed.indexOf(":");
  if (colon > 0) {
    const prefix = trimmed.slice(0, colon).toLowerCase();
    const field = FIELD_PREFIXES[prefix];
    if (field) {
      const rest = trimmed.slice(colon + 1).trim();
      if (field === "phone") {
        // Keep the remainder as a single term; phone matching uses digitsOnly.
        return { field, terms: rest ? [rest] : [], raw };
      }
      return { field, terms: rest ? normalize(rest).split(" ").filter(Boolean) : [], raw };
    }
  }

  return { field: null, terms: normalize(trimmed).split(" ").filter(Boolean), raw };
}

function textFieldsFor(order: QueueOrder, field: SearchField | null): string[] {
  switch (field) {
    case "name":
      return [order.customer_name];
    case "city":
      return [order.customer_city];
    case "product":
      return [order.product_name];
    case "note":
      return [order.customer_note ?? ""];
    case "phone":
      return []; // handled separately
    default:
      return [
        order.customer_name,
        order.customer_city,
        order.product_name,
        order.customer_note ?? "",
      ];
  }
}

function phoneHaystack(order: QueueOrder, field: SearchField | null): string {
  if (field && field !== "phone") return "";
  return digitsOnly(order.customer_phone) + " " + digitsOnly(order.customer_phone_2 ?? "");
}

export function matchesOrder(order: QueueOrder, q: ParsedQuery): boolean {
  if (q.terms.length === 0) return true;

  if (q.field === "phone") {
    const needle = digitsOnly(q.terms.join(""));
    if (!needle) return false;
    return phoneHaystack(order, "phone").includes(needle);
  }

  const textHay = normalize(textFieldsFor(order, q.field).join(" "));
  const phoneHay = phoneHaystack(order, q.field);

  // AND across terms: each term must match some field. A term matches if it's a
  // substring of the normalized text OR (for free-text search) its digits match
  // the phone haystack.
  return q.terms.every((term) => {
    if (textHay.includes(term)) return true;
    if (q.field === null) {
      const digits = digitsOnly(term);
      if (digits && phoneHay.includes(digits)) return true;
    }
    return false;
  });
}

/**
 * Filter orders by a raw query string. A blank query returns the SAME array
 * reference (caller can use this to decide whether search is active).
 */
export function searchOrders(orders: QueueOrder[], raw: string): QueueOrder[] {
  if (!raw || !raw.trim()) return orders;
  const q = parseQuery(raw);
  if (q.terms.length === 0) return orders;
  return orders.filter((o) => matchesOrder(o, q));
}
