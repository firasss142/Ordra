/**
 * The Ordra label of an X-Delivery parcel — what it says (prototypes/xdelivery-label-v1.html).
 *
 * Two codes, two readers (owner, 2026-10-06): their Code-128 of the parcel number on top
 * for their drivers and depots, our QR of the order id at the bottom for our scan-out.
 * Destination, phone and amount are recomputed exactly as the adapter sent them, so the
 * label never disagrees with what X-Delivery holds.
 */

import { XDELIVERY_DELEGATION_EXTRA, XDELIVERY_GOVERNORATE_EXTRA } from "@/lib/carriers/xdelivery/adapter";
import {
  XDELIVERY_DEPOT,
  normalizeTunisianPhone,
  resolveXDeliveryDestination,
} from "@/lib/carriers/xdelivery/destinations";

export interface XDeliveryLabelInput {
  order: {
    id: string;
    external_id: string | null;
    tracking_number: string;
    customer_name: string | null;
    customer_phone: string | null;
    customer_city: string | null;
    customer_address: string | null;
    total_price: number | null;
    product_name: string | null;
    variant_label: string | null;
    quantity: number | null;
    carrier_extra: Record<string, unknown> | null;
  };
  items: Array<{ product_name: string | null; variant_label: string | null; quantity: number | null }>;
  /** The account's « colis ouvrable » setting, as sent with the parcel. */
  isOpened: boolean;
  sender: { name: string | null; phone: string | null };
  printedAt: Date;
}

export interface XDeliveryLabelData {
  orderId: string;
  barcode: string;
  barcodeText: string;
  depot: string;
  governorate: string;
  delegation: string;
  name: string;
  phone: string;
  address: string;
  cod: string;
  open: "OUI" | "NON";
  items: string[];
  qr: string;
  ref: string;
  sender: string;
  date: string;
}

const MAX_LINES = 4;

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** 1250 → « 1 250,000 DT ». Plain spaces: the PDF font has no narrow no-break space. */
function dinars(amount: number): string {
  const [int, frac] = amount.toFixed(3).split(".");
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, " ")},${frac} DT`;
}

function tunisTime(at: Date): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("fr-FR", {
      timeZone: "Africa/Tunis",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((x) => [x.type, x.value]),
  );
  return `${p.day}/${p.month}/${p.year} ${p.hour}:${p.minute}`;
}

const line = (name: string | null, variant: string | null, qty: number | null) =>
  `${qty ?? 1}× ${[name ?? "—", variant].filter(Boolean).join(" ")}`;

export function buildXDeliveryLabel(input: XDeliveryLabelInput): XDeliveryLabelData {
  const { order } = input;
  const extra = order.carrier_extra ?? {};
  const dest = resolveXDeliveryDestination({
    customerCity: order.customer_city,
    governorate: str(extra[XDELIVERY_GOVERNORATE_EXTRA]),
    delegation: str(extra[XDELIVERY_DELEGATION_EXTRA]),
  });

  const phone8 = normalizeTunisianPhone(order.customer_phone);
  const lines =
    input.items.length > 0
      ? input.items.map((i) => line(i.product_name, i.variant_label, i.quantity))
      : [line(order.product_name, order.variant_label, order.quantity)];
  const items =
    lines.length > MAX_LINES + 1
      ? [...lines.slice(0, MAX_LINES), `+ ${lines.length - MAX_LINES} autres articles`]
      : lines;

  return {
    orderId: order.id,
    barcode: order.tracking_number,
    barcodeText: order.tracking_number.replace(/(\d{4})(?=\d)/g, "$1 "),
    depot: dest.ok ? XDELIVERY_DEPOT[dest.governorate] ?? "" : "",
    governorate: dest.ok ? dest.governorate : order.customer_city?.trim() || "—",
    delegation: dest.ok ? dest.delegation : "",
    name: order.customer_name ?? "",
    phone: phone8 ? `${phone8.slice(0, 2)} ${phone8.slice(2, 5)} ${phone8.slice(5)}` : order.customer_phone ?? "",
    address: order.customer_address ?? "",
    cod: dinars(Number(order.total_price ?? 0)),
    open: input.isOpened ? "OUI" : "NON",
    items,
    qr: order.id,
    ref: `Commande ${order.external_id ? `#${order.external_id}` : order.id.slice(0, 8).toUpperCase()}`,
    sender: [input.sender.name, input.sender.phone].filter(Boolean).join(" · "),
    date: tunisTime(input.printedAt),
  };
}
