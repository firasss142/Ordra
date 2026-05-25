"use client";

import Image from "next/image";
import { Pencil, Sheet, type LucideIcon } from "lucide-react";

type PlatformConfig = {
  label: string;
  logoSrc?: string;
  /** Lucide icon stand-in until a brand logo asset is provided. */
  icon?: LucideIcon;
  /** Background tint for the tile when using an icon stand-in. */
  iconTint?: { bg: string; fg: string };
};

const PLATFORMS: Record<string, PlatformConfig> = {
  shopify: { label: "Shopify", logoSrc: "/shopify_monotone_black.svg" },
  woocommerce: { label: "WooCommerce", logoSrc: "/woo_logo_black.svg" },
  lightfunnels: { label: "Lightfunnels", logoSrc: "/lightfunnel-logo.svg" },
  converty: { label: "Converty", logoSrc: "/converty.svg" },
  easy_orders: { label: "Easy Orders", logoSrc: "/easy_orders.svg" },
  // Replace icon stand-in with `logoSrc: "/google_sheets.svg"` when the
  // brand asset lands in /public — keeps the tile chrome unchanged.
  google_sheets: {
    label: "Google Sheets",
    icon: Sheet,
    iconTint: { bg: "#E6F4EA", fg: "#137333" }, // Sheets brand green
  },
  manual: { label: "Manual" },
};

interface Props {
  platform: string | null | undefined;
  size?: number;
}

export function SourceLogo({ platform, size = 18 }: Props) {
  const key = (platform ?? "manual").toLowerCase();
  const config = PLATFORMS[key] ?? { label: platform ?? "—" };

  const wrapperClass =
    "inline-flex items-center justify-center rounded-md bg-surface-hover text-ink-secondary";

  if (key === "manual") {
    return (
      <span
        className={wrapperClass}
        style={{ width: size + 6, height: size + 6 }}
        title={config.label}
        aria-label={config.label}
      >
        <Pencil size={size - 4} strokeWidth={2} />
      </span>
    );
  }

  if (config.icon) {
    const Icon = config.icon;
    const tint = config.iconTint;
    return (
      <span
        className="inline-flex items-center justify-center rounded-md"
        style={{
          width: size + 6,
          height: size + 6,
          backgroundColor: tint?.bg ?? "var(--bg-hover, #F7F7F7)",
          color: tint?.fg ?? "var(--text-secondary, #6D7175)",
        }}
        title={config.label}
        aria-label={config.label}
      >
        <Icon size={size - 4} strokeWidth={2} />
      </span>
    );
  }

  if (config.logoSrc) {
    return (
      <span
        className={wrapperClass}
        style={{ width: size + 6, height: size + 6 }}
        title={config.label}
      >
        <Image
          src={config.logoSrc}
          alt={config.label}
          width={size}
          height={size}
          style={{ objectFit: "contain" }}
        />
      </span>
    );
  }

  // Fallback: short uppercase text pill (e.g. "CONV", "EASY")
  const short = config.label.slice(0, 4).toUpperCase();
  return (
    <span
      className="inline-flex items-center justify-center rounded-md bg-surface-hover px-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-secondary"
      style={{ height: size + 6, minWidth: size + 6 }}
      title={config.label}
      aria-label={config.label}
    >
      {short}
    </span>
  );
}
