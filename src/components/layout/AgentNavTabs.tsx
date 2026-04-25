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
        "inline-flex items-center gap-2 py-3 px-1 me-6",
        "text-[13px] no-underline transition-colors duration-fast",
        "border-b-2 -mb-px",
        active
          ? "font-semibold text-ink-primary border-accent"
          : "font-medium text-ink-secondary border-transparent hover:text-ink-primary",
      ].join(" ")}
    >
      <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
      <span>{tab.label}</span>
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
      className="flex bg-surface-card border-b border-line-subtle px-6"
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
