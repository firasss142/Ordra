import { DARB_ZONE_ORDER, zoneLabels } from "@/lib/carriers/darb-zones";
import { resolveGovernorate } from "@/lib/carriers/governorates";
import type { OrderLine, WarehouseOrderRow } from "./summary";
import type { OrderZone } from "./zone-index";

/**
 * How a scan run is cut into batches.
 *
 * The agent's hands do one physical thing at a time: hold ONE sticker roll, or
 * stand at ONE rack. A run therefore asks which of the two, then hands over the
 * parcels that share it, one after another, so nothing is put down and picked
 * up again. That is the whole idea; everything below serves it.
 *
 * THE MIXED PARCEL IS ITS OWN BATCH. An order carrying three different products
 * belongs to no product rack. Filing it under its first line is how a picker
 * walks off with one item of a three-item parcel — and by then the sticker is on
 * the box and Darb is holding the number. So mixed parcels are pulled out, given
 * a batch of their own, and put LAST, because they are the slow careful ones.
 *
 * THE COLOUR ORDER IS DARB'S. `DARB_ZONE_ORDER` is the printed poster's order,
 * Tripoli outward; the agent's eye learns the positions. Sorting the rolls by
 * parcel count would move them every morning. Unknown always ends the list: it
 * is the batch that needs a human decision about the destination, not the one to
 * open with.
 */

export type RunMode = "product" | "zone";

export type { OrderLine };

/** A queue row as the run sees it: the bench row plus its resolved roll. */
export type RunRow = WarehouseOrderRow & { zone: OrderZone };

export type BucketKind = "product" | "mixed" | "zone" | "zone_unknown";

export interface Bucket {
  /** Stable across revalidations, so a running batch survives a refetch. */
  key: string;
  kind: BucketKind;
  /** What the agent reaches for: a product name, or a colour name. */
  label: string;
  /** The second line: the region for a roll, the variant count for a product. */
  sublabel: string | null;
  /** Darb's published hex, unmodified. Null outside Libya and when unknown. */
  hex: string | null;
  /** Darb's branch code, for the white plate. Never rendered on the hue. */
  branchGroup: string | null;
  imageUrl: string | null;
  /** Units across the batch — what the picker carries, not how many parcels. */
  units: number;
  /** When the oldest parcel of the batch reached the bench. */
  oldestAt: string | null;
  rows: RunRow[];
}

/** When the parcel reached the BENCH. Intake is a different, older clock. */
function benchAt(row: RunRow): string {
  return row.uploaded_at ?? row.created_at;
}

/**
 * Every product line of a parcel.
 *
 * `order_items` is the truth when the order has rows there; orders predating it
 * (and every Tunisian one) carry a single denormalised line on `orders` itself.
 * Both shapes come back as the same list, so no caller has to know which era an
 * order belongs to.
 */
export function linesOf(row: RunRow): OrderLine[] {
  const items = row.items ?? [];
  if (items.length > 0) return items;
  return [
    {
      product_id: row.product_id,
      product_name: row.product_name,
      variant_label: row.variant_label,
      quantity: row.quantity,
      image_url: row.product_image_url ?? null,
    },
  ];
}

/** Two sizes of the same product is one rack; two products is a mixed parcel. */
export function isMixed(row: RunRow): boolean {
  const lines = linesOf(row);
  if (lines.length < 2) return false;
  const keys = new Set(lines.map((l) => l.product_id ?? l.product_name));
  return keys.size > 1;
}

function unitsOf(row: RunRow): number {
  return linesOf(row).reduce((n, l) => n + (l.quantity ?? 0), 0);
}

function finish(bucket: Bucket): Bucket {
  const rows = [...bucket.rows].sort((a, b) => benchAt(a).localeCompare(benchAt(b)));
  return {
    ...bucket,
    rows,
    units: rows.reduce((n, r) => n + unitsOf(r), 0),
    oldestAt: rows.length > 0 ? benchAt(rows[0]) : null,
    imageUrl: bucket.imageUrl ?? rows.map((r) => r.product_image_url ?? null).find(Boolean) ?? null,
  };
}

