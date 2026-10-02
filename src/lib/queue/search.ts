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

/** Lowercase, strip accents and tashkeel, fold the Arabic letters written two ways. */
function fold(s: string): string {
  return s
    .normalize("NFKD")
    // Strip combining marks: Latin accents AND Arabic harakat (U+064B–U+065F, U+0670).
    .replace(/[\u0300-\u036f\u064b-\u065f\u0670]/g, "")
    // NFKD already turned the hamza alefs (and the hamza waw / yeh) into the
    // bare letter: the hamza is a combining mark, dropped above. Ta marbuta
    // (U+0629) and alef maqsura (U+0649) do not decompose, so they are mapped to
    // heh and yeh here \u2014 the same groups as lib/orders/search-query's
    // FOLD_GROUPS, so this matcher and the server's agree on a name.
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0649/g, "\u064a")
    .toLowerCase();
}

/** lowercase, strip accents/diacritics (Latin + Arabic tashkeel), collapse spaces. */
export function normalize(s: string): string {
  if (!s) return "";
  return fold(s).replace(/\s+/g, " ").trim();
}

/**
 * One character, folded exactly as `normalize` folds it — possibly to "" (a
 * standalone mark) or to more than one character. Lets a highlighter map a
 * match in the folded text back onto the text as written.
 */
export function foldChar(c: string): string {
  return /\s/.test(c) ? " " : fold(c);
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
