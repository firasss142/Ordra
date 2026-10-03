"use client";

import { Fragment, memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { preload } from "swr";
import { useTranslations } from "next-intl";
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
 * continuously, so it sits in the CENTRE of the bar as its own action
 * (`center`), under the thumb, between the four jobs' tabs. It used to float
 * over the content (ScanFab), where at 390px it covered the last card.
 *
 * Each tab may carry its job's hue (`job-out`, `job-returns`, …): the current
 * tab's plate takes that colour, so the bar says which job you are in.
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
  /** The job's hue class (globals.css), applied to the current tab's plate. */
  hue?: string;
}

/** Past two digits the number stops being a count and becomes a smear. */
function badge(count: number): string {
  return count > 99 ? "99+" : String(count);
}

function WarehouseBottomBarInner({ tabs, center }: { tabs: BottomTab[]; center?: React.ReactNode }) {
  const pathname = usePathname();
  const t = useTranslations("warehouse.nav");

  const prefetchData = useCallback((key?: string) => {
    if (!key) return;
    preload(key, jsonFetcher);
  }, []);

  return (
    <nav
      data-testid="wh-bottom-bar"
      aria-label={t("section")}
      // wh-safe-bottom: the gesture bar overlaps the last ~34px of the
      // viewport on a modern iPhone, and without the inset the labels sit
      // underneath it.
      // Opaque, not translucent: a list scrolls underneath this bar, and at
      // 95 % the product names blurred through it and read as smudges under
      // the labels. A navigation bar has nothing to gain from transparency.
      // Prototype `.tabbar`: five equal columns, items from the top (8px), the
      // scan button in the middle one; ~84px tall with the home-indicator room.
      className={[
        "wh-safe-bottom fixed inset-x-0 bottom-0 z-40 grid min-h-[84px] items-start border-t border-line-subtle bg-wm-card pt-[8px]",
        center ? "grid-cols-5" : "grid-cols-4",
      ].join(" ")}
    >
      {tabs.map((tab, index) => {
        const active = tab.exact
          ? pathname === tab.href
          : pathname === tab.href || pathname.startsWith(tab.href + "/");
        const Icon = tab.icon;
        const middle = center && index === Math.ceil(tabs.length / 2);
        return (
          <Fragment key={tab.href}>
          {middle ? <div className="relative flex justify-center">{center}</div> : null}
          <Link
            href={tab.href}
            prefetch
            aria-current={active ? "page" : undefined}
            onTouchStart={() => prefetchData(tab.prefetchKey)}
            onMouseEnter={() => prefetchData(tab.prefetchKey)}
            className={[
              tab.hue ?? "",
              "flex min-h-[56px] min-w-0 flex-col items-center gap-[3px] pt-[4px]",
              "text-[11.5px] font-semibold no-underline transition-colors duration-fast",
              active ? "text-wm-ink" : "text-ink-muted active:text-wm-ink",
            ].join(" ")}
          >
            {/* `.plate`: 52×30 pill. The current tab's plate takes its job's
                tint — colour alone fails in sunlight on a loading dock. */}
            <span
              className={`relative grid h-[30px] w-[52px] place-items-center rounded-pill transition-colors duration-fast ${
                active ? "bg-job-bg text-job-ink" : ""
              }`}
            >
              <Icon size={20} strokeWidth={2} aria-hidden="true" />
              {tab.count ? (
                <span
                  data-testid={`wh-tab-count-${tab.label}`}
                  className="absolute -end-[4px] -top-[4px] z-10 grid h-[18px] min-w-[18px] place-items-center rounded-[9px] bg-status-critical px-[5px] text-[11px] font-bold tabular-nums text-white"
                >
                  {badge(tab.count)}
                </span>
              ) : null}
            </span>
            <span className="max-w-full truncate">{tab.label}</span>
          </Link>
          </Fragment>
        );
      })}
    </nav>
  );
}

export const WarehouseBottomBar = memo(WarehouseBottomBarInner);
