"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Wallet, FileText, ArrowDownToLine } from "lucide-react";
import type { AuthUser } from "@/types";

/**
 * Mobile-first chrome for the investor portal.
 *
 * The rest of the OMS is desktop-first because staff work at a desk all day.
 * Investors check their money on a phone, so this is the one surface built the
 * other way round: a bottom tab bar on small screens, a top bar from `sm` up.
 */
export function InvestorShell({
  user,
  locale,
  children,
}: {
  user: AuthUser;
  locale: string;
  children: React.ReactNode;
}) {
  const t = useTranslations("investor");
  const pathname = usePathname();

  const tabs = [
    { href: `/${locale}/investor`, label: t("nav.portfolio"), icon: Wallet, exact: true },
    { href: `/${locale}/investor/statements`, label: t("nav.statements"), icon: FileText },
    { href: `/${locale}/investor/withdrawals`, label: t("nav.withdrawals"), icon: ArrowDownToLine },
  ];

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <div className="min-h-screen bg-surface-page flex flex-col">
      <header className="border-b border-line-subtle bg-surface-card">
        <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="m-0 text-[15px] font-semibold text-ink-primary truncate">
              {user.full_name}
            </p>
            <p className="m-0 text-[12px] text-ink-secondary">{t("title")}</p>
          </div>

          {/* Desktop nav — hidden on phones, where the bottom bar takes over. */}
          <nav className="hidden sm:flex items-center gap-1">
            {tabs.map((tab) => {
              const active = isActive(tab.href, tab.exact);
              return (
                <Link
                  key={tab.href}
                  href={tab.href}
                  aria-current={active ? "page" : undefined}
                  className={`px-3 py-2 rounded-[6px] text-[13px] transition-colors duration-fast ${
                    active
                      ? "bg-surface-selected text-ink-primary font-medium"
                      : "text-ink-secondary hover:bg-surface-hover"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      {/* pb-20 leaves room for the fixed bottom bar on phones. */}
      <main className="flex-1 mx-auto w-full max-w-5xl px-4 sm:px-6 py-4 sm:py-6 pb-20 sm:pb-6">
        {children}
      </main>

      <nav
        className="sm:hidden fixed bottom-0 inset-x-0 border-t border-line-subtle bg-surface-card"
        style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
      >
        <div className="flex">
          {tabs.map((tab) => {
            const active = isActive(tab.href, tab.exact);
            const Icon = tab.icon;
            return (
              <Link
                key={tab.href}
                href={tab.href}
                aria-current={active ? "page" : undefined}
                className={`flex-1 flex flex-col items-center gap-1 py-2.5 text-[11px] ${
                  active ? "text-ink-primary font-medium" : "text-ink-secondary"
                }`}
              >
                <Icon size={20} strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
                {tab.label}
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
