"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { KpiCard } from "@/components/dashboard/KpiCard";
import { computeHealthState, formatRelative, type HealthState } from "@/components/settings/storefronts/HealthBadge";
import { computeCarrierHealth, type CarrierHealthState } from "@/components/settings/carriers/CarrierHealthBadge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Storefront {
  id: string; market_id: string; platform: string; name: string;
  is_active: boolean; last_webhook_received_at: string | null;
  last_webhook_status: "processed" | "ignored" | "error" | null; webhook_failure_count: number;
}
interface Carrier { id: string; name: string; code: string; is_active: boolean; }
interface PerfRow { carrier_id: string; delivery_rate_30d: number | null; sample_size: number; }

interface Props {
  marketId: string;
  onNavigate: (tab: string) => void;
}

const SF_TONE: Record<HealthState, "success" | "warning" | "critical" | "neutral"> = {
  ok: "success", stale: "warning", failing: "critical", never: "neutral", inactive: "neutral",
};
const CA_TONE: Record<CarrierHealthState, "success" | "warning" | "critical" | "neutral"> = {
  connected: "success", idle: "warning", failing: "critical", inactive: "neutral", unknown: "neutral",
};

/** Automations known from vercel.json + pg_cron migrations. Freshness is illustrative
 *  until Journaux → Synchronisations wires the real run tables. */
const AUTOMATIONS: { name: string; cadence: string }[] = [
  { name: "poll-carriers", cadence: "toutes les 10 min" },
  { name: "dispatch-scheduled", cadence: "toutes les 5 min" },
  { name: "google-sheets-sync", cadence: "toutes les 15 min" },
  { name: "darb-sync", cadence: "toutes les 15 min" },
  { name: "meta-ads-sync", cadence: "toutes les heures" },
  { name: "darb-rates-harvest", cadence: "quotidien · 03:00" },
];

export function OverviewPanel({ marketId, onNavigate }: Props) {
  const { data: sfData } = useSWR<{ data: Storefront[] }>(marketId ? `/api/storefronts?market_id=${marketId}` : null, fetcher);
  const { data: caData } = useSWR<{ data: Carrier[] }>(marketId ? `/api/carriers?market_id=${marketId}` : null, fetcher);
  const { data: perfData } = useSWR<{ data: PerfRow[] }>(marketId ? `/api/carriers/performance?market_id=${marketId}` : null, fetcher);

  const storefronts = sfData?.data ?? [];
  const carriers = caData?.data ?? [];
  const perfById = useMemo(() => {
    const m: Record<string, PerfRow> = {};
    for (const p of perfData?.data ?? []) m[p.carrier_id] = p;
    return m;
  }, [perfData]);

  const sfRows = storefronts.map((s) => ({
    s,
    health: computeHealthState({
      is_active: s.is_active, last_webhook_received_at: s.last_webhook_received_at,
      last_webhook_status: s.last_webhook_status, webhook_failure_count: s.webhook_failure_count,
    }),
  }));
  const caRows = carriers.map((c) => ({
    c,
    health: computeCarrierHealth({
      is_active: c.is_active, reachable: null,
      delivery_rate_30d: perfById[c.id]?.delivery_rate_30d ?? null, sample_size: perfById[c.id]?.sample_size ?? 0,
    }),
  }));

  const total = sfRows.length + caRows.length;
  const active = sfRows.filter((r) => r.s.is_active).length + caRows.filter((r) => r.c.is_active).length;
  const failing =
    sfRows.filter((r) => r.health === "failing").length + caRows.filter((r) => r.health === "failing").length;
  const archived =
    sfRows.filter((r) => r.health === "inactive").length + caRows.filter((r) => r.health === "inactive").length;

  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Connecteurs actifs" value={`${active}`} subtitle={`sur ${total} · ${archived} archivé(s)`} />
        <KpiCard label="En erreur" value={`${failing}`} subtitle={failing ? "à traiter" : "aucun"} muted={failing === 0} />
        <KpiCard label="Storefronts" value={`${sfRows.length}`} subtitle={`${sfRows.filter((r) => r.health === "ok").length} sains`} />
        <KpiCard label="Transporteurs" value={`${caRows.length}`} subtitle={`${caRows.filter((r) => r.health === "connected").length} actifs`} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex items-center gap-3">
              <h3 className="text-[13.5px] font-semibold text-ink-primary">Storefronts</h3>
              <span className="text-[12.5px] text-ink-secondary">{sfRows.length} sources</span>
              <button type="button" onClick={() => onNavigate("storefronts")} className="ms-auto text-[12.5px] text-status-action hover:underline">Tout voir →</button>
            </CardHeader>
            {sfRows.slice(0, 5).map(({ s, health }) => (
              <div key={s.id} className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink-primary">{s.name}</span>
                  <span className="block text-[12px] text-ink-secondary">{s.platform}</span>
                </span>
                <Badge tone={SF_TONE[health]} dot className="ms-auto">{health === "ok" ? "Actif" : health === "failing" ? "En erreur" : health === "stale" ? "Silencieux" : health === "inactive" ? "Archivé" : "Jamais utilisé"}</Badge>
                <span className="w-24 text-end text-[12px] text-ink-secondary">{formatRelative(s.last_webhook_received_at)}</span>
              </div>
            ))}
            {sfRows.length > 5 && <div className="bg-surface-sunken px-4 py-2 text-[12.5px] text-ink-secondary">+ {sfRows.length - 5} autres</div>}
          </Card>

          <Card>
            <CardHeader className="flex items-center gap-3">
              <h3 className="text-[13.5px] font-semibold text-ink-primary">Transporteurs</h3>
              <span className="text-[12.5px] text-ink-secondary">{caRows.length} sociétés</span>
              <button type="button" onClick={() => onNavigate("carriers")} className="ms-auto text-[12.5px] text-status-action hover:underline">Tout voir →</button>
            </CardHeader>
            {caRows.slice(0, 5).map(({ c, health }) => (
              <div key={c.id} className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] font-medium text-ink-primary">{c.name}</span>
                  <span className="block font-mono text-[12px] text-ink-secondary">{c.code}</span>
                </span>
                <Badge tone={CA_TONE[health]} dot className="ms-auto">{health === "connected" ? "Actif" : health === "failing" ? "En erreur" : health === "idle" ? "Silencieux" : health === "inactive" ? "Archivé" : "Non testé"}</Badge>
              </div>
            ))}
          </Card>
        </div>

        <Card>
          <CardHeader><h3 className="text-[13.5px] font-semibold text-ink-primary">Automatisations</h3></CardHeader>
          <CardBody className="flex flex-col gap-0 p-0">
            {AUTOMATIONS.map((a) => (
              <div key={a.name} className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5 last:border-0">
                <span className="h-2 w-2 shrink-0 rounded-full bg-status-success" />
                <span className="min-w-0">
                  <span className="block font-mono text-[12.5px] text-ink-primary">{a.name}</span>
                  <span className="block text-[11.5px] text-ink-secondary">{a.cadence}</span>
                </span>
              </div>
            ))}
          </CardBody>
          <div className="border-t border-line-subtle bg-surface-sunken px-4 py-2.5 text-[11.5px] text-ink-secondary">
            Le détail des exécutions (statut, volume) arrivera dans <b>Journaux → Synchronisations</b>. pg_cron peut marquer « réussi » alors que l'appel HTTP a expiré — la vérité est dans <span className="font-mono">net._http_response</span>.
          </div>
        </Card>
      </div>
    </div>
  );
}
