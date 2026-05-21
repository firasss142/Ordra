"use client";

import { memo, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { preload } from "swr";
import {
  ShoppingBag,
  Users,
  ClipboardList,
  type LucideIcon,
} from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import type { AuthUser } from "@/types";

interface Props {
  user: AuthUser;
}

interface TabDef {
  href: string;
  label: string;
  icon: LucideIcon;
  prefetchKey: string;
}

function AgentTabInner({
  tab,
  active,
  onHover,
}: {
  tab: TabDef;
  active: boolean;
  onHover: () => void;
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
        // Mobile: each tab is an equal-width, centered column (no fixed
        // right-margin) so the three tabs split the row cleanly without
        // wrapping. Desktop keeps the inline auto-width tabs with me-8.
        "flex-1 justify-center sm:flex-none sm:justify-start",
        "inline-flex items-center gap-1.5 sm:gap-2 py-4 px-1 sm:me-8",
        "text-[13px] sm:text-[14px] no-underline transition-colors duration-fast",
        "border-b-2 -mb-px",
        active
          ? "font-bold text-agent-primary border-agent-primary"
          : "font-medium text-agent-on-surface-variant border-transparent hover:text-agent-on-surface",
      ].join(" ")}
    >
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className={active ? "text-agent-primary" : "text-agent-on-surface-variant/70"}
      />
      <span className="whitespace-nowrap">{tab.label}</span>
    </Link>
  );
}

const AgentTab = memo(AgentTabInner);

function AgentNavTabsInner({ user }: Props) {
  const pathname = usePathname();
  const tNav = useTranslations("nav");
  const tCrm = useTranslations("crm");
  const tFollowUps = useTranslations("crm.followUps");

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
      href: `/${user.locale}/follow-ups`,
      label: tFollowUps("nav"),
      icon: ClipboardList,
      prefetchKey: "/api/follow-ups",
    },
  ];

  const prefetchData = useCallback((key: string) => {
    preload(key, fetcher);
  }, []);

  return (
    <nav
      className="flex bg-surface-card border-b border-line-subtle px-2 sm:px-8"
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
          />
        );
      })}
    </nav>
  );
}

export const AgentNavTabs = memo(AgentNavTabsInner);
