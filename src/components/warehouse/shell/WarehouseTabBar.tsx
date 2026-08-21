"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { preload } from "swr";
import type { LucideIcon } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";

export interface WarehouseTab {
  href: string;
  /**
   * Match this href exactly. The section index (`/warehouse`) is a prefix of
   * every other route in the section, so without this it would read as active
   * on every page.
   */
  exact?: boolean;
  label: string;
  icon: LucideIcon;
  prefetchKey?: string;
}

interface Props {
  tabs: WarehouseTab[];
  direction?: "ltr" | "rtl";
}

function WarehouseTabBarInner({ tabs, direction = "ltr" }: Props) {
  const pathname = usePathname();

  const prefetchData = useCallback((key?: string) => {
    if (!key) return;
    preload(key, jsonFetcher);
  }, []);

  return (
    <nav
      className="flex items-center"
      style={{ direction }}
      aria-label="Warehouse sections"
    >
      {tabs.map((tab) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(tab.href + "/");
        const Icon = tab.icon;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            prefetch
            aria-current={active ? "page" : undefined}
            onMouseEnter={() => prefetchData(tab.prefetchKey)}
            onFocus={() => prefetchData(tab.prefetchKey)}
            onTouchStart={() => prefetchData(tab.prefetchKey)}
            className={[
              "inline-flex items-center gap-2 px-1 py-3 me-6 text-[13px]",
              "transition-colors duration-fast no-underline",
              "border-b-2 -mb-px",
              active
                ? "text-wh-ok font-semibold border-wh-ok"
                : "text-wh-ink-2 font-medium border-transparent hover:text-wh-ink-1",
            ].join(" ")}
          >
            <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export const WarehouseTabBar = memo(WarehouseTabBarInner);
