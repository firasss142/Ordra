"use client";

import { useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Plus, ShoppingBag } from "lucide-react";
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

type Filter = "all" | "ok" | "quiet" | "off";

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
  const [filter, setFilter] = useState<Filter>("all");
  const [open, setOpen] = useState<ShopRow | null>(null);
  const [adding, setAdding] = useState(false);
  if (!shopsData) return <TopicSkeleton cards={2} />;

  const activity = (id: string) => activityData?.data.find((a) => a.storefront_id === id);
  const now = new Date();
  const stateOf = (s: ShopRow): ShopState => shopState({ is_active: s.is_active, last_order_at: activity(s.id)?.last_order_at ?? null }, now);
  const bucket = (st: ShopState): Exclude<Filter, "all"> => (st.kind === "ok" ? "ok" : st.kind === "off" ? "off" : "quiet");
  const badge = (st: ShopState) =>
    st.kind === "ok" ? (
      <RgBadge tone="ok">{t("shops.state.ok")}</RgBadge>
    ) : st.kind === "quiet" ? (
      <RgBadge tone="warn">{t("shops.state.quiet", { days: st.days })}</RgBadge>
    ) : (
      <RgBadge tone="neutral">{t(st.kind === "off" ? "shops.state.off" : "shops.state.never")}</RgBadge>
    );

  // Most active first, then the rest by name.
  const shops = [...shopsData.data].sort(
    (a, b) => (activity(b.id)?.orders_30d ?? 0) - (activity(a.id)?.orders_30d ?? 0) || Number(b.is_active) - Number(a.is_active) || a.name.localeCompare(b.name),
  );
  const counts: Record<Filter, number> = { all: shops.length, ok: 0, quiet: 0, off: 0 };
  for (const s of shops) counts[bucket(stateOf(s))] += 1;
  const shown = filter === "all" ? shops : shops.filter((s) => bucket(stateOf(s)) === filter);

  const tz = marketTimezone(marketId);
  // « 29 sept. · 15:30 » for a recent order, « 14 mai » for an older one, the year past 200 days.
  const fmt = (iso: string) => {
    const d = new Date(iso);
    const days = (now.getTime() - d.getTime()) / 86_400_000;
    const loc = locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR";
    const date = new Intl.DateTimeFormat(loc, { day: "numeric", month: "short", timeZone: tz, ...(days > 200 ? { year: "numeric" } : {}) }).format(d);
    if (days >= 30) return date;
    return `${date} · ${new Intl.DateTimeFormat(loc, { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: tz }).format(d)}`;
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
        <div className="border-b border-line-subtle px-[16px] py-[10px]">
          <Pills
            label={t("shops.filter")}
            value={filter}
            onChange={setFilter}
            items={(["all", "ok", "quiet", "off"] as const).map((f) => ({ value: f, label: t(`shops.${f}`), count: counts[f] }))}
          />
        </div>
        {shown.length === 0 ? (
          <EmptyState icon={<ShoppingBag aria-hidden />} title={t("shops.none")} />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{t("shops.colShop")}</th>
                <th className={`${th} text-end`}>{t("shops.colOrders")}</th>
                <th className={th}>{t("shops.colLast")}</th>
                <th className={th}>{t("shops.colState")}</th>
                {editable && <th className={`${th} text-end`}>{t("shops.colActive")}</th>}
              </tr>
            </thead>
            <tbody>
              {shown.map((s) => {
                const a = activity(s.id);
                const st = stateOf(s);
                return (
                  <tr key={s.id} className={`${trClick} ${s.is_active ? "" : "[&>td:not(:last-child)]:text-ink-secondary"}`} onClick={() => setOpen(s)}>
                    <td className={td}>
                      <button
                        type="button"
                        aria-label={t("shops.open", { name: s.name })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(s);
                        }}
                        className="flex items-center gap-[10px] text-start"
                      >
                        <PlatformMark platform={s.platform} />
                        <span>
                          <b className="block font-semibold">{s.name}</b>
                          <span className="text-[12.5px] text-ink-secondary">{platformOf(s.platform).label}</span>
                        </span>
                      </button>
                    </td>
                    <td className={`${td} text-end tabular-nums`}>{(a?.orders_30d ?? 0).toLocaleString("fr-FR")}</td>
                    <td className={td}>{a?.last_order_at ? fmt(a.last_order_at) : "—"}</td>
                    <td className={td}>{badge(st)}</td>
                    {editable && (
                      <td className={`${td} w-[1%] text-end`}>
                        <Switch checked={s.is_active} onChange={(v) => void toggle(s, v)} label={s.name} />
                      </td>
                    )}
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
