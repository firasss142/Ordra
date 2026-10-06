"use client";

import { useTranslations } from "next-intl";
import { Copy } from "lucide-react";
import { useToast } from "@/components/ui/Toast";

export interface ShopRow {
  id: string;
  market_id: string;
  name: string;
  platform: string;
  is_active: boolean;
  auth_mode?: string | null;
  /** Uploaded logo (public URL); null = the platform's two letters. */
  logo_url?: string | null;
  /** For a Google Sheets shop: `{ spreadsheet_id, sheet_name }`. */
  config?: Record<string, unknown> | null;
}

export interface ShopActivity {
  storefront_id: string;
  orders_30d: number;
  last_order_at: string | null;
}

/** Brand names and the two-letter mark of each storefront platform. */
export const PLATFORMS: Record<string, { label: string; mark: string }> = {
  google_sheets: { label: "Google Sheets", mark: "GS" },
  easy_orders: { label: "EasyOrders", mark: "EO" },
  shopify: { label: "Shopify", mark: "SH" },
  buybox: { label: "BuyBox", mark: "BB" },
  woocommerce: { label: "WooCommerce", mark: "WC" },
  converty: { label: "Converty", mark: "CV" },
  lightfunnels: { label: "LightFunnels", mark: "LF" },
};
export const platformOf = (p: string) => PLATFORMS[p] ?? { label: p, mark: p.slice(0, 2).toUpperCase() };

/**
 * The platforms a shop can be created for from the screen. Google Sheets is how
 * a Converty account connects — one shop per account, each with its own sheet.
 */
export const CREATABLE_PLATFORMS = ["easy_orders", "shopify", "woocommerce", "lightfunnels", "google_sheets"] as const;

/** BuyBox posts from the browser: the link is the only secret. */
export const linkOnly = (s: ShopRow) => (s.auth_mode ?? (s.platform === "buybox" ? "uuid_only" : "hmac")) === "uuid_only";

export const receptionUrl = (id: string) => `${typeof window === "undefined" ? "" : window.location.origin}/api/webhooks/${id}`;

/** A value to copy into another system: monospace, one click to copy. */
export function CopyBox({ value }: { value: string }) {
  const t = useTranslations("reglages");
  const toast = useToast();
  return (
    <div className="flex h-[40px] items-center gap-[6px] rounded-[11px] border border-[rgba(15,23,40,.12)] bg-surface-sunken pe-[4px] ps-[11px]">
      <span dir="ltr" className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-ink-primary">
        {value}
      </span>
      <button
        type="button"
        title={t("common.copy")}
        aria-label={t("common.copy")}
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          toast.show({ message: t("common.copied"), tone: "info" });
        }}
        className="grid h-[30px] w-[30px] place-items-center rounded-[6px] text-ink-secondary hover:bg-surface-selected hover:text-ink-primary"
      >
        <Copy className="h-[15px] w-[15px]" aria-hidden />
      </button>
    </div>
  );
}
