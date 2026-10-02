"use client";

import { useState, type MouseEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  Globe,
  ShoppingBag,
  ClipboardList,
  Ban,
  Users,
  Warehouse,
  Truck,
  MessageCircle,
  Megaphone,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode, type MarketCode } from "@/lib/markets";
import { isMarketScoped, topicsFor, type TopicId } from "@/lib/reglages/topics";
import type { AuthUser } from "@/types";
import { ReglagesFormProvider, useReglagesForm } from "./form-context";
import { SaveBar } from "./kit/SaveBar";
import { CodeChip, EmptyState, SettingsCard } from "./kit/parts";
import { RgButton } from "./kit/RgButton";
import { TopicBody } from "./TopicBody";

const ICONS: Record<TopicId, LucideIcon> = {
  markets: Globe,
  shops: ShoppingBag,
  orders: ClipboardList,
  rejections: Ban,
  team: Users,
  warehouses: Warehouse,
  delivery: Truck,
  whatsapp: MessageCircle,
  ads: Megaphone,
};

/**
 * Réglages — one page, a menu of topics on the start side, the topic on the
 * other (prototypes/reglages-v2.html). No tabs: the menu is the only
 * navigation. One save bar for the page.
 */
export function ReglagesShell({ user, topic }: { user: AuthUser; topic: TopicId }) {
  const locale = useLocale();
  const isSA = user.role === "super_admin";
  const { scope, marketId: scopeMarketId } = useMarketScope();
  const marketId = isSA ? scopeMarketId : user.market_id;

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-[1180px] px-[16px] pb-[48px] pt-[24px] md:px-[24px]">
        <ReglagesFormProvider key={`${topic}:${marketId ?? "all"}`}>
          <Layout user={user} topic={topic} marketId={marketId} scopeIsAll={isSA && scope === "all"} />
        </ReglagesFormProvider>
      </div>
    </div>
  );
}

function Layout({
  user,
  topic,
  marketId,
  scopeIsAll,
}: {
  user: AuthUser;
  topic: TopicId;
  marketId: string | null;
  scopeIsAll: boolean;
}) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const router = useRouter();
  const { setScope } = useMarketScope();
  const { dirtyCount, resetAll } = useReglagesForm();
  const [pending, setPending] = useState<null | (() => void)>(null);
  const isSA = user.role === "super_admin";
  const marketCode = marketIdToCode(marketId);
  const needsMarket = isMarketScoped(topic) && !marketId;

  /** Run `go` now, or after « Quitter sans enregistrer » when something is unsaved. */
  const guard = (go: () => void) => {
    if (dirtyCount > 0) setPending(() => go);
    else go();
  };
  const pickMarket = (code: MarketCode) => guard(() => setScope(code));
  const href = (id: TopicId) => `/${locale}/system/settings/${id}`;
  const onNav = (id: TopicId) => (e: MouseEvent) => {
    if (dirtyCount === 0) return;
    e.preventDefault();
    setPending(() => () => router.push(href(id)));
  };

  return (
    <>
      <div className="grid items-start gap-[24px] lg:grid-cols-[232px_minmax(0,1fr)] lg:gap-[32px]">
        <aside className="flex flex-col gap-[2px] pt-[2px] lg:sticky lg:top-[12px]">
          <h1 className="m-0 mb-[14px] text-[20px] font-semibold tracking-[-.01em] text-ink-primary">{t("title")}</h1>
          <div className="mb-[16px]">
            <div className="mb-[6px] text-[12px] font-medium text-ink-secondary">{t(isSA ? "marketLabel.admin" : "marketLabel.manager")}</div>
            {isSA ? (
              <>
                <div role="group" aria-label={t(isSA ? "marketLabel.admin" : "marketLabel.manager")} className="flex gap-[2px] rounded-[9px] bg-[#E9EAEC] p-[3px]">
                  {(["tn", "ly"] as const).map((code) => {
                    const on = marketCode === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => !on && pickMarket(code)}
                        className={`inline-flex flex-1 items-center justify-center gap-[6px] whitespace-nowrap rounded-[7px] px-[8px] py-[6px] text-[13px] ${on ? "bg-white font-semibold text-ink-primary shadow-[0_0_0_1px_#E1E3E5]" : "font-medium text-ink-secondary"}`}
                      >
                        <CodeChip code={code.toUpperCase()} active={on} />
                        {t(`market.${code}`)}
                      </button>
                    );
                  })}
                </div>
                {scopeIsAll && <div className="mt-[6px] text-[12px] text-status-warning">{t("allMarketsHint")}</div>}
              </>
            ) : (
              <div className="flex items-center gap-[8px] rounded-[8px] border border-line-subtle bg-white px-[10px] py-[8px] font-semibold">
                {marketCode && <CodeChip code={marketCode.toUpperCase()} />}
                {marketCode ? t(`market.${marketCode}`) : "—"}
              </div>
            )}
          </div>
          <nav aria-label={t("title")} className="-mx-[16px] flex gap-[2px] overflow-x-auto px-[16px] lg:mx-0 lg:flex-col lg:overflow-visible lg:px-0">
            {topicsFor(user.role).map((id) => {
              const Icon = ICONS[id];
              const on = id === topic;
              return (
                <Link
                  key={id}
                  href={href(id)}
                  onClick={onNav(id)}
                  aria-current={on ? "page" : undefined}
                  className={`flex flex-none items-center gap-[10px] whitespace-nowrap rounded-[8px] border px-[10px] py-[8px] text-[14px] lg:w-full ${on ? "border-line-subtle bg-white font-semibold text-ink-primary" : "border-transparent font-medium text-ink-primary hover:bg-[#EDEEF0]"}`}
                >
                  <Icon className={`h-[16px] w-[16px] ${on ? "text-brand" : "text-ink-secondary"}`} aria-hidden />
                  {t(`topics.${id}.label`)}
                </Link>
              );
            })}
          </nav>
          <div className="mx-[4px] my-[10px] hidden h-px bg-line lg:block" />
          <p className="m-0 hidden px-[10px] text-[12px] leading-[1.5] text-ink-secondary lg:block">{t(isSA ? "menuFoot.admin" : "menuFoot.manager")}</p>
        </aside>

        <div className="min-w-0">
          <SaveBar />
          <TopicHeader topic={topic} marketCode={isMarketScoped(topic) ? marketCode : null} />
          {needsMarket ? (
            <ScopePrompt onPick={pickMarket} />
          ) : (
            <TopicBody topic={topic} user={user} marketId={marketId ?? ""} marketCode={marketCode} />
          )}
        </div>
      </div>

      {pending && (
        <LeaveDialog
          onStay={() => setPending(null)}
          onLeave={() => {
            const go = pending;
            setPending(null);
            resetAll();
            go();
          }}
        />
      )}
    </>
  );
}

