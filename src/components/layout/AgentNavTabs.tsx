"use client";

import { memo, useCallback, useState } from "react";
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
  const [hovered, setHovered] = useState(false);
  const Icon = tab.icon;

  const color = active
    ? "var(--text-primary)"
    : hovered
      ? "var(--text-primary)"
      : "var(--text-secondary)";

  return (
    <Link
      href={tab.href}
      prefetch
      aria-current={active ? "page" : undefined}
      onMouseEnter={() => {
        setHovered(true);
        onHover();
      }}
      onFocus={onHover}
      onTouchStart={onHover}
      onMouseLeave={() => setHovered(false)}
      style={{
        padding: "12px 4px",
        marginInlineEnd: 24,
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        fontWeight: active ? 600 : 500,
        color,
        textDecoration: "none",
        borderBlockEnd: active
          ? "2px solid var(--text-primary)"
          : "2px solid transparent",
        marginBlockEnd: -1,
        transition: "color 120ms ease, border-color 120ms ease",
      }}
    >
      <Icon size={16} strokeWidth={1.5} aria-hidden="true" />
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
      style={{
        display: "flex",
        borderBottom: "1px solid var(--border)",
        backgroundColor: "var(--bg-card)",
        paddingInline: 24,
        direction: user.direction === "rtl" ? "rtl" : "ltr",
      }}
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
