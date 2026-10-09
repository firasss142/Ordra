"use client";

import { useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { ChevronRight, Plus, Search, ShoppingBag } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { canEditArea } from "@/lib/reglages/topics";
import { shopState, type ShopState } from "@/lib/reglages/helpers";
import { marketTimezone } from "@/lib/markets";
import type { TopicProps } from "../TopicBody";
import { SettingsCard, ReadOnlyLine, RgBadge, Pills, EmptyState, th, td, trClick } from "../kit/parts";
import { Switch } from "../kit/Switch";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";
import { platformOf, type ShopActivity, type ShopRow } from "./shops/common";
import { AddShopDrawer, PlatformMark, ShopDrawer } from "./shops/ShopDrawers";
import { MatchingCard } from "./shops/MatchingCard";

/** « Actives » first and by default (owner, 2026-10-08): a disabled shop is history, not work. */
type Filter = "active" | "quiet" | "off" | "all";
const FILTERS: Filter[] = ["active", "quiet", "off", "all"];
/** Past this many shops the list gets a search box. */
const SEARCH_FROM = 6;

/**
 * Réglages › Boutiques — the shops that send orders (dated from the orders
 * themselves, not from webhooks) and the products or cities to match. A
 * manager reads the shops and matches.
 */
export function ShopsTopic({ user, marketId, marketCode }: TopicProps) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const editable = canEditArea(user.role, "shops");
  const { data: shopsData, mutate } = useSWR<{ data: ShopRow[] }>(`/api/storefronts?market_id=${marketId}`);
  const { data: activityData, mutate: mutateActivity } = useSWR<{ data: ShopActivity[] }>(`/api/storefronts/activity?market_id=${marketId}`);
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<ShopRow | null>(null);
  const [adding, setAdding] = useState(false);
  if (!shopsData) return <TopicSkeleton cards={2} />;

  const activity = (id: string) => activityData?.data.find((a) => a.storefront_id === id);
  const now = new Date();
  const stateOf = (s: ShopRow): ShopState => shopState({ is_active: s.is_active, last_order_at: activity(s.id)?.last_order_at ?? null }, now);
  const badge = (st: ShopState) =>
    st.kind === "ok" ? (
      <RgBadge tone="ok">{t("shops.state.ok")}</RgBadge>
    ) : st.kind === "quiet" ? (
      <RgBadge tone="warn">{t("shops.state.quiet", { days: st.days })}</RgBadge>
    ) : (
      <RgBadge tone="neutral">{t(st.kind === "off" ? "shops.state.off" : "shops.state.never")}</RgBadge>
    );
  const inFilter = (s: ShopRow, f: Filter) => {
    if (f === "all") return true;
    if (f === "active") return s.is_active;
    if (f === "off") return !s.is_active;
    const k = stateOf(s).kind;
    return k === "quiet" || k === "never";
  };

  // Most active first, then the rest by name.
  const shops = [...shopsData.data].sort(
    (a, b) => (activity(b.id)?.orders_30d ?? 0) - (activity(a.id)?.orders_30d ?? 0) || Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name),
  );
  const counts = Object.fromEntries(FILTERS.map((f) => [f, shops.filter((s) => inFilter(s, f)).length])) as Record<Filter, number>;
  const needle = q.trim().toLowerCase();
  const shown = shops.filter((s) => inFilter(s, filter) && (!needle || `${s.name} ${platformOf(s.platform).label}`.toLowerCase().includes(needle)));
  const most = Math.max(1, ...shops.map((s) => activity(s.id)?.orders_30d ?? 0));

  const tz = marketTimezone(marketId);
  const loc = locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
  // « 29 sept. · 15:30 » for a recent order, « 14 mai » for an older one, the year past 200 days.
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const days = (now.getTime() - d.getTime()) / 86_400_000;
    const date = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: tz, ...(days > 200 ? { year: "numeric" } : {}) }).format(d);
    if (days >= 30) return date;
    return `${date} · ${new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d)}`;
  };
  // « il y a 2 heures », « hier », « il y a 3 mois ».
  const ago = (iso: string) => {
    const mins = Math.max(0, (now.getTime() - new Date(iso).getTime()) / 60_000);
    const rtf = new Intl.RelativeTimeFormat(loc, { numeric: "auto" });
    if (mins < 60) return rtf.format(-Math.max(1, Math.round(mins)), "minute");
    if (mins < 60 * 24) return rtf.format(-Math.round(mins / 60), "hour");
    if (mins < 60 * 24 * 30) return rtf.format(-Math.round(mins / 1440), "day");
    if (mins < 60 * 24 * 365) return rtf.format(-Math.round(mins / 43_200), "month");
    return rtf.format(-Math.round(mins / 525_600), "year");
  };

  const toggle = async (s: ShopRow, next: boolean) => {
    const res = await fetch(`/api/storefronts/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      toast.show({ message: t("common.error"), tone: "critical" });
      return;
    }
    toast.show({ message: t(next ? "shops.toastOn" : "shops.toastOff", { name: s.name }), tone: "info" });
    await mutate();
  };

  return (
    <>
      <SettingsCard
        title={t("shops.title")}
        description={t("shops.desc")}
        end={
          editable ? (
            <RgButton variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t("shops.add")}
            </RgButton>
          ) : (
            <ReadOnlyLine />
          )
        }
      >
        <div className="rg-shopbar">
          <Pills label={t("shops.filter")} value={filter} onChange={setFilter} items={FILTERS.map((f) => ({ value: f, label: t(`shops.${f}`), count: counts[f] }))} />
          {shops.length > SEARCH_FROM && (
            <label className="rg-search sm">
              <Search aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("shops.search")} aria-label={t("shops.search")} />
            </label>
          )}
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<ShoppingBag aria-hidden />} title={t("shops.none")} />
        ) : (
          <table className="rg-shops w-full border-separate border-spacing-0">
            <colgroup>
              <col />
              <col style={{ width: 132 }} />
              <col style={{ width: 150 }} />
              <col style={{ width: 196 }} />
              {editable && <col style={{ width: 68 }} />}
              <col style={{ width: 44 }} />
            </colgroup>
            <thead>
              <tr>
                <th className={th}>{t("shops.colShop")}</th>
                <th className={`${th} text-end`}>{t("shops.colOrders")}</th>
                <th className={th}>{t("shops.colLast")}</th>
                <th className={th}>{t("shops.colState")}</th>
                {editable && <th className={`${th} text-end`}>{t("shops.colActive")}</th>}
                <th className={th} aria-hidden />
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const a = activity(s.id);
                const n = a?.orders_30d ?? 0;
                return (
                  <tr key={s.id} className={`${trClick}${s.is_active ? "" : " rg-off"}`} onClick={() => setOpen(s)}>
                    <td className={td}>
                      <button
                        type="button"
                        aria-label={t("shops.open", { name: s.name })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(s);
                        }}
                        className="rg-shop"
                      >
                        <PlatformMark platform={s.platform} logoUrl={s.logo_url} size={40} />
                        <span className="min-w-0">
                          <b>{s.name}</b>
                          <small>{platformOf(s.platform).label}</small>
                        </span>
                      </button>
                    </td>
                    <td className={`${td} text-end`}>
                      <div className="rg-vol">
                        <span className="bt" aria-hidden>
                          <i style={{ width: `${n ? Math.max(6, (n / most) * 100) : 0}%` }} />
                        </span>
                        <b className="num">{n.toLocaleString("fr-FR")}</b>
                      </div>
                    </td>
                    <td className={td}>
                      {a?.last_order_at ? (
                        <div className="rg-when">
                          {ago(a.last_order_at)}
                          <small>{fmt(a.last_order_at)}</small>
                        </div>
                      ) : (
                        <span className="text-ink-muted">—</span>
                      )}
                    </td>
                    <td className={td}>{badge(stateOf(s))}</td>
                    {editable && (
                      <td className={`${td} w-[1%] text-end`}>
                        <Switch checked={s.is_active} onChange={(v) => void toggle(s, v)} label={s.name} />
                      </td>
                    )}
                    <td className={`${td} w-[1%]`}>
                      <ChevronRight className="rg-chev" aria-hidden />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsCard>

      <MatchingCard marketId={marketId} marketCode={marketCode} shops={shops} editable={canEditArea(user.role, "matching")} />

      {open && (
        <ShopDrawer
          shop={open}
          activity={activity(open.id)}
          stateBadge={badge(stateOf(open))}
          editable={editable}
          canSeeLogs={user.role === "super_admin"}
          formatDate={fmt}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            await Promise.all([mutate(), mutateActivity()]);
            setOpen(null);
          }}
          onLogoChanged={() => mutate()}
        />
      )}
      {adding && (
        <AddShopDrawer
          marketId={marketId}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            await Promise.all([mutate(), mutateActivity()]);
          }}
        />
      )}
    </>
  );
}
