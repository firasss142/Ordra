"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

/**
 * The top bar shared by Clients › Messages (the inbox) and its Modèles page —
 * the prototype's `setTop(title, sub, cta, "Clients › Messages")`, plus the
 * « Conversations · Modèles » switch that makes the templates reachable from
 * the inbox even while a market is not connected. Client-side links: no full
 * reload between the two.
 */
export function MessagesHeader({
  active,
  locale,
  title,
  sub,
  actions,
}: {
  active: "conversations" | "templates";
  locale: string;
  title: string;
  sub: string;
  actions?: ReactNode;
}) {
  const tNav = useTranslations("nav");
  const t = useTranslations("whatsappAdmin.nav");
  const tabs = [
    { key: "conversations" as const, href: `/${locale}/messages`, label: t("conversations") },
    { key: "templates" as const, href: `/${locale}/messages/templates`, label: t("templates") },
  ];
  return (
    <div data-testid="messages-header" className="mb-4 flex flex-wrap items-start gap-x-4 gap-y-3">
      <div className="min-w-0">
        <div className="mb-0.5 text-[13px] text-ink-secondary">{`${tNav("sections.clients")} › ${tNav("items.messages")}`}</div>
        <h1 className="m-0 text-[20px] font-semibold text-ink-primary">{title}</h1>
        <p className="m-0 mt-0.5 text-[13px] text-ink-secondary">{sub}</p>
      </div>
      <div className="ms-auto flex flex-wrap items-center gap-2">
        <nav aria-label={t("switchLabel")} className="inline-flex gap-1 rounded-[8px] bg-status-neutralBg p-[3px]">
          {tabs.map((tab) => (
            <Link
              key={tab.key}
              href={tab.href}
              aria-current={tab.key === active ? "page" : undefined}
              className={`rounded-[6px] px-3 py-1.5 text-[13.5px] no-underline ${
                tab.key === active ? "bg-surface-card font-semibold text-ink-primary ring-1 ring-line" : "font-medium text-ink-secondary hover:text-ink-primary"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </nav>
        {actions}
      </div>
    </div>
  );
}
