"use client";

import "./reglages.css";
import { useState, type CSSProperties, type MouseEvent } from "react";
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

/** The menu's four sections, one calm tint each (reglages.css `--g-*`). */
const GROUP_TINT: Record<(typeof MENU_GROUPS)[number]["id"], CSSProperties> = {
  sales: { "--tc": "var(--g-sales)", "--tb": "var(--g-sales-bg)" } as CSSProperties,
  shipping: { "--tc": "var(--g-shipping)", "--tb": "var(--g-shipping-bg)" } as CSSProperties,
  growth: { "--tc": "var(--g-growth)", "--tb": "var(--g-growth-bg)" } as CSSProperties,
  system: { "--tc": "var(--g-system)", "--tb": "var(--g-system-bg)" } as CSSProperties,
};

/**
 * Réglages — one page, a menu of topics on the start side, the topic on the
 * other. « Aurore calme » in the language of Prospects and Voix du client
 * (prototypes/reglages-v4.html): the topic is the page title, the market sits
 * on the header's end, the menu is one card. No tabs: the menu is the only
 * navigation. One save bar for the page.
 */
export function ReglagesShell({ user, topic }: { user: AuthUser; topic: TopicId }) {
  const locale = useLocale();
  const isSA = user.role === "super_admin";
  const { scope, marketId: scopeMarketId } = useMarketScope();
  const marketId = isSA ? scopeMarketId : user.market_id;

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="rgc">
      <ReglagesFormProvider key={`${topic}:${marketId ?? "all"}`}>
        <Layout user={user} topic={topic} marketId={marketId} scopeIsAll={isSA && scope === "all"} />
      </ReglagesFormProvider>
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
  const scoped = isMarketScoped(topic);
  const needsMarket = scoped && !marketId;

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
      <div className="rg-page">
        <header className="rg-ph">
          <div className="min-w-0">
            <div className="rg-crumb">
              {t("crumb")}
              <ChevronRight aria-hidden />
              {t("title")}
            </div>
            <h1>{t(`topics.${topic}.label`)}</h1>
            <p>{t(`topics.${topic}.subtitle`)}</p>
          </div>
          {scoped && (
            <div>
              {isSA ? (
                <div role="group" aria-label={t("marketLabel.admin")} className="rg-segc">
                  {(["tn", "ly"] as const).map((code) => {
                    const on = marketCode === code;
                    return (
                      <button key={code} type="button" aria-pressed={on} onClick={() => !on && pickMarket(code)}>
                        <CodeChip code={code.toUpperCase()} active={on} />
                        {t(`market.${code}`)}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <span className="rg-mchip" aria-label={t("marketLabel.manager")}>
                  {marketCode && <CodeChip code={marketCode.toUpperCase()} />}
                  {marketCode ? `${t(`market.${marketCode}`)} · ${CURRENCY[marketCode]}` : "—"}
                </span>
              )}
              {scopeIsAll && <div className="rg-hint">{t("allMarketsHint")}</div>}
            </div>
          )}
        </header>

        <div className="rg-body">
          <aside className="rg-menu">
            <nav aria-label={t("title")}>
              {MENU_GROUPS.map((group) => {
                const visible = group.topics.filter((id) => topicsFor(user.role).includes(id));
                if (visible.length === 0) return null;
                return (
                  <div key={group.id} className="rg-grp" style={GROUP_TINT[group.id]}>
                    <h3>{t(`menuGroups.${group.id}`)}</h3>
                    {visible.map((id) => {
                      const Icon = ICONS[id];
                      return (
                        <Link key={id} href={href(id)} onClick={onNav(id)} aria-current={id === topic ? "page" : undefined} className="rg-link">
                          <span className="ti">
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
            <p className="rg-foot">{t(isSA ? "menuFoot.admin" : "menuFoot.manager")}</p>
          </aside>

          <div className="rg-content">
            {needsMarket ? (
              <ScopePrompt onPick={pickMarket} />
            ) : (
              <TopicBody topic={topic} user={user} marketId={marketId ?? ""} marketCode={marketCode} />
            )}
          </div>
        </div>
      </div>
      <SaveBar />

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

const CURRENCY: Record<MarketCode, string> = { tn: "TND", ly: "LYD" };

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
