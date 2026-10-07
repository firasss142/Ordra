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
 * navigation. One save bar for the page. Since 2026-10-07 it follows Commandes
 * and Accueil: ONE page header, whose right side holds the market (as Accueil's
 * holds its dates); the topic is a section title under it; cards are Commandes'
 * table — a glass head over a white body.
 */
export function ReglagesShell({ user, topic }: { user: AuthUser; topic: TopicId }) {
  const locale = useLocale();
  const isSA = user.role === "super_admin";
  const { marketId: scopeMarketId } = useMarketScope();
  const marketId = isSA ? scopeMarketId : user.market_id;

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="cmd cmd-page rg">
      <div className="page max-w-[1180px]">
        <ReglagesFormProvider key={`${topic}:${marketId ?? "all"}`}>
          <Layout user={user} topic={topic} marketId={marketId} />
        </ReglagesFormProvider>
      </div>
    </div>
  );
}

function Layout({
  user,
  topic,
  marketId,
}: {
  user: AuthUser;
  topic: TopicId;
  marketId: string | null;
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
        {isMarketScoped(topic) && (
          <div className="acts">
            {isSA ? (
              <div role="group" aria-label={t("marketLabel.admin")} className="rg-seg">
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
              <span className="rg-mk">
                {marketCode && <CodeChip code={marketCode.toUpperCase()} />}
                <span>
                  <small>{t("marketLabel.manager")}</small>
                  <b>{marketCode ? `${t(`market.${marketCode}`)} · ${CURRENCY[marketCode]}` : "—"}</b>
                </span>
              </span>
            )}
          </div>
        )}
      </header>
      <div className="rg-layout">
        <aside className="rg-menu flex flex-col gap-[2px]">
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
          <TopicHeader topic={topic} />
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

function TopicHeader({ topic }: { topic: TopicId }) {
  const t = useTranslations("reglages");
  return (
    <div className="rg-th">
      <h2>{t(`topics.${topic}.label`)}</h2>
      <p>{t(`topics.${topic}.subtitle`)}</p>
    </div>
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
