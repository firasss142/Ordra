import { CREATABLE_LEAD_SOURCES, type LeadSource } from "@/types/lead";

export interface ParsedCsvRow {
  customer_name: string;
  customer_phone: string;
  source: LeadSource;
  customer_city: string | null;
  customer_address: string | null;
  product_interest_note: string | null;
  notes: string | null;
  lineNumber: number;
  error: string | null;
}

const REQUIRED_HEADERS = ["customer_name", "customer_phone", "source"] as const;

/**
 * Minimal CSV parser — supports quoted fields with embedded commas and
 * double-quote escaping (RFC 4180 subset). Returns rows keyed by header.
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      continue;
    }
    if (c === ",") {
      cur.push(field);
      field = "";
      continue;
    }
    if (c === "\r") continue;
    if (c === "\n") {
      cur.push(field);
      rows.push(cur);
      cur = [];
      field = "";
      continue;
    }
    field += c;
  }
  if (field.length > 0 || cur.length > 0) {
    cur.push(field);
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

export interface CsvValidationResult {
  ok: boolean;
  error: string | null;
  rows: ParsedCsvRow[];
}

export function parseLeadCsv(text: string): CsvValidationResult {
  const raw = parseCsv(text);
  if (raw.length === 0) {
    return { ok: false, error: "empty", rows: [] };
  }
  const headers = raw[0].map((h) => h.trim().toLowerCase());
  for (const req of REQUIRED_HEADERS) {
    if (!headers.includes(req)) {
      return { ok: false, error: "headers", rows: [] };
    }
  }

  const idx = (key: string) => headers.indexOf(key);
  const rows: ParsedCsvRow[] = [];

  for (let i = 1; i < raw.length; i++) {
    const r = raw[i];
    const get = (k: string) => {
      const j = idx(k);
      if (j < 0 || j >= r.length) return "";
      return (r[j] ?? "").trim();
    };

    const customer_name = get("customer_name");
    const customer_phone = get("customer_phone");
    const source = get("source");

    let error: string | null = null;
    if (!customer_name) error = "customer_name missing";
    else if (!customer_phone) error = "customer_phone missing";
    else if (!source) error = "source missing";
    else if (!CREATABLE_LEAD_SOURCES.includes(source as Exclude<LeadSource, "campaign">))
      error = `invalid source: ${source}`;

    rows.push({
      customer_name,
      customer_phone,
      source: (source as LeadSource) || "other",
      customer_city: get("customer_city") || null,
      customer_address: get("customer_address") || null,
      product_interest_note: get("product_interest_note") || null,
      notes: get("notes") || null,
      lineNumber: i + 1,
      error,
    });
  }

  return { ok: true, error: null, rows };
}
