"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { preload } from "swr";
import type { LucideIcon } from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";

/**
 * The warehouse agent's entire navigation.
 *
 * The agent shell has no sidebar, so this bar is the only way off the screen
 * they are standing on. It is operated with a thumb by someone holding a
 * parcel in the other hand, which sets everything about it: the target is the
 * whole cell rather than the label, the bar is pinned to the bottom where a
 * thumb reaches, and it clears the iOS home indicator.
 *
 * Scanning is deliberately NOT a tab — it is the one thing an agent does
 * continuously, so it gets the floating button (`ScanFab`) instead of a
 * quarter of a bar.
 */

export interface BottomTab {
  href: string;
  label: string;
  icon: LucideIcon;
  /**
   * Match this href exactly. The section index is a prefix of every other
   * route in the section, so without it the first tab reads as active
   * everywhere.
   */
  exact?: boolean;
  /** Work waiting in that section. Omitted, not zero, when there is none. */
  count?: number;
  prefetchKey?: string;
}

/** Past two digits the number stops being a count and becomes a smear. */
function badge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function WarehouseBottomBarInner({ tabs }: { tabs: BottomTab[] }) {
  const pathname = usePathname();

  const prefetchData = useCallback((key?: string) => {
    if (!key) return;
    preload(key, jsonFetcher);
  }, []);

  return (
    <nav
      data-testid="wh-bottom-bar"
      aria-label="Entrepôt"
      // wh-safe-bottom: the gesture bar overlaps the last ~34px of the
      // viewport on a modern iPhone, and without the inset the labels sit
      // underneath it.
      // Opaque, not translucent: a list scrolls underneath this bar, and at
      // 95 % the product names blurred through it and read as smudges under
      // the labels. A navigation bar has nothing to gain from transparency.
      className="wh-safe-bottom fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t border-wh-border bg-wh-surface shadow-[0_-1px_8px_rgba(27,29,26,.06)]"
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
            onTouchStart={() => prefetchData(tab.prefetchKey)}
            onMouseEnter={() => prefetchData(tab.prefetchKey)}
            className={[
              "relative flex min-h-[56px] flex-1 flex-col items-center justify-center gap-1 px-1 py-2",
              "text-[10.5px] font-semibold no-underline transition-colors duration-fast",
              active ? "text-wh-ok" : "text-wh-ink-3 active:text-wh-ink-1",
            ].join(" ")}
          >
            <span className="relative">
              {/* The active tab is marked by a tinted plate as well as by
                  colour — colour alone fails the moment the phone is in
                  sunlight on a loading dock. */}
              <span
                aria-hidden="true"
                className={`absolute -inset-x-3 -inset-y-1.5 rounded-pill transition-opacity ${
                  active ? "bg-wh-ok-bg opacity-100" : "opacity-0"
                }`}
              />
              <Icon
                size={20}
                strokeWidth={active ? 2.2 : 1.6}
                aria-hidden="true"
                className="relative"
              />
              {tab.count ? (
                <span
                  data-testid={`wh-tab-count-${tab.label}`}
                  className="absolute -end-2.5 -top-1.5 z-10 grid min-w-[17px] place-items-center rounded-pill bg-wh-bad px-1 py-px font-mono text-[9.5px] font-bold leading-[13px] tabular-nums text-white"
                >
                  {badge(tab.count)}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export const WarehouseBottomBar = memo(WarehouseBottomBarInner);
