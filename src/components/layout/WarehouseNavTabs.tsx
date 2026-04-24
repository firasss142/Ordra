"use client";

import { memo, useCallback, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { preload } from "swr";
import {
  Package,
  PackageOpen,
  History,
  type LucideIcon,
} from "lucide-react";
import { jsonFetcher } from "@/lib/fetchers";
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

function WarehouseTabInner({
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

const WarehouseTab = memo(WarehouseTabInner);

function WarehouseNavTabsInner({ user }: Props) {
  const pathname = usePathname();
  const t = useTranslations("warehouse");

  const tabs: TabDef[] = [
    {
      href: `/${user.locale}/warehouse/preparation`,
      label: t("nav.preparation"),
      icon: Package,
      prefetchKey: "/api/warehouse/to-label",
    },
    {
      href: `/${user.locale}/warehouse/returns`,
      label: t("nav.returns"),
      icon: PackageOpen,
      prefetchKey: "/api/warehouse/returns",
    },
    {
      href: `/${user.locale}/warehouse/history`,
      label: t("nav.history"),
      icon: History,
      prefetchKey: "/api/warehouse/history",
    },
  ];

  const prefetchData = useCallback((key: string) => {
    preload(key, jsonFetcher);
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
          <WarehouseTab
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

export const WarehouseNavTabs = memo(WarehouseNavTabsInner);