function byProduct(rows: RunRow[]): Bucket[] {
  const plain = new Map<string, Bucket>();
  const mixedRows: RunRow[] = [];

  for (const row of rows) {
    if (isMixed(row)) {
      mixedRows.push(row);
      continue;
    }
    const [line] = linesOf(row);
    // A product without an id is grouped by its name: merging every uncoded
    // product into one batch would send the picker to a rack that does not exist.
    const key = line.product_id ?? `name:${line.product_name}`;
    const existing = plain.get(key);
    if (existing) existing.rows.push(row);
    else {
      plain.set(key, {
        key,
        kind: "product",
        label: line.product_name,
        sublabel: null,
        hex: null,
        branchGroup: null,
        imageUrl: line.image_url ?? row.product_image_url ?? null,
        units: 0,
        oldestAt: null,
        rows: [row],
      });
    }
  }

  const buckets = [...plain.values()]
    .map(finish)
    .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));

  if (mixedRows.length > 0) {
    buckets.push(
      finish({
        key: "mixed",
        kind: "mixed",
        label: "",
        sublabel: null,
        hex: null,
        branchGroup: null,
        imageUrl: null,
        units: 0,
        oldestAt: null,
        rows: mixedRows,
      }),
    );
  }
  return buckets;
}

function byRoll(rows: RunRow[], locale: string): Bucket[] {
  const known = new Map<string, Bucket>();
  const unknownRows: RunRow[] = [];

  for (const row of rows) {
    const hex = row.zone.colorHex;
    if (!hex) {
      unknownRows.push(row);
      continue;
    }
    const existing = known.get(hex);
    if (existing) existing.rows.push(row);
    else {
      const labels = zoneLabels(hex, locale);
      known.set(hex, {
        key: hex,
        kind: "zone",
        label: labels.colour ?? hex,
        sublabel: labels.name,
        hex,
        branchGroup: row.zone.branchGroup,
        imageUrl: null,
        units: 0,
        oldestAt: null,
        rows: [row],
      });
    }
  }

  // Darb's poster order, always. The eye learns nine fixed positions; sorting
  // by count would rearrange the shelf every morning.
  const buckets = DARB_ZONE_ORDER.filter((hex) => known.has(hex)).map((hex) => finish(known.get(hex)!));

  if (unknownRows.length > 0) {
    buckets.push(
      finish({
        key: "unknown",
        kind: "zone_unknown",
        label: "",
        sublabel: null,
        hex: null,
        branchGroup: null,
        imageUrl: null,
        units: 0,
        oldestAt: null,
        rows: unknownRows,
      }),
    );
  }
  return buckets;
}

function byGovernorate(rows: RunRow[]): Bucket[] {
  const known = new Map<string, Bucket>();
  const unknownRows: RunRow[] = [];

  for (const row of rows) {
    const gov = resolveGovernorate(row.customer_city ?? null);
    if (!gov) {
      unknownRows.push(row);
      continue;
    }
    const existing = known.get(gov);
    if (existing) existing.rows.push(row);
    else {
      known.set(gov, {
        key: gov,
        kind: "zone",
        label: gov,
        sublabel: null,
        hex: null,
        branchGroup: null,
        imageUrl: null,
        units: 0,
        oldestAt: null,
        rows: [row],
      });
    }
  }

  const buckets = [...known.values()]
    .map(finish)
    .sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));

  if (unknownRows.length > 0) {
    buckets.push(
      finish({
        key: "unknown",
        kind: "zone_unknown",
        label: "",
        sublabel: null,
        hex: null,
        branchGroup: null,
        imageUrl: null,
        units: 0,
        oldestAt: null,
        rows: unknownRows,
      }),
    );
  }
  return buckets;
}

/**
 * The batches of a run.
 *
 * `label` on a mixed or unknown bucket is deliberately empty: those two are
 * named by the interface in the operator's language, and inventing a French
 * string here would put untranslated text on an Arabic bench.
 */
export function bucketize(
  rows: RunRow[],
  mode: RunMode,
  market: "ly" | "tn",
  locale = "fr",
): Bucket[] {
  if (rows.length === 0) return [];
  if (mode === "product") return byProduct(rows);
  return market === "ly" ? byRoll(rows, locale) : byGovernorate(rows);
}
