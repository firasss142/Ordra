"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { Warehouse, Info, AlertTriangle, ChevronRight } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { canEditArea } from "@/lib/reglages/topics";
import type { TopicProps } from "../TopicBody";
import { useMarketSettingsForm } from "../useMarketSettingsForm";
import { SettingsCard, ReadOnlyLine, RgBadge, StateBadge, Mark, th, td, trPlain } from "../kit/parts";
import { NumberSetting } from "../kit/NumberSetting";
import { Switch } from "../kit/Switch";
import { ConfirmDialog } from "../kit/ConfirmDialog";
import { TopicSkeleton } from "../kit/TopicSkeleton";

interface Site {
  id: string;
  nameFr: string;
  nameAr: string;
  isDefault: boolean;
  isActive: boolean;
  assignedAgents: { id: string; name: string }[];
  stockUnits: number;
}
interface CarrierRow {
  id: string;
  name: string;
  is_active: boolean;
  warehouse_id: string | null;
}

/**
 * Réglages › Entrepôts — the buildings parcels leave from, which carrier ships
 * from each, and the supplier lead time. Sites left the old Transporteurs tab.
 * A market manager reads it (they used to get a 403 and « Aucun site »).
 */
export function WarehousesTopic({ user, marketId }: TopicProps) {
  const t = useTranslations("reglages");
  const locale = useLocale();
  const toast = useToast();
  const form = useMarketSettingsForm(marketId);
  const { data: sitesData, mutate } = useSWR<{ data: Site[] }>(`/api/admin/warehouse-sites?market_id=${marketId}`);
  const { data: carriersData } = useSWR<{ data: CarrierRow[] }>(`/api/carriers?market_id=${marketId}`);
  const [confirm, setConfirm] = useState<{ site: Site; agents: { name: string }[]; stock: number } | null>(null);
  const editSites = canEditArea(user.role, "warehouses");
  if (!sitesData || !form.loaded) return <TopicSkeleton cards={2} />;

  const name = (s: Site) => (locale === "ar" ? s.nameAr : s.nameFr);
  const otherName = (s: Site) => (locale === "ar" ? s.nameFr : s.nameAr);
  const carriers = carriersData?.data ?? [];

  const toggle = async (site: Site, next: boolean, confirmed = false) => {
    const res = await fetch("/api/admin/warehouse-sites", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmed ? { id: site.id, is_active: next, confirmed: true } : { id: site.id, is_active: next }),
    });
    if (res.status === 409) {
      const body = (await res.json().catch(() => ({}))) as { code?: string; agents?: { name: string }[]; stockUnits?: number };
      if (body.code === "needs_confirmation") {
        setConfirm({ site, agents: body.agents ?? [], stock: body.stockUnits ?? 0 });
        return;
      }
      toast.show({ message: t("warehouses.defaultLocked"), tone: "warning" });
      return;
    }
    if (!res.ok) {
      toast.show({ message: t("common.error"), tone: "critical" });
      return;
    }
    await mutate();
    toast.show({ message: t(next ? "warehouses.toastOn" : "warehouses.toastOff", { site: name(site) }), tone: "info" });
  };

  return (
    <>
      <SettingsCard
        title={t("warehouses.sitesTitle")}
        description={t("warehouses.sitesDesc")}
        end={editSites ? undefined : <ReadOnlyLine />}
        footer={
          <>
            <Info aria-hidden />
            <span>{t("warehouses.unassignedNote")}</span>
            <Link href={`/${locale}/users`} className="inline-flex items-center gap-[4px] font-medium text-status-action">
              {t("warehouses.assignLink")}
              <ChevronRight className="h-[14px] w-[14px] rtl:-scale-x-100" aria-hidden />
            </Link>
          </>
        }
      >
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className={th}>{t("warehouses.colSite")}</th>
              <th className={th}>{t("warehouses.colAgents")}</th>
              <th className={th}>{t("warehouses.colCarriers")}</th>
              <th className={`${th} text-end`}>{t("warehouses.colActive")}</th>
            </tr>
          </thead>
          <tbody>
            {sitesData.data.map((s) => {
              const linked = carriers.filter((c) => c.warehouse_id === s.id);
              const n = s.assignedAgents.length;
              return (
                <tr key={s.id} className={trPlain}>
                  <td className={td}>
                    <div className="flex items-center gap-[10px]">
                      <Mark>
                        <Warehouse aria-hidden />
                      </Mark>
                      <div>
                        <b className="flex items-center gap-[6px] font-semibold">
                          {name(s)}
                          {s.isDefault && (
                            <RgBadge tone="plain" dot={false}>
                              {t("warehouses.default")}
                            </RgBadge>
                          )}
                        </b>
                        <span className="text-[12.5px] text-ink-secondary">{otherName(s)}</span>
                      </div>
                    </div>
                  </td>
                  <td className={td} title={s.assignedAgents.map((a) => a.name).join(", ")}>
                    {n === 0 ? (
                      <span className="inline-flex items-center gap-[5px] font-semibold text-status-warning">
                        <AlertTriangle className="h-[14px] w-[14px]" aria-hidden />
                        {t("warehouses.noAgent")}
                      </span>
                    ) : n === 1 ? (
                      t("warehouses.agentsOne")
                    ) : (
                      t("warehouses.agentsMany", { n })
                    )}
                  </td>
                  <td className={td}>
                    {linked.length === 0
                      ? "—"
                      : linked.map((c) => (
                          <div key={c.id} className="flex items-center gap-[6px]">
                            {c.name}
                            {!c.is_active && <RgBadge tone="warn">{t("warehouses.carrierOff")}</RgBadge>}
                          </div>
                        ))}
                  </td>
                  <td className={`${td} w-[1%] text-end`}>
                    {editSites ? (
                      <Switch checked={s.isActive} onChange={(v) => void toggle(s, v)} label={t("warehouses.switch", { site: name(s) })} />
                    ) : (
                      <StateBadge on={s.isActive} />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </SettingsCard>

      <SettingsCard title={t("warehouses.restockTitle")} description={t("warehouses.restockDesc")} end={editSites ? undefined : <ReadOnlyLine />}>
        <NumberSetting
          form={form}
          marketId={marketId}
          settingKey="supplier_lead_time_days"
          label={t("fields.supplier_lead_time_days.label")}
          unit={t("fields.supplier_lead_time_days.unit")}
          max={365}
          editable={editSites}
          help={(n) => t("fields.supplier_lead_time_days.help", { n })}
        />
      </SettingsCard>

      {confirm && (
        <ConfirmDialog
          title={t("warehouses.confirmTitle", { site: name(confirm.site) })}
          body={
            <>
              {confirm.agents.length > 0 && <p className="m-0">{t("warehouses.confirmAgents", { names: confirm.agents.map((a) => a.name).join(", ") })}</p>}
              {confirm.stock > 0 && <p className="m-0 mt-[6px]">{t("warehouses.confirmStock", { n: confirm.stock })}</p>}
            </>
          }
          cancelLabel={t("common.cancel")}
          confirmLabel={t("warehouses.confirmGo")}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const c = confirm;
            setConfirm(null);
            void toggle(c.site, false, true);
          }}
        />
      )}
    </>
  );
}
