/**
 * Which coloured sticker roll a queue row needs.
 *
 * The warehouse picks a pre-printed sticker off a roll chosen by destination,
 * so the colour has to be on the row before the operator walks to the shelf —
 * not discovered when the scanner refuses them.
 *
 * PRECEDENCE. `branch_group` on the order is what Darb ACTUALLY did with the
 * parcel; the branch directory is only what Darb's rules say it should do. The
 * two disagree in production — 16 الزاوية shipments are filed under `TR` while
 * the directory puts الزاوية under `ZWY` — so the order's own value wins, or
 * we would name a colour the carrier is not using.
 *
 * Below that sits the directory lookup, with all the Arabic folding, in
 * `darb-destination.ts`. Below that, nothing: an unresolved destination is
 * reported as unknown. A wrong colour puts the parcel on the wrong truck.
 */

import {
  buildDestinationIndex,
  resolveDestination,
  type DestinationIndex,
  type DirectoryRow,
} from "@/lib/carriers/darb-destination";
import { normalizeHex, zoneForColor } from "@/lib/carriers/darb-zones";

/** A row of the `darb_branches` mirror, as the database returns it. */
export interface BranchRow {
  branch_group: string;
  color: string | null;
  city: string;
  area: string | null;
}

export interface ZoneIndex {
  destinations: DestinationIndex;
  /** The fast path: Darb told us the branch, we only need its colour. */
  colorByBranchGroup: Map<string, string>;
}

export interface ZonedOrderInput {
  branch_group?: string | null;
  customer_city?: string | null;
  customer_area?: string | null;
}

export interface OrderZone {
  branchGroup: string | null;
  colorHex: string | null;
  colourFr: string | null;
  nameFr: string | null;
  nameAr: string | null;
  /** Where the answer came from, so the UI can be honest about confidence. */
  source: "carrier" | "directory" | "unknown";
}

const UNKNOWN: OrderZone = {
  branchGroup: null,
  colorHex: null,
  colourFr: null,
  nameFr: null,
  nameAr: null,
  source: "unknown",
};

export function buildZoneIndex(rows: BranchRow[]): ZoneIndex {
  const colorByBranchGroup = new Map<string, string>();
  for (const row of rows) {
    if (row.color && !colorByBranchGroup.has(row.branch_group)) {
      colorByBranchGroup.set(row.branch_group, normalizeHex(row.color));
    }
  }
  const directoryRows: DirectoryRow[] = rows.map((r) => ({
    branchGroup: r.branch_group,
    color: r.color,
    city: r.city,
    area: r.area,
  }));
  return { destinations: buildDestinationIndex(directoryRows), colorByBranchGroup };
}

function named(branchGroup: string | null, hex: string | null, source: OrderZone["source"]): OrderZone {
  const zone = zoneForColor(hex);
  if (!zone) {
    // We may know the branch and still not know its colour — a Darb branch
    // added since the last directory sync. Report the gap, do not paper it.
    return { ...UNKNOWN, branchGroup };
  }
  return {
    branchGroup,
    colorHex: zone.hex,
    colourFr: zone.colourFr,
    nameFr: zone.nameFr,
    nameAr: zone.nameAr,
    source,
  };
}

export function zoneForOrder(order: ZonedOrderInput, index: ZoneIndex): OrderZone {
  const carrierGroup = order.branch_group?.trim() || null;
  if (carrierGroup) {
    return named(carrierGroup, index.colorByBranchGroup.get(carrierGroup) ?? null, "carrier");
  }

  const hit = resolveDestination(order.customer_city, order.customer_area, index.destinations);
  if (!hit) return UNKNOWN;
  return named(hit.branchGroup, hit.color, "directory");
}
