"use client";

import { useMemo } from "react";
import useSWR from "swr";
import { Card, CardHeader } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { computeHealthState, formatRelative, type HealthState } from "@/components/settings/storefronts/HealthBadge";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface SfRow {
  id: string; name: string; platform: string; market_code: string | null; is_active: boolean;
  last_webhook_received_at: string | null; last_webhook_status: "processed" | "ignored" | "error" | null; webhook_failure_count: number;
}
interface CaRow {
  id: string; name: string; code: string; market_code: string | null; is_active: boolean;
  delivery_fee: number | null; return_fee: number | null; events_24h: number; errors_24h: number;
}
interface SyncRow { source: string; label: string; cadence: string; last_run_at: string | null; runs_24h: number; }
interface Overview {
  storefronts: SfRow[]; carriers: CaRow[];
  services: { meta_accounts: number };
  automations: SyncRow[];
  kpis: {
    events_24h: number; errors_24h: number; error_rate: number; webhooks_24h: number;
    mappings_products: number; mappings_cities: number; mappings_warehouse: number; mappings_total: number;
  };
}

interface Props {
  onNavigate: (tab: string) => void;
}

type CarrierHealth = "ok" | "failing" | "idle" | "inactive" | "unconfigured";

const SF_TONE: Record<HealthState, "success" | "warning" | "critical" | "neutral"> = {
  ok: "success", stale: "warning", failing: "critical", never: "neutral", inactive: "neutral",
};
const SF_LABEL: Record<HealthState, string> = {
  ok: "Actif", stale: "Silencieux", failing: "En erreur", never: "Jamais utilisé", inactive: "Archivé",
};

const NO_ADAPTER = new Set(["cosmos", "manual", ""]);

function carrierHealth(c: CaRow): CarrierHealth {
  if (!c.is_active) return "inactive";
  if (NO_ADAPTER.has((c.code ?? "").toLowerCase()) || (!c.delivery_fee && !c.return_fee)) return "unconfigured";
  if (c.events_24h > 0 && c.errors_24h / c.events_24h >= 0.05) return "failing";
  if (c.events_24h > 0) return "ok";
  return "idle";
}
const CA_TONE: Record<CarrierHealth, "success" | "warning" | "critical" | "neutral"> = {
  ok: "success", failing: "critical", idle: "warning", inactive: "neutral", unconfigured: "warning",
};
const CA_LABEL: Record<CarrierHealth, string> = {
  ok: "Actif", failing: "En erreur", idle: "Silencieux", inactive: "Archivé", unconfigured: "Non configuré",
};

function storefrontMode(platform: string): string {
  if (platform === "google_sheets") return "sync";
  if (platform === "converty") return "import";
  return "webhook";
}

