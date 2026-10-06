"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import "./messages.css";

/**
 * The ground and the header shared by Clients › Messages and its Modèles page
 * (prototype voix-du-client-et-messages-v2.html, `header()` with page=messages):
 * the crumb, « Messages », the sub line, and the « Conversations · Modèles »
 * switch — client links, so moving between the two never reloads. The count on
 * Conversations is what waits to be handed over.
 */
export function MessagesShell({
  active,
  locale,
  isRtl,
  count,
  children,
}: {
  active: "conversations" | "templates";
  locale: string;
  isRtl: boolean;
  /** Conversations to hand over; null hides the pill (not connected, unknown). */
  count?: number | null;
  children: ReactNode;
}) {
  const tNav = useTranslations("nav");
  const t = useTranslations("whatsappAdmin.nav");
  const tInbox = useTranslations("whatsappAdmin.inbox");
  const tabs = [
    { key: "conversations" as const, href: `/${locale}/messages`, label: t("conversations") },
    { key: "templates" as const, href: `/${locale}/messages/templates`, label: t("templates") },
  ];
  return (
    <div className="wam" dir={isRtl ? "rtl" : "ltr"}>
      <div className="wam-page">
        <div className="ph" data-testid="messages-header">
          <div>
            <div className="crumb">
              {tNav("sections.clients")}
              <i>/</i>
              {tNav("items.messages")}
            </div>
            <h1>{tInbox("title")}</h1>
            <div className="subl">{tInbox("sub")}</div>
          </div>
          <div className="end">
            <nav className="segc" aria-label={t("switchLabel")}>
              {tabs.map((tab) => (
                <Link key={tab.key} href={tab.href} className={tab.key === active ? "on" : undefined} aria-current={tab.key === active ? "page" : undefined}>
                  {tab.label}
                  {tab.key === "conversations" && typeof count === "number" && <span className="cnt num">{count}</span>}
                </Link>
              ))}
            </nav>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
