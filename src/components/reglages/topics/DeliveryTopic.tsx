"use client";

import { useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Plus, Truck, AlertTriangle } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { canEditArea } from "@/lib/reglages/topics";
import type { TopicProps } from "../TopicBody";
import { useMarketSettingsForm } from "../useMarketSettingsForm";
import { SettingsCard, ReadOnlyLine, StateBadge, Mark, EmptyState, th, td, trClick } from "../kit/parts";
import { NumberSetting } from "../kit/NumberSetting";
import { Switch } from "../kit/Switch";
import { RgButton } from "../kit/RgButton";
import { TopicSkeleton } from "../kit/TopicSkeleton";
import { CarrierDrawer } from "./delivery/CarrierDrawer";
import { AddCarrierDrawer } from "./delivery/AddCarrierDrawer";
import type { AdapterDescriptor, CarrierRow, SiteRow } from "./delivery/types";

const CURRENCY = { tn: "TND", ly: "LYD" } as const;

/**
 * Réglages › Livraison — what was spread over four screens: the carriers (and
 * their panel), the risky-parcel thresholds, « Colis immobile » (the one Alertes
 * threshold a reader exists for) and the manager's board. A manager reads the
 * carriers and sets the thresholds.
 */
export function DeliveryTopic({ user, marketId, marketCode }: TopicProps) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const form = useMarketSettingsForm(marketId);
  const editCarriers = canEditArea(user.role, "carriers");
  const editRisk = canEditArea(user.role, "risk");
  const editBoard = canEditArea(user.role, "board");
  const { data: carriersData, mutate } = useSWR<{ data: CarrierRow[] }>(`/api/carriers?market_id=${marketId}`);
  const { data: perfData } = useSWR<{ data: { carrier_id: string; delivered: number; returned: number }[] }>(`/api/carriers/performance?market_id=${marketId}`);
  const { data: sitesData } = useSWR<{ data: SiteRow[] }>(`/api/admin/warehouse-sites?market_id=${marketId}`);
  const { data: adaptersData } = useSWR<{ data: AdapterDescriptor[] }>(editCarriers ? `/api/carriers/adapters?market_id=${marketId}` : null);
  const [open, setOpen] = useState<CarrierRow | null>(null);
  const [adding, setAdding] = useState(false);
  if (!carriersData || !form.loaded) return <TopicSkeleton cards={3} />;

  const currency = marketCode ? CURRENCY[marketCode] : "";
  const sites = sitesData?.data ?? [];
  const adapters = adaptersData?.data ?? [];
  const siteName = (id: string | null) => {
    const s = sites.find((x) => x.id === id);
    return s ? (locale === "ar" ? s.nameAr : s.nameFr) : t("delivery.drawer.noSite");
  };
  const perf = (id: string) => perfData?.data.find((p) => p.carrier_id === id);
  const adapterLabel = (code: string) => adapters.find((a) => a.code === code)?.label ?? code.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  const toggle = async (c: CarrierRow, next: boolean) => {
    const res = await fetch(`/api/carriers/${c.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_active: next }),
    });
    if (!res.ok) {
      toast.show({ message: t("common.error"), tone: "critical" });
      return;
    }
    toast.show({ message: t(next ? "delivery.toastOn" : "delivery.toastOff", { name: c.name }), tone: "info" });
    await mutate();
  };

  const field = (key: string) => ({ label: t(`fields.${key}.label`), unit: t(`fields.${key}.unit`) });

  return (
    <>
      <SettingsCard
        title={t("delivery.carriersTitle")}
        description={t("delivery.carriersDesc")}
        end={
          editCarriers ? (
            <RgButton variant="primary" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              {t("delivery.add")}
            </RgButton>
          ) : (
            <ReadOnlyLine />
          )
        }
      >
        {carriersData.data.length === 0 ? (
          <EmptyState icon={<Truck aria-hidden />} title={t("delivery.noCarrier")} />
        ) : (
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className={th}>{t("delivery.colCarrier")}</th>
                <th className={th}>{t("delivery.colSite")}</th>
                <th className={`${th} text-end`}>{t("delivery.colFees")}</th>
                <th className={`${th} text-end`}>{t("delivery.colDelivered")}</th>
                <th className={`${th} text-end`}>{t("delivery.colActive")}</th>
              </tr>
            </thead>
            <tbody>
              {carriersData.data.map((c) => {
                const p = perf(c.id);
                const done = p ? p.delivered + p.returned : 0;
                return (
                  <tr key={c.id} className={`${trClick} ${c.is_active ? "" : "[&>td:not(:last-child)]:text-ink-secondary"}`} onClick={() => setOpen(c)}>
                    <td className={td}>
                      <button
                        type="button"
                        aria-label={t("delivery.open", { name: c.name })}
                        onClick={(e) => {
                          e.stopPropagation();
                          setOpen(c);
                        }}
                        className="flex items-center gap-[10px] text-start"
                      >
                        <Mark>
                          <Truck aria-hidden />
                        </Mark>
                        <span>
                          <b className="block font-semibold">{c.name}</b>
                          <span className="text-[12.5px] text-ink-secondary">{adapterLabel(c.code)}</span>
                        </span>
                      </button>
                    </td>
                    <td className={td}>{siteName(c.warehouse_id)}</td>
                    <td className={`${td} text-end tabular-nums`}>
                      {c.code === "darb_assabil" ? (
                        // No flat fee for Darb (owner, 2026-10-03): each parcel costs its invoice.
                        <span className="text-[12.5px] text-ink-secondary">{t("delivery.feesInvoiced")}</span>
                      ) : c.delivery_fee || c.return_fee ? (
                        <>
                          {c.delivery_fee} · {c.return_fee} <span className="text-[12.5px] text-ink-secondary">{currency}</span>
                        </>
                      ) : (
                        <span className="inline-flex items-center gap-[5px] font-semibold text-status-warning">
                          <AlertTriangle className="h-[14px] w-[14px]" aria-hidden />
                          {t("delivery.feesMissing")}
                        </span>
                      )}
                    </td>
                    <td className={`${td} text-end tabular-nums`}>
                      {done > 0 ? (
                        <>
                          {p!.delivered} <span className="text-[12.5px] text-ink-secondary">{t("delivery.deliveredOf", { n: done })}</span>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className={`${td} w-[1%] text-end`}>
                      {editCarriers ? <Switch checked={c.is_active} onChange={(v) => void toggle(c, v)} label={c.name} /> : <StateBadge on={c.is_active} />}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </SettingsCard>

      <SettingsCard title={t("delivery.riskTitle")} description={t("delivery.riskDesc")}>
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="high_value_threshold"
          label={t("fields.high_value_threshold.label")}
          unit={currency}
          editable={editRisk}
          help={(n) => (n === 0 ? t("fields.high_value_threshold.helpZero") : t("fields.high_value_threshold.help", { n, cur: currency }))}
        />
        <NumberSetting form={form} marketId={marketId} settingKey="risk_min_prior_failures" {...field("risk_min_prior_failures")} min={1} max={100} editable={editRisk} help={(n) => t("fields.risk_min_prior_failures.help", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="zone_low_delivery_rate_pct" {...field("zone_low_delivery_rate_pct")} max={100} editable={editRisk} help={(n) => t("fields.zone_low_delivery_rate_pct.help", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="zone_min_sample" {...field("zone_min_sample")} min={1} editable={editRisk} help={(n) => t("fields.zone_min_sample.help", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="carrier_stall_days" {...field("carrier_stall_days")} min={1} max={90} editable={editRisk} help={(n) => t("fields.carrier_stall_days.help", { n })} />
      </SettingsCard>

      <SettingsCard title={t("delivery.boardTitle")} description={t("delivery.boardDesc")}>
        <NumberSetting form={form} marketId={marketId} settingKey="delivery_first_action_hours" {...field("delivery_first_action_hours")} min={1} max={72} editable={editBoard} help={(n) => t("fields.delivery_first_action_hours.help", { n })} />
        <NumberSetting form={form} marketId={marketId} settingKey="delivery_done_window_hours" {...field("delivery_done_window_hours")} min={1} max={168} editable={editBoard} help={(n) => t("fields.delivery_done_window_hours.help", { n })} />
      </SettingsCard>

      {open && (
        <CarrierDrawer
          carrier={open}
          siteName={siteName(open.warehouse_id)}
          currency={currency}
          editable={editCarriers}
          adapter={adapters.find((a) => a.code === open.code)}
          onClose={() => setOpen(null)}
          onSaved={async () => {
            await mutate();
            setOpen(null);
          }}
        />
      )}
      {adding && (
        <AddCarrierDrawer
          marketId={marketId}
          marketLabel={marketCode ? t(`market.${marketCode}`) : ""}
          currency={currency}
          adapters={adapters}
          sites={sites}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            await mutate();
            setAdding(false);
          }}
        />
      )}
    </>
  );
}
