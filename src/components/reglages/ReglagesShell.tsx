"use client";

import "../orders/commandes/commandes.css";
import "./reglages.css";
import { useState, type MouseEvent } from "react";
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
  UserSearch,
  Activity,
  ChevronRight,
  type LucideIcon,
} from "lucide-react";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode, type MarketCode } from "@/lib/markets";
import { isMarketScoped, MENU_GROUPS, topicsFor, type TopicId } from "@/lib/reglages/topics";
import type { AuthUser } from "@/types";
import { ReglagesFormProvider, useReglagesForm } from "./form-context";
import { SaveBar } from "./kit/SaveBar";
import { CodeChip, EmptyState, SettingsCard } from "./kit/parts";
import { RgButton } from "./kit/RgButton";
import { ConfirmDialog } from "./kit/ConfirmDialog";
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
  prospects: UserSearch,
  monitoring: Activity,
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
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="cmd cmd-page rg">
      <div className="page max-w-[1180px]">
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
      <header className="ph mb-[16px]">
        <div>
          <h1>{t("title")}</h1>
          <div className="sub">{t(isSA ? "menuFoot.admin" : "menuFoot.manager")}</div>
        </div>
      </header>
      <div className="rg-layout">
        <aside className="rg-menu flex flex-col gap-[2px]">
          {isMarketScoped(topic) && <div className="mb-[14px]">
            <div className="rg-label">{t(isSA ? "marketLabel.admin" : "marketLabel.manager")}</div>
            {isSA ? (
              <>
                <div role="group" aria-label={t(isSA ? "marketLabel.admin" : "marketLabel.manager")} className="rg-seg">
                  {(["tn", "ly"] as const).map((code) => {
                    const on = marketCode === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => !on && pickMarket(code)}
                      >
                        <CodeChip code={code.toUpperCase()} active={on} />
                        {t(`market.${code}`)}
                      </button>
                    );
                  })}
                </div>
                {scopeIsAll && <div className="mt-[6px] px-[4px] text-[12px] font-semibold text-[var(--warn)]">{t("allMarketsHint")}</div>}
              </>
            ) : (
              <div className="flex h-[38px] items-center gap-[8px] rounded-[11px] bg-white px-[10px] font-bold shadow-[inset_0_0_0_1px_rgba(15,23,40,.08)]">
                {marketCode && <CodeChip code={marketCode.toUpperCase()} />}
                {marketCode ? t(`market.${marketCode}`) : "—"}
              </div>
            )}
          </div>}
          <nav aria-label={t("title")} className="flex gap-[2px] overflow-x-auto lg:flex-col lg:gap-[14px] lg:overflow-visible">
            {MENU_GROUPS.map((group) => {
              const visible = group.topics.filter((id) => topicsFor(user.role).includes(id));
              if (visible.length === 0) return null;
              return (
                <div key={group.id} className="flex flex-none gap-[2px] lg:flex-col">
                  <h3 className="rg-eyebrow hidden lg:block">
                    {t(`menuGroups.${group.id}`)}
                  </h3>
                  {visible.map((id) => {
                    const Icon = ICONS[id];
                    const on = id === topic;
                    return (
                      <Link
                        key={id}
                        href={href(id)}
                        onClick={onNav(id)}
                        aria-current={on ? "page" : undefined}
                        className="rg-link lg:w-full"
                      >
                        <span className="ic-w">
                          <Icon aria-hidden />
                        </span>
                        {t(`topics.${id}.label`)}
                      </Link>
                    );
                  })}
                </div>
              );
            })}
          </nav>
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
    <div className="rg-th">
      <div className="min-w-0">
        <div className="crumb">
          {t("title")}
          <ChevronRight className="h-[13px] w-[13px] rtl:-scale-x-100" aria-hidden />
        </div>
        <h2>{t(`topics.${topic}.label`)}</h2>
        <p>{t(`topics.${topic}.subtitle`)}</p>
      </div>
      {marketCode && <MarketChip code={marketCode} />}
    </div>
  );
}

const CURRENCY: Record<MarketCode, string> = { tn: "TND", ly: "LYD" };

function MarketChip({ code }: { code: MarketCode }) {
  const t = useTranslations("reglages");
  return (
    <span className="rg-chip">
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

function LeaveDialog({ onStay, onLeave }: { onStay: () => void; onLeave: () => void }) {
  const t = useTranslations("reglages");
  return (
    <ConfirmDialog
      title={t("leave.title")}
      body={t("leave.body")}
      cancelLabel={t("leave.stay")}
      confirmLabel={t("leave.go")}
      onCancel={onStay}
      onConfirm={onLeave}
    />
  );
}
