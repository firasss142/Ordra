import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import type { OrderZone } from "@/lib/warehouse/zone-index";
import type { RunRow } from "@/lib/warehouse/scan-buckets";
import frMessages from "@/messages/fr.json";
import arMessages from "@/messages/ar.json";

export const RED: OrderZone = {
  branchGroup: "TR", colorHex: "#d80a0a", colourFr: "Rouge",
  nameFr: "Tripoli et banlieue", nameAr: "طرابلس وضواحيها", source: "carrier",
};
export const GREEN: OrderZone = {
  branchGroup: "BN", colorHex: "#339307", colourFr: "Vert",
  nameFr: "Région orientale", nameAr: "المنطقة الشرقية", source: "carrier",
};
export const UNKNOWN: OrderZone = {
  branchGroup: null, colorHex: null, colourFr: null, nameFr: null, nameAr: null, source: "unknown",
};

let seq = 0;
export function row(over: Partial<RunRow> = {}): RunRow {
  seq += 1;
  return {
    id: `aaaaaaaa-0000-4000-8000-00000000000${seq}`,
    customer_name: "محمد علي",
    customer_phone: "+218",
    customer_city: "طرابلس",
    customer_area: null,
    customer_address: null,
    product_id: "p1",
    product_name: "دمية ملاكمة",
    variant_label: null,
    quantity: 1,
    total_price: 249,
    status: "uploaded",
    created_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    uploaded_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    branch_group: "TR",
    tracking_number: "SH1",
    carrier_sticker_ref: null,
    carrier_status_slug: null,
    has_carrier_ref: true,
    current_stock: 40,
    low_stock_threshold: 5,
    product_image_url: null,
    items: [],
    zone: RED,
    ...over,
  };
}

export function Intl({ locale = "ar", children }: { locale?: "fr" | "ar"; children: ReactNode }) {
  return (
    <NextIntlClientProvider locale={locale} messages={locale === "ar" ? arMessages : frMessages}>
      {children}
    </NextIntlClientProvider>
  );
}