function minutesAgo(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

export function OverviewPanel({ onNavigate }: Props) {
  const { data, isLoading } = useSWR<{ data: Overview }>("/api/connections/overview", fetcher, { refreshInterval: 60_000 });
  const ov = data?.data;

  const sf = useMemo(() => (ov?.storefronts ?? []).map((s) => ({
    s, health: computeHealthState({
      is_active: s.is_active, last_webhook_received_at: s.last_webhook_received_at,
      last_webhook_status: s.last_webhook_status, webhook_failure_count: s.webhook_failure_count,
    }),
  })), [ov]);
  const ca = useMemo(() => (ov?.carriers ?? []).map((c) => ({ c, health: carrierHealth(c) })), [ov]);

  const total = sf.length + ca.length;
  const active = sf.filter((r) => r.s.is_active).length + ca.filter((r) => r.c.is_active).length;
  const healthy = sf.filter((r) => r.health === "ok").length + ca.filter((r) => r.health === "ok").length;
  const stale = sf.filter((r) => r.health === "stale").length + ca.filter((r) => r.health === "idle" || r.health === "unconfigured").length;
  const failing = sf.filter((r) => r.health === "failing").length + ca.filter((r) => r.health === "failing").length;
  const archived = sf.filter((r) => !r.s.is_active).length + ca.filter((r) => !r.c.is_active).length;

  const syncs = ov?.automations.filter((a) => a.last_run_at) ?? [];
  const freshest = syncs.reduce<number | null>((min, a) => {
    const m = minutesAgo(a.last_run_at);
    return m === null ? min : min === null ? m : Math.min(min, m);
  }, null);

  const kpis = ov?.kpis;
  const errorRate = kpis?.error_rate ?? 0;

  // À traiter — derived, real
  const todo: { tone: "critical" | "warning" | "neutral"; title: string; detail: string }[] = [];
  for (const { c } of ca) {
    if (c.is_active && c.events_24h > 0 && c.errors_24h / c.events_24h >= 0.05) {
      todo.push({ tone: "critical", title: `${c.name} — ${Math.round((c.errors_24h / c.events_24h) * 100)} % d'erreurs sur 24 h`, detail: `${c.errors_24h.toLocaleString("fr")} événements en erreur — jeton ou configuration à vérifier.` });
    }
    if (c.is_active && (NO_ADAPTER.has((c.code ?? "").toLowerCase()) || (!c.delivery_fee && !c.return_fee))) {
      todo.push({ tone: "warning", title: `${c.name} — frais à zéro`, detail: `Coût de livraison absent des calculs de rentabilité.` });
    }
  }
  const testConnectors = [...sf.filter((r) => /test/i.test(r.s.name)).map((r) => r.s.name), ...ca.filter((r) => /test/i.test(r.c.name)).map((r) => r.c.name)];
  if (testConnectors.length) todo.push({ tone: "neutral", title: `${testConnectors.length} connexion(s) de test à archiver`, detail: testConnectors.slice(0, 3).join(", ") });

  if (isLoading && !ov) {
    return <div className="py-16 text-center text-[13px] text-ink-secondary">Chargement de la vue d'ensemble…</div>;
  }

  return (
    <div className="flex flex-col gap-5">
      {/* KPI strip */}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-5">
        <Tile label="Connecteurs actifs" value={`${active}`} sub={`sur ${total}`} tone={failing ? undefined : "good"}>
          <DistBar parts={[{ v: healthy, c: "var(--brand)" }, { v: stale, c: "#B98900" }, { v: failing, c: "#D72C0D" }, { v: archived, c: "#E1E3E5" }]} />
          <Legend items={[{ c: "var(--brand)", t: `${healthy} sains` }, { c: "#B98900", t: `${stale} silencieux` }, { c: "#D72C0D", t: `${failing} en erreur` }, { c: "#E1E3E5", t: `${archived} archivé(s)` }]} />
        </Tile>

        <Tile label="Événements · 24 h" value={(kpis?.events_24h ?? 0).toLocaleString("fr")}>
          <p className="mt-auto text-[12px] text-ink-secondary">{(kpis?.webhooks_24h ?? 0).toLocaleString("fr")} webhook · {(kpis?.events_24h ?? 0).toLocaleString("fr")} transporteur</p>
        </Tile>

        <Tile label="Taux d'erreur · 24 h" value={`${errorRate}`} unit="%" tone={errorRate >= 5 ? "alarm" : errorRate > 0 ? "warn" : "good"}>
          <Meter pct={Math.min(100, errorRate)} tone={errorRate >= 5 ? "crit" : errorRate > 0 ? "warn" : "ok"} />
          <button type="button" onClick={() => onNavigate("carriers")} className="mt-1.5 text-start text-[12px] text-ink-secondary underline decoration-line-strong underline-offset-2">{(kpis?.errors_24h ?? 0).toLocaleString("fr")} erreurs · seuil conseillé 5 %</button>
        </Tile>

        <Tile label="Fraîcheur des syncs" value={freshest === null ? "—" : `${freshest}`} unit={freshest === null ? undefined : "min"}>
          <div className="mt-2 flex flex-col gap-1.5">
            {syncs.slice(0, 3).map((a) => {
              const m = minutesAgo(a.last_run_at) ?? 0;
              return (
                <div key={a.source} className="flex items-center gap-2 text-[12px]">
                  <span className="w-[86px] shrink-0 text-ink-secondary">{a.label}</span>
                  <span className="h-1.5 flex-1 overflow-hidden rounded-pill bg-line"><span className="block h-full rounded-pill bg-brand" style={{ width: `${Math.min(100, (m / 120) * 100)}%` }} /></span>
                  <b className="w-14 shrink-0 text-end tabular-nums">{m < 60 ? `${m} min` : `${Math.round(m / 60)} h`}</b>
                </div>
              );
            })}
          </div>
        </Tile>

        <Tile label="Correspondances" value={`${kpis?.mappings_total ?? 0}`}>
          <p className="mt-auto text-[12px] text-ink-secondary">{kpis?.mappings_products ?? 0} produits · {kpis?.mappings_cities ?? 0} villes · {kpis?.mappings_warehouse ?? 0} entrepôt</p>
          <button type="button" onClick={() => onNavigate("mappings")} className="text-start text-[12px] text-status-action hover:underline">Gérer les correspondances →</button>
        </Tile>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[2fr_1fr]">
        {/* connector groups */}
        <div className="flex flex-col gap-4">
          <Group title="Storefronts" meta={`${sf.length} sources`} onAll={() => onNavigate("storefronts")}>
            {sf.slice(0, 5).map(({ s, health }) => (
              <Row key={s.id}
                icon={s.platform === "google_sheets" ? "sheet" : "shop"}
                name={s.name} sub={`${s.market_code === "ly" ? "Libye" : s.market_code === "tn" ? "Tunisie" : "—"} · ${s.platform}`}
                mode={storefrontMode(s.platform)} tone={SF_TONE[health]} label={SF_LABEL[health]}
                right={formatRelative(s.last_webhook_received_at)} />
            ))}
            {sf.length > 5 && <Foot>+ {sf.length - 5} autres</Foot>}
          </Group>

          <Group title="Transporteurs" meta={`${ca.length} sociétés`} onAll={() => onNavigate("carriers")}>
            {ca.map(({ c, health }) => (
              <Row key={c.id} icon="truck"
                name={c.name} sub={`${c.market_code === "ly" ? "Libye" : c.market_code === "tn" ? "Tunisie" : "—"} · ${c.code}`}
                mode={health === "unconfigured" ? "manuel" : "dispatch"} tone={CA_TONE[health]} label={CA_LABEL[health]}
                right={c.events_24h > 0 ? `${c.events_24h.toLocaleString("fr")} évén.${c.errors_24h > 0 ? ` · ${Math.round((c.errors_24h / c.events_24h) * 100)} % err.` : ""}` : "—"}
                rightCrit={c.errors_24h > 0} />
            ))}
          </Group>

          <Group title="Services tiers" meta={`${ov?.services.meta_accounts ?? 0} compte(s) Meta`} onAll={() => onNavigate("services")}>
            <Row icon="globe" name="Meta Ads" sub={`${ov?.services.meta_accounts ?? 0} compte(s) · dépenses par campagne`} mode="sync" tone={(ov?.services.meta_accounts ?? 0) > 0 ? "success" : "neutral"} label={(ov?.services.meta_accounts ?? 0) > 0 ? "Connecté" : "Non connecté"} right="par heure" />
            <Row icon="sheet" name="Google Sheets" sub="compte de service · sources feuille" mode="sync" tone="success" label="Connecté" right={formatRelative(syncs.find((a) => a.source === "google-sheets-sync")?.last_run_at ?? null)} />
            <Row icon="chat" name="WhatsApp Business" sub="Cloud API · même app Meta" mode="—" tone="neutral" label="Non connecté" right="—" />
          </Group>
        </div>

        {/* side: automations + à traiter */}
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="flex items-center gap-2">
              <h3 className="text-[13.5px] font-semibold text-ink-primary">Automatisations</h3>
              <span className="text-[12.5px] text-ink-secondary">{ov?.automations.length ?? 0} tâches</span>
            </CardHeader>
            <div className="px-4 py-1">
              {(ov?.automations ?? []).map((a) => {
                const m = minutesAgo(a.last_run_at);
                const late = m !== null && m > 120;
                return (
                  <div key={a.source} className="flex items-center gap-3 border-b border-line-subtle py-2.5 last:border-0">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${a.last_run_at ? (late ? "bg-status-warning" : "bg-status-success") : "bg-line-strong"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-[12.5px] text-ink-primary">{a.source}</span>
                      <span className="block text-[11.5px] text-ink-secondary">{a.cadence}{a.runs_24h ? ` · ${a.runs_24h}/24 h` : ""}</span>
                    </span>
                    <span className="shrink-0 text-[12px] tabular-nums text-ink-secondary">{a.last_run_at ? formatRelative(a.last_run_at) : "—"}</span>
                  </div>
                );
              })}
            </div>
            <div className="border-t border-line-subtle bg-surface-sunken px-4 py-2.5 text-[11.5px] text-ink-secondary">
              pg_cron marque « réussi » même quand l'appel HTTP expire — la vérité est dans <span className="font-mono">net._http_response</span>.
            </div>
          </Card>

          <Card>
            <CardHeader><h3 className="text-[13.5px] font-semibold text-ink-primary">À traiter</h3></CardHeader>
            <div className="flex flex-col gap-3 px-4 py-3.5 text-[13px]">
              {todo.length === 0 && <p className="text-[12.5px] text-ink-secondary">Rien à signaler — tous les connecteurs sont sains.</p>}
              {todo.map((t, i) => (
                <div key={i} className="flex gap-2.5">
                  <Badge tone={t.tone === "critical" ? "critical" : t.tone === "warning" ? "warning" : "neutral"} dot>{i + 1}</Badge>
                  <div className="min-w-0">
                    <b className="text-ink-primary">{t.title}</b>
                    <div className="text-[12.5px] text-ink-secondary">{t.detail}</div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}

/* ---------- small presentational bits (prototype tiles) ---------- */

function Tile({ label, value, unit, sub, tone, children }: { label: string; value: string; unit?: string; sub?: string; tone?: "good" | "warn" | "alarm"; children?: React.ReactNode }) {
  const toneCls = tone === "alarm" ? "border-status-critical/30 bg-gradient-to-b from-status-criticalBg to-surface-card"
    : tone === "warn" ? "border-status-warning/30 bg-gradient-to-b from-status-warningBg to-surface-card"
    : tone === "good" ? "border-status-success/25 bg-gradient-to-b from-brand-tint to-surface-card"
    : "border-line-subtle bg-surface-card";
  const valCls = tone === "alarm" ? "text-status-critical" : tone === "warn" ? "text-status-warning" : "text-ink-primary";
  return (
    <div className={`flex min-h-[138px] flex-col gap-1 rounded-card border p-4 shadow-hover-row ${toneCls}`}>
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-ink-secondary">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1">
        <span className={`text-[31px] font-bold leading-none tracking-[-0.025em] tabular-nums ${valCls}`}>{value}</span>
        {unit && <span className="text-[14px] font-medium text-ink-secondary">{unit}</span>}
        {sub && <span className="ms-1 text-[12px] text-ink-secondary">{sub}</span>}
      </div>
      {children}
    </div>
  );
}

function DistBar({ parts }: { parts: { v: number; c: string }[] }) {
  const nonzero = parts.filter((p) => p.v > 0);
  return (
    <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-pill">
      {nonzero.map((p, i) => <span key={i} style={{ flex: p.v, background: p.c }} />)}
    </div>
  );
}
function Legend({ items }: { items: { c: string; t: string }[] }) {
  return (
    <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11.5px] text-ink-secondary">
      {items.filter((it) => !/^0 /.test(it.t)).map((it, i) => (
        <span key={i} className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm" style={{ background: it.c }} />{it.t}</span>
      ))}
    </div>
  );
}
function Meter({ pct, tone }: { pct: number; tone: "ok" | "warn" | "crit" }) {
  const bg = tone === "crit" ? "bg-status-critical" : tone === "warn" ? "bg-status-warning" : "bg-brand";
  const track = tone === "crit" ? "bg-status-criticalBg" : tone === "warn" ? "bg-status-warningBg" : "bg-line";
  return <div className={`mt-2 h-1.5 overflow-hidden rounded-pill ${track}`}><span className={`block h-full rounded-pill ${bg}`} style={{ width: `${pct}%` }} /></div>;
}

function Group({ title, meta, onAll, children }: { title: string; meta: string; onAll: () => void; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="flex items-center gap-3">
        <h3 className="text-[13.5px] font-semibold text-ink-primary">{title}</h3>
        <span className="text-[12.5px] text-ink-secondary">{meta}</span>
        <button type="button" onClick={onAll} className="ms-auto text-[12.5px] text-status-action hover:underline">Tout voir →</button>
      </CardHeader>
      {children}
    </Card>
  );
}
function Foot({ children }: { children: React.ReactNode }) {
  return <div className="bg-surface-sunken px-4 py-2 text-[12.5px] text-ink-secondary">{children}</div>;
}

function Row({ icon, name, sub, mode, tone, label, right, rightCrit }: {
  icon: "shop" | "sheet" | "truck" | "globe" | "chat"; name: string; sub: string; mode: string;
  tone: "success" | "warning" | "critical" | "neutral"; label: string; right: string; rightCrit?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-2.5 last:border-0">
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-status-neutralBg text-ink-secondary">
        <Icon kind={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink-primary">{name}</span>
        <span className="block truncate text-[12px] text-ink-secondary">{sub}</span>
      </span>
      <span className="hidden shrink-0 rounded-pill border border-line-subtle bg-surface-sunken px-2 py-0.5 text-[11.5px] text-ink-secondary sm:inline">{mode}</span>
      <Badge tone={tone} dot>{label}</Badge>
      <span className={`w-28 shrink-0 text-end text-[12px] tabular-nums ${rightCrit ? "text-status-critical" : "text-ink-secondary"}`}>{right}</span>
    </div>
  );
}

function Icon({ kind }: { kind: "shop" | "sheet" | "truck" | "globe" | "chat" }) {
  const p = {
    shop: <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4zM3 6h18" />,
    sheet: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 4v16" /></>,
    truck: <><path d="M1 3h13v13H1zM14 8h4l3 3v5h-7z" /><circle cx="5.5" cy="18.5" r="2" /><circle cx="17.5" cy="18.5" r="2" /></>,
    globe: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z" /></>,
    chat: <path d="M21 11.5a8.4 8.4 0 0 1-12.6 7.3L3 20.5l1.8-5.2A8.4 8.4 0 1 1 21 11.5z" />,
  }[kind];
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" className="h-[15px] w-[15px]">{p}</svg>;
}