function TopicHeader({ topic, marketCode }: { topic: TopicId; marketCode: MarketCode | null }) {
  const t = useTranslations("reglages");
  return (
    <div className="mb-[20px] flex items-start gap-[16px]">
      <div className="min-w-0">
        <div className="flex items-center gap-[4px] text-[13px] text-ink-secondary">
          {t("title")}
          <ChevronRight className="h-[13px] w-[13px] rtl:-scale-x-100" aria-hidden />
        </div>
        <h2 className="m-0 mb-[4px] mt-[2px] text-[20px] font-semibold tracking-[-.01em] text-ink-primary">{t(`topics.${topic}.label`)}</h2>
        <p className="m-0 max-w-[64ch] text-[14px] text-ink-secondary">{t(`topics.${topic}.subtitle`)}</p>
      </div>
      {marketCode && <MarketChip code={marketCode} />}
    </div>
  );
}

const CURRENCY: Record<MarketCode, string> = { tn: "TND", ly: "LYD" };

function MarketChip({ code }: { code: MarketCode }) {
  const t = useTranslations("reglages");
  return (
    <span className="ms-auto inline-flex flex-none items-center gap-[7px] whitespace-nowrap rounded-full border border-line bg-white py-[5px] pe-[11px] ps-[6px] text-[13px] font-semibold text-ink-primary">
      <CodeChip code={code.toUpperCase()} />
      {t(`market.${code}`)} · {CURRENCY[code]}
    </span>
  );
}

function ScopePrompt({ onPick }: { onPick: (code: MarketCode) => void }) {
  const t = useTranslations("reglages");
  return (
    <SettingsCard title={t("scope.title")}>
      <EmptyState
        icon={<Globe aria-hidden />}
        title={t("scope.heading")}
        text={t("scope.body")}
        actions={(["tn", "ly"] as const).map((code) => (
          <RgButton key={code} onClick={() => onPick(code)}>
            <CodeChip code={code.toUpperCase()} />
            {t(`market.${code}`)}
          </RgButton>
        ))}
      />
    </SettingsCard>
  );
}

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }): ReactNode {
  const t = useTranslations("reglages");
  return (
    <div className="fixed inset-0 z-[60] grid place-items-center bg-[rgba(17,24,39,.36)]" role="presentation">
      <div role="alertdialog" aria-modal="true" aria-labelledby="rg-leave-title" className="w-[420px] max-w-[92vw] rounded-[12px] border border-line bg-white shadow-floating">
        <h3 id="rg-leave-title" className="m-0 px-[20px] pb-[6px] pt-[16px] text-[16px] font-semibold">
          {t("leave.title")}
        </h3>
        <p className="m-0 px-[20px] pb-[16px] text-[13.5px] text-ink-secondary">{t("leave.body")}</p>
        <div className="flex justify-end gap-[8px] rounded-b-[12px] border-t border-line-subtle bg-surface-sunken px-[20px] py-[12px]">
          <RgButton onClick={onStay} autoFocus>
            {t("leave.stay")}
          </RgButton>
          <RgButton variant="danger" onClick={onLeave}>
            {t("leave.go")}
          </RgButton>
        </div>
      </div>
    </div>
  );
}
