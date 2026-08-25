"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import useSWR from "swr";
import { Activity, Bell, CreditCard, Home, User as UserIcon } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import type { AuthUser } from "@/types";
import { dateTimeShort, money } from "@/lib/investors/ui-format";

/**
 * Investor portal shell — mobile-first (bottom tabs < sm, top nav ≥ sm), no
 * staff chrome, `id="main-content"` for the skip link. The only surface an
 * investor ever sees.
 */
type Notif = { id: string; kind: string; payload: Record<string, unknown>; read_at: string | null; created_at: string };

export function InvestorShell({ user, locale, children }: { user: AuthUser; locale: string; children: React.ReactNode }) {
  const t = useTranslations("investor.shell");
  const ta = useTranslations("investor.activity");
  const pathname = usePathname() ?? "";
  const base = `/${locale}/investor`;
  const tabs = [
    { href: base, label: t("home"), Icon: Home, match: (p: string) => p === base || p.startsWith(base + "/deals") },
    { href: `${base}/activity`, label: t("activity"), Icon: Activity, match: (p: string) => p.startsWith(base + "/activity") },
    { href: `${base}/withdrawals`, label: t("withdrawals"), Icon: CreditCard, match: (p: string) => p.startsWith(base + "/withdrawals") },
    { href: `${base}/account`, label: t("account"), Icon: UserIcon, match: (p: string) => p.startsWith(base + "/account") },
  ];
  const { data, mutate } = useSWR<{ data: Notif[]; unread: number }>("/api/investor/notifications", fetcher, { refreshInterval: 60_000, revalidateOnFocus: true });
  const unread = data?.unread ?? 0;
  const [open, setOpen] = useState(false);
  const initials = (user.full_name ?? user.email ?? "?").split(/\s+/).map((s) => s[0]).join("").slice(0, 2).toUpperCase();

  async function markAll() {
    await fetch("/api/investor/notifications/read", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    mutate();
  }

  function describe(n: Notif): { title: string; sub: string } {
    const p = n.payload as Record<string, string | number | null | undefined>;
    const cur = (p.currency as string) ?? null;
    const amt = (v: unknown) => money(Number(v ?? 0), cur, locale, 2);
    switch (n.kind) {
      case "statement_issued": return { title: ta("statementIssued"), sub: ta("statementIssuedSub", { start: String(p.period_start ?? ""), end: String(p.period_end ?? ""), amount: amt(p.payable) }) };
      case "withdrawal_approved": return { title: ta("withdrawalApproved", { amount: amt(p.amount) }), sub: "" };
      case "withdrawal_rejected": return { title: ta("withdrawalRejected", { amount: amt(p.amount) }), sub: String(p.admin_note ?? "") };
      case "withdrawal_paid": return { title: ta("withdrawalPaid", { amount: amt(p.amount) }), sub: String(p.reference ?? "") };
      case "terms_amended": return { title: ta("termsAmended", { date: String(p.effective_from ?? "") }), sub: "" };
      case "deal_matured": return { title: ta("dealMatured"), sub: "" };
      case "deal_closed": return { title: ta("dealClosed", { amount: amt(p.capital_returned) }), sub: "" };
      case "correction_posted": return { title: ta("correctionPosted", { amount: amt(p.amount) }), sub: String(p.note ?? "") };
      default: return { title: n.kind, sub: "" };
    }
  }

  return (
    <div className="min-h-screen bg-oms-bg text-oms-ink-1">
      <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-oms-surface focus:px-3 focus:py-2">{t("skip")}</a>
      <div className="mx-auto w-full max-w-[440px] px-3.5 pb-24 pt-3 sm:max-w-[760px] sm:pb-10">
        <header className="mb-3 flex items-center gap-2.5">
          <div className="grid h-9 w-9 place-items-center rounded-full bg-oms-ink-1 text-[12.5px] font-bold text-white">{initials}</div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold tracking-[-0.01em]">{user.full_name ?? user.email}</div>
            <div className="text-[11.5px] text-oms-ink-3">{t("portfolio")}</div>
          </div>
          <nav className="hidden items-center gap-1 sm:flex" aria-label={t("portfolio")}>
            {tabs.map(({ href, label, match }) => (
              <Link key={href} href={href} className={`rounded-lg px-3 py-1.5 text-[12.5px] font-semibold ${match(pathname) ? "bg-oms-surface text-oms-ink-1 shadow-hover-row" : "text-oms-ink-2 hover:text-oms-ink-1"}`}>{label}</Link>
            ))}
          </nav>
          <div className="relative">
            <button type="button" onClick={() => setOpen((o) => !o)} aria-label={t("notifications")} aria-expanded={open} className="relative grid h-9 w-9 place-items-center rounded-full border border-oms-border bg-oms-surface text-oms-ink-2">
              <Bell size={17} />
              {unread > 0 && <span className="absolute -end-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-[#D72C0D] px-1 text-[10px] font-bold text-white">{unread}</span>}
            </button>
            {open && (
              <div role="dialog" aria-label={t("notifications")} className="absolute end-0 top-11 z-40 w-[320px] rounded-[10px] border border-oms-border bg-oms-surface p-2 shadow-floating">
                <div className="flex items-center justify-between px-2 py-1">
                  <span className="text-[10.5px] font-semibold uppercase tracking-[.06em] text-oms-ink-3">{t("notifications")}</span>
                  {unread > 0 && <button type="button" onClick={markAll} className="text-[12px] font-semibold text-oms-ink-2">{t("markAllRead")}</button>}
                </div>
                <div className="max-h-[360px] overflow-auto">
                  {(data?.data ?? []).length === 0 && <div className="px-2 py-4 text-center text-[12.5px] text-oms-ink-3">{t("noNotifications")}</div>}
                  {(data?.data ?? []).slice(0, 30).map((n) => {
                    const d = describe(n);
                    return (
                      <div key={n.id} className={`rounded-lg px-2 py-2 ${n.read_at ? "" : "bg-oms-sunken"}`}>
                        <div className="text-[12.5px] font-semibold">{d.title}</div>
                        <div className="text-[11px] text-oms-ink-3">{dateTimeShort(n.created_at, locale)}{d.sub ? ` · ${d.sub}` : ""}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </header>
        <main id="main-content">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 grid h-[68px] grid-cols-4 border-t border-oms-border bg-oms-surface px-2 pb-3 pt-1.5 sm:hidden" aria-label={t("portfolio")}>
        {tabs.map(({ href, label, Icon, match }) => {
          const on = match(pathname);
          return (
            <Link key={href} href={href} className={`flex flex-col items-center gap-0.5 rounded-lg pt-1.5 text-[10.5px] font-semibold ${on ? "text-oms-ink-1" : "text-oms-ink-3"}`} aria-current={on ? "page" : undefined}>
              <Icon size={20} strokeWidth={on ? 2.25 : 1.75} />
              {label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
