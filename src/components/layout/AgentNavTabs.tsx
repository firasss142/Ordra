"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import useSWR, { preload } from "swr";
import {
  ShoppingBag,
  Users,
  Truck,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { fetchAgentQueue } from "@/lib/agent-queue/fetch-queue";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
  /**
   * "inline" sits inside the header row; "band" is the standalone strip beneath
   * it. Desktop uses inline so the chrome is one 64px band instead of two,
   * which is roughly two more orders visible before scrolling. Mobile keeps the
   * band, where three tabs plus a search field cannot share a row.
   */
  variant?: "band" | "inline";
}

interface TabDef {
  href: string;
  label: string;
  icon: LucideIcon;
  prefetchKey: string;
  badge?: number;
}

function AgentTabInner({
  tab,
  active,
  onHover,
  inline,
}: {
  tab: TabDef;
  active: boolean;
  onHover: () => void;
  inline: boolean;
}) {
  const Icon = tab.icon;
  return (
    <Link
      href={tab.href}
      prefetch
      aria-current={active ? "page" : undefined}
      onMouseEnter={onHover}
      onFocus={onHover}
      onTouchStart={onHover}
      className={[
        "inline-flex items-center no-underline transition-colors duration-fast",
        "border-b-2 -mb-px",
        inline
          ? // Inside the header row: full-height, compact, auto-width. The
            // active tab sits on a tinted block, the way the reference does.
            "h-full gap-2 px-4 text-[14px] rounded-t-lg"
          : // Standalone band on mobile: equal-width columns that split the row.
            "flex-1 justify-center gap-1.5 px-1 py-3.5 text-[13px]",
        active
          ? `font-bold text-[#15803D] border-[#15803D] ${inline ? "bg-[#F0FDF4]" : ""}`
          : "font-semibold text-agent-ink-3 border-transparent hover:text-agent-on-surface",
      ].join(" ")}
    >
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className={active ? "text-[#15803D]" : "text-agent-ink-3 opacity-70"}
      />
      <span className="whitespace-nowrap">{tab.label}</span>
      {tab.badge ? (
        <span className="ms-0.5 inline-grid h-5 min-w-5 place-items-center rounded-full bg-[#DCFCE7] px-1.5 text-xs font-bold tabular-nums text-[#15803D]">
          {tab.badge}
        </span>
      ) : null}
    </Link>
  );
}

const AgentTab = memo(AgentTabInner);

function AgentNavTabsInner({ user, variant = "band" }: Props) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tCrm = useTranslations("crm");

  // Parcels that need the agent now. Same key as the Livraison page, so the
  // badge and the page share one request; the global SWR fetcher resolves it.
  const { data: delivery } = useSWR<{ rows: { bucket: string }[] }>(
    user.role === "agent" ? "/api/delivery/worklist" : null,
    { refreshInterval: 120_000, revalidateOnFocus: false },
  );
  const deliveryBadge = delivery?.rows?.filter((r) => r.bucket === "act_now" || r.bucket === "returning").length ?? 0;

  const tabs: TabDef[] = [
    {
      href: `/${user.locale}/queue`,
      label: tNav("orders"),
      icon: ShoppingBag,
      prefetchKey: "/api/agent/queue",
    },
    {
      href: `/${user.locale}/leads`,
      label: tCrm("nav"),
      icon: Users,
      prefetchKey: "/api/agent/leads/queue",
    },
    {
      // « Suivi livraison » replaces the old follow-ups tab. The /follow-ups
      // page is still reachable by URL until the rebuild's deletion phase.
      href: `/${user.locale}/delivery`,
      label: tNav("delivery"),
      icon: Truck,
      prefetchKey: "/api/delivery/worklist",
      badge: deliveryBadge,
    },
    {
      href: `/${user.locale}/commissions`,
      label: tNav("myCommissions"),
      icon: Coins,
      prefetchKey: "/api/agent/commissions?days=60",
    },
  ];

  const prefetchData = useCallback((key: string) => {
    // The queue key must be preloaded with its own fetcher. The wire sends
    // `visibleIds` and fetchAgentQueue rehydrates the `orders` array that
    // cache-patch operates on; preloading with the global fetcher would seed
    // the cache with the raw wire shape and useAgentQueue would then read a
    // cache entry that has no `orders` at all.
    preload(key, key === "/api/agent/queue" ? fetchAgentQueue : fetcher);
  }, []);

  const inline = variant === "inline";

  return (
    <nav
      className={
        inline
          ? "flex items-stretch h-full"
          : "flex bg-agent-surface border-b border-agent-outline-variant px-2 lg:hidden"
      }
      style={{ direction: user.direction === "rtl" ? "rtl" : "ltr" }}
    >
      {tabs.map((tab) => {
        const active =
          pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <AgentTab
            key={tab.href}
            tab={tab}
            active={active}
            onHover={() => prefetchData(tab.prefetchKey)}
            inline={inline}
          />
        );
      })}
    </nav>
  );
}

export const AgentNavTabs = memo(AgentNavTabsInner);
