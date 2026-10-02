"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, RefreshCw, Search, Copy } from "lucide-react";
import { useToast } from "@/components/ui/Toast";
import { LY_MARKET_ID, TN_MARKET_ID, marketIdToCode } from "@/lib/markets";
import { SettingsCard, RgBadge, EmptyState, Mark, Drawer, DrawerSection, th, td, trPlain, type RgTone } from "@/components/reglages/kit/parts";
import { RgButton } from "@/components/reglages/kit/RgButton";
import { LABELLED_SETTING_KEYS, LABELLED_USER_EVENTS } from "@/lib/journaux/labels";

type Tab = "received" | "carrier" | "sync" | "audit";
type Result = "" | "processed" | "ignored" | "error";

interface Counts {
  received: { total: number; failed: number };
  carrier: { total: number; failed: number };
  sync: { failed: number };
}
interface Page<T> {
  data: T[];
  pagination?: { page: number; limit: number; total: number };
}
interface WebhookRow {
  id: string;
  source: string;
  storefront_id: string | null;
  external_id: string | null;
  order_id: string | null;
  status: string;
  error_message: string | null;
  event: string | null;
  created_at: string;
}
interface CarrierEvent {
  id: string;
  carrier_code: string;
  tracking_number: string | null;
  carrier_status_raw: string | null;
  outcome: string;
  outcome_reason: string | null;
  created_at: string;
}
interface SyncRun {
  id: string;
  source: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  trigger: string;
  error: string | null;
}
interface AuditRow {
  id: string;
  kind: "settings" | "user";
  at: string;
  actor: string | null;
  meta: Record<string, unknown>;
}

const LIMIT = 50;
const CARRIERS: Record<string, string> = { darb_assabil: "Darb Assabil", navex: "Navex", dexpress: "Dexpress" };
const RESULT_TONE: Record<string, RgTone> = { processed: "ok", ignored: "neutral", error: "bad" };
const SYNC_TONE: Record<string, RgTone> = { succeeded: "ok", completed: "ok", failed: "bad", partial: "warn", running: "info" };
const ALGOS = ["manual", "round_robin", "workload", "percentage"];

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "" && v !== false) p.set(k, String(v));
  return p.toString();
}

/**
 * Système › Journaux (super_admin) — prototypes/reglages-v2.html?screen=logs:
 * four views in one soft track, a market filter, plain words (« Commandes
 * reçues », « Modifications », « Relancer le traitement ») and the received
 * data shown light, not in a black well.
 */
export function JournauxWorkspace() {
  const t = useTranslations("journaux");
  const locale = useLocale();
  const [tab, setTab] = useState<Tab>("received");
  const [market, setMarket] = useState("");
  const [result, setResult] = useState<Result>("");
  const [errorsOnly, setErrorsOnly] = useState(true);
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [page, setPage] = useState(1);
  const [opened, setOpened] = useState<WebhookRow | null>(null);

  useEffect(() => {
    const id = setTimeout(() => setQ(search.trim()), 300);
    return () => clearTimeout(id);
  }, [search]);
  useEffect(() => setPage(1), [tab, market, result, errorsOnly, q]);

  const live = { refreshInterval: 15_000 };
  const { data: counts, mutate: mutateCounts } = useSWR<Counts>(`/api/admin/logs/counts?${query({ market_id: market })}`, { refreshInterval: 30_000 });
  const filters = { page, limit: LIMIT, failures_only: errorsOnly, market_id: market, q };
  const received = useSWR<Page<WebhookRow>>(tab === "received" ? `/api/admin/webhook-logs?${query({ ...filters, status: errorsOnly ? "" : result })}` : null, live);
  const carrier = useSWR<Page<CarrierEvent>>(tab === "carrier" ? `/api/admin/carrier-events?${query({ ...filters, outcome: errorsOnly ? "" : result })}` : null, live);
  const sync = useSWR<Page<SyncRun>>(tab === "sync" ? "/api/admin/sync-runs?limit=100" : null, live);
  const audit = useSWR<Page<AuditRow>>(tab === "audit" ? `/api/admin/audit?${query({ limit: 150, market_id: market })}` : null);
  const shopsTn = useSWR<Page<{ id: string; name: string; platform: string }>>(`/api/storefronts?market_id=${TN_MARKET_ID}`);
  const shopsLy = useSWR<Page<{ id: string; name: string; platform: string }>>(`/api/storefronts?market_id=${LY_MARKET_ID}`);
  const shops = [...(shopsTn.data?.data ?? []), ...(shopsLy.data?.data ?? [])];

  const dateFmt = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(iso));
  const errorsLabel = (n: number) => (n === 1 ? t("errorsOne") : t("errorsMany", { n }));

  const tabBadge = (k: Tab) => {
    if (!counts) return null;
    if (k === "received") return counts.received.failed > 0 ? { bad: true, text: errorsLabel(counts.received.failed) } : { bad: false, text: counts.received.total.toLocaleString("fr-FR") };
    if (k === "carrier") return counts.carrier.failed > 0 ? { bad: true, text: errorsLabel(counts.carrier.failed) } : { bad: false, text: counts.carrier.total.toLocaleString("fr-FR") };
    if (k === "sync") return counts.sync.failed > 0 ? { bad: true, text: errorsLabel(counts.sync.failed) } : null;
    return null;
  };

  const refresh = () => {
    void mutateCounts();
    void (tab === "received" ? received : tab === "carrier" ? carrier : tab === "sync" ? sync : audit).mutate();
  };

  return (
    <div dir={locale === "ar" ? "rtl" : "ltr"} className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-[1180px] px-[16px] pb-[48px] pt-[24px] md:px-[24px]">
        <div className="mb-[16px]">
          <h1 className="m-0 mb-[4px] text-[20px] font-semibold tracking-[-.01em] text-ink-primary">{t("title")}</h1>
          <p className="m-0 max-w-[76ch] text-[14px] text-ink-secondary">{t("subtitle")}</p>
        </div>

        <div role="tablist" aria-label={t("title")} className="mb-[14px] inline-flex max-w-full gap-[2px] overflow-x-auto rounded-[10px] bg-[#E9EAEC] p-[3px]">
          {(["received", "carrier", "sync", "audit"] as const).map((k) => {
            const on = tab === k;
            const b = tabBadge(k);
            return (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => setTab(k)}
                className={`inline-flex items-center gap-[8px] whitespace-nowrap rounded-[8px] px-[14px] py-[7px] text-[13.5px] ${on ? "bg-white font-semibold text-ink-primary shadow-[0_0_0_1px_#E1E3E5]" : "font-medium text-ink-secondary"}`}
              >
                {t(`tabs.${k}`)}
                {b && (
                  <b className={`rounded-full px-[7px] text-[11.5px] font-semibold ${b.bad ? "bg-status-criticalBg text-status-critical" : "bg-black/5 text-ink-secondary"}`}>{b.text}</b>
                )}
              </button>
            );
          })}
        </div>

        <SettingsCard>
          <div className="flex flex-wrap items-center gap-[10px] border-b border-line-subtle px-[16px] py-[10px]">
            {tab !== "sync" && (
              <label className="flex h-[36px] min-w-[220px] max-w-[360px] flex-1 items-center gap-[8px] rounded-[8px] border border-[#D2D5D9] bg-white px-[10px]">
                <Search className="h-[16px] w-[16px] text-ink-secondary" aria-hidden />
                <input
                  className="min-w-0 flex-1 border-0 bg-transparent text-[14px] outline-none"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder={tab === "audit" ? t("searchAudit") : tab === "carrier" ? t("searchCarrier") : t("searchReceived")}
                  aria-label={tab === "audit" ? t("searchAudit") : tab === "carrier" ? t("searchCarrier") : t("searchReceived")}
                />
              </label>
            )}
            {tab !== "sync" && (
              <select aria-label={t("marketFilter")} value={market} onChange={(e) => setMarket(e.target.value)} className="h-[36px] rounded-[8px] border border-[#D2D5D9] bg-white px-[10px] text-[13.5px]">
                <option value="">{t("allMarkets")}</option>
                <option value={LY_MARKET_ID}>{t("market.ly")}</option>
                <option value={TN_MARKET_ID}>{t("market.tn")}</option>
              </select>
            )}
            {(tab === "received" || tab === "carrier") && (
              <>
                <select
                  aria-label={t("resultFilter")}
                  value={result}
                  disabled={errorsOnly}
                  onChange={(e) => setResult(e.target.value as Result)}
                  className="h-[36px] rounded-[8px] border border-[#D2D5D9] bg-white px-[10px] text-[13.5px] disabled:opacity-50"
                >
                  <option value="">{t("allResults")}</option>
                  {(["processed", "ignored", "error"] as const).map((r) => (
                    <option key={r} value={r}>
                      {t(`${tab === "carrier" ? "resultCarrier" : "result"}.${r}`)}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  aria-pressed={errorsOnly}
                  onClick={() => setErrorsOnly((v) => !v)}
                  className={`inline-flex h-[32px] items-center gap-[6px] rounded-full border px-[12px] text-[13px] ${errorsOnly ? "border-[#F5C6BC] bg-status-criticalBg font-semibold text-status-critical" : "border-[#D2D5D9] bg-white font-medium text-ink-secondary"}`}
                >
                  <AlertTriangle className="h-[14px] w-[14px]" aria-hidden />
                  {t("errorsOnly")}
                </button>
              </>
            )}
            <span className="flex-1" />
            <RgButton size="sm" variant="quiet" onClick={refresh}>
              <RefreshCw aria-hidden />
              {t("refresh")}
            </RgButton>
          </div>

          {tab === "received" && (
            <ReceivedTable page={received.data} shops={shops} dateFmt={dateFmt} onOpen={setOpened} />
          )}
          {tab === "carrier" && <CarrierTable page={carrier.data} dateFmt={dateFmt} />}
          {tab === "sync" && <SyncTable page={sync.data} dateFmt={dateFmt} />}
          {tab === "audit" && <AuditTable page={audit.data} q={q} />}

          {(tab === "received" || tab === "carrier") && (() => {
            const total = (tab === "received" ? received.data : carrier.data)?.pagination?.total ?? 0;
            if (total <= LIMIT) return null;
            const last = Math.ceil(total / LIMIT);
            return (
              <div className="flex items-center gap-[8px] rounded-b-[10px] border-t border-line-subtle bg-surface-sunken px-[16px] py-[10px] text-[12.5px] text-ink-secondary">
                <span>{t("page", { page, total: total.toLocaleString("fr-FR") })}</span>
                <span className="flex-1" />
                <RgButton size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  {t("prev")}
                </RgButton>
                <RgButton size="sm" disabled={page >= last} onClick={() => setPage((p) => p + 1)}>
                  {t("next")}
                </RgButton>
              </div>
            );
          })()}
        </SettingsCard>
      </div>
      {opened && <ReceivedDrawer row={opened} shopName={shops.find((s) => s.id === opened.storefront_id)?.name ?? opened.source} dateFmt={dateFmt} onClose={() => setOpened(null)} onReplayed={refresh} />}
    </div>
  );
}

function Empty() {
  const t = useTranslations("journaux");
  return <EmptyState icon={<Search aria-hidden />} title={t("empty")} />;
}

function ReceivedTable({ page, shops, dateFmt, onOpen }: { page: Page<WebhookRow> | undefined; shops: { id: string; name: string; platform: string }[]; dateFmt: (iso: string) => string; onOpen: (r: WebhookRow) => void }) {
  const t = useTranslations("journaux");
  if (!page) return null;
  if (page.data.length === 0) return <Empty />;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={th}>{t("col.receivedAt")}</th>
          <th className={th}>{t("col.shop")}</th>
          <th className={th}>{t("col.order")}</th>
          <th className={th}>{t("col.result")}</th>
          <th className={th}>{t("col.detail")}</th>
          <th className={`${th} w-[1%]`} />
        </tr>
      </thead>
      <tbody>
        {page.data.map((r) => {
          const shop = shops.find((s) => s.id === r.storefront_id);
          return (
            <tr key={r.id} className={trPlain}>
              <td className={`${td} whitespace-nowrap`}>{dateFmt(r.created_at)}</td>
              <td className={td}>
                <div className="flex items-center gap-[8px]">
                  <Mark size={26}>{(shop?.platform ?? r.source).slice(0, 2).toUpperCase()}</Mark>
                  <span className="font-medium">{shop?.name ?? r.source}</span>
                </div>
              </td>
              <td className={`${td} font-mono text-[12.5px]`} dir="ltr">
                {r.external_id ?? "—"}
              </td>
              <td className={td}>
                <RgBadge tone={RESULT_TONE[r.status] ?? "neutral"}>{RESULT_TONE[r.status] ? t(`result.${r.status}`) : r.status}</RgBadge>
              </td>
              <td className={`${td} max-w-[320px] truncate text-[12.5px] text-ink-secondary`} title={r.error_message ?? r.event ?? ""}>
                {r.error_message ?? r.event ?? "—"}
              </td>
              <td className={`${td} w-[1%] whitespace-nowrap`}>
                <RgButton size="sm" onClick={() => onOpen(r)}>
                  {t("seeData")}
                </RgButton>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function CarrierTable({ page, dateFmt }: { page: Page<CarrierEvent> | undefined; dateFmt: (iso: string) => string }) {
  const t = useTranslations("journaux");
  if (!page) return null;
  if (page.data.length === 0) return <Empty />;
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={th}>{t("col.carrierAt")}</th>
          <th className={th}>{t("col.carrier")}</th>
          <th className={th}>{t("col.tracking")}</th>
          <th className={th}>{t("col.carrierStatus")}</th>
          <th className={th}>{t("col.result")}</th>
          <th className={th}>{t("col.detail")}</th>
        </tr>
      </thead>
      <tbody>
        {page.data.map((r) => (
          <tr key={r.id} className={trPlain}>
            <td className={`${td} whitespace-nowrap`}>{dateFmt(r.created_at)}</td>
            <td className={td}>{CARRIERS[r.carrier_code] ?? r.carrier_code}</td>
            <td className={`${td} font-mono text-[12.5px]`} dir="ltr">
              {r.tracking_number ?? "—"}
            </td>
            <td className={td} dir="auto">
              {r.carrier_status_raw ?? "—"}
            </td>
            <td className={td}>
              <RgBadge tone={RESULT_TONE[r.outcome] ?? "neutral"}>{["processed", "ignored", "error"].includes(r.outcome) ? t(`resultCarrier.${r.outcome}`) : r.outcome}</RgBadge>
            </td>
            <td className={`${td} max-w-[320px] truncate text-[12.5px] text-ink-secondary`} title={r.outcome_reason ?? ""}>
              {r.outcome_reason ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SyncTable({ page, dateFmt }: { page: Page<SyncRun> | undefined; dateFmt: (iso: string) => string }) {
  const t = useTranslations("journaux");
  if (!page) return null;
  if (page.data.length === 0) return <Empty />;
  const duration = (r: SyncRun) => {
    if (!r.finished_at) return "—";
    const s = Math.max(0, Math.round((new Date(r.finished_at).getTime() - new Date(r.started_at).getTime()) / 1000));
    return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
  };
  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={th}>{t("col.startedAt")}</th>
          <th className={th}>{t("col.task")}</th>
          <th className={th}>{t("col.trigger")}</th>
          <th className={`${th} text-end`}>{t("col.duration")}</th>
          <th className={th}>{t("col.result")}</th>
          <th className={th}>{t("col.detail")}</th>
        </tr>
      </thead>
      <tbody>
        {page.data.map((r) => (
          <tr key={`${r.source}-${r.id}`} className={trPlain}>
            <td className={`${td} whitespace-nowrap`}>{dateFmt(r.started_at)}</td>
            <td className={`${td} font-medium`}>{r.source}</td>
            <td className={td}>{["cron", "manual", "schedule"].includes(r.trigger) ? t(`trigger.${r.trigger}`) : r.trigger}</td>
            <td className={`${td} text-end tabular-nums`}>{duration(r)}</td>
            <td className={td}>
              <RgBadge tone={SYNC_TONE[r.status] ?? "neutral"}>{SYNC_TONE[r.status] ? t(`sync.${r.status}`) : r.status}</RgBadge>
            </td>
            <td className={`${td} max-w-[320px] truncate text-[12.5px] text-ink-secondary`} title={r.error ?? ""}>
              {r.error ?? "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function AuditTable({ page, q }: { page: Page<AuditRow> | undefined; q: string }) {
  const t = useTranslations("journaux");
  const tr = useTranslations("reglages");
  const locale = useLocale();
  if (!page) return null;

  const keyLabel = (key: string) => (LABELLED_SETTING_KEYS.has(key) ? t(`keys.${key}`) : key);
  const value = (key: string, v: unknown): string => {
    if (v === null || v === undefined || v === "") return "—";
    if (typeof v === "boolean") return v ? t("yes") : t("no");
    if (typeof v === "number") return v.toLocaleString("fr-FR");
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "string") {
      if (key === "assignment_algorithm" && ALGOS.includes(v)) return tr(`team.algo.${v}.label`);
      if (key === "whatsapp_default_language" && (v === "fr" || v === "ar")) return tr(`language.${v}`);
      return v;
    }
    if (typeof v === "object") {
      const o = v as Record<string, unknown>;
      if (key === "shift_config" && o.start && o.end) return `${o.start}–${o.end}`;
      return Object.entries(o)
        .map(([k, x]) => `${k} ${typeof x === "number" ? x.toLocaleString("fr-FR") : String(x)}`)
        .join(" · ");
    }
    return String(v);
  };
  const marketName = (id: unknown) => {
    const code = marketIdToCode(typeof id === "string" ? id : null);
    return code ? t(`market.${code}`) : t("system");
  };
  const rows = page.data.map((r) => {
    const m = r.meta;
    const what =
      r.kind === "settings"
        ? keyLabel(String(m.key))
        : `${LABELLED_USER_EVENTS.has(String(m.event_type)) ? t(`userEvents.${m.event_type}`) : String(m.event_type)}${m.target ? ` · ${m.target}` : ""}`;
    return {
      r,
      what,
      before: r.kind === "settings" ? value(String(m.key), m.old) : "—",
      after: r.kind === "settings" ? value(String(m.key), m.new) : "—",
      market: marketName(m.market_id),
    };
  });
  const needle = q.toLowerCase();
  const shown = needle ? rows.filter((x) => `${x.what} ${x.r.actor ?? ""}`.toLowerCase().includes(needle)) : rows;
  if (shown.length === 0) return <Empty />;
  const date = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", year: "numeric" }).format(new Date(iso));

  return (
    <table className="w-full border-collapse">
      <thead>
        <tr>
          <th className={th}>{t("col.date")}</th>
          <th className={th}>{t("col.by")}</th>
          <th className={th}>{t("col.market")}</th>
          <th className={th}>{t("col.setting")}</th>
          <th className={th}>{t("col.before")}</th>
          <th className={th}>{t("col.after")}</th>
        </tr>
      </thead>
      <tbody>
        {shown.map(({ r, what, before, after, market }) => (
          <tr key={`${r.kind}-${r.id}`} className={trPlain}>
            <td className={`${td} whitespace-nowrap`}>{date(r.at)}</td>
            <td className={td}>{r.actor ?? "—"}</td>
            <td className={td}>
              <RgBadge tone="plain" dot={false}>
                {market}
              </RgBadge>
            </td>
            <td className={`${td} font-medium`}>{what}</td>
            <td className={`${td} text-ink-secondary`}>{before}</td>
            <td className={`${td} font-semibold`}>{after}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ReceivedDrawer({
  row,
  shopName,
  dateFmt,
  onClose,
  onReplayed,
}: {
  row: WebhookRow;
  shopName: string;
  dateFmt: (iso: string) => string;
  onClose: () => void;
  onReplayed: () => void;
}) {
  const t = useTranslations("journaux");
  const toast = useToast();
  const { data } = useSWR<{ data: WebhookRow & { payload: unknown } }>(`/api/admin/webhook-logs/${row.id}`);
  const [busy, setBusy] = useState(false);
  const full = data?.data;
  const json = full ? JSON.stringify(full.payload, null, 2) : "";

  const replay = async () => {
    setBusy(true);
    const res = await fetch(`/api/admin/webhook-logs/${row.id}/replay`, { method: "POST" });
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(false);
    toast.show({ message: res.ok ? t("drawer.replayed") : t("drawer.replayFailed", { reason: body.error ?? res.status }), tone: res.ok ? "info" : "critical" });
    if (res.ok) {
      onReplayed();
      onClose();
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={t("drawer.title", { ref: row.external_id ?? row.id.slice(0, 8) })}
      subtitle={
        <>
          {shopName} · {dateFmt(row.created_at)} · <RgBadge tone={RESULT_TONE[row.status] ?? "neutral"}>{["processed", "ignored", "error"].includes(row.status) ? t(`result.${row.status}`) : row.status}</RgBadge>
        </>
      }
      footer={
        <>
          {row.status === "error" && (
            <RgButton onClick={() => void replay()} disabled={busy}>
              <RefreshCw aria-hidden />
              {t("drawer.replay")}
            </RgButton>
          )}
          <span className="flex-1" />
          <RgButton onClick={onClose}>{t("close")}</RgButton>
        </>
      }
    >
      <DrawerSection title={t("drawer.outcome")}>
        <dl className="m-0 grid grid-cols-[150px_minmax(0,1fr)] gap-x-[14px] gap-y-[9px] text-[13.5px]">
          <dt className="text-ink-secondary">{t("drawer.order")}</dt>
          <dd className="m-0 font-mono text-[12.5px]">{row.order_id ?? t("drawer.noOrder")}</dd>
          {row.error_message && (
            <>
              <dt className="text-ink-secondary">{t("drawer.error")}</dt>
              <dd className="m-0 text-status-critical">{row.error_message}</dd>
            </>
          )}
        </dl>
      </DrawerSection>
      <DrawerSection
        title={t("drawer.payload")}
        end={
          json ? (
            <RgButton size="sm" onClick={() => void navigator.clipboard?.writeText(json)}>
              <Copy aria-hidden />
              {t("drawer.copy")}
            </RgButton>
          ) : undefined
        }
      >
        <pre dir="ltr" className="m-0 max-h-[420px] overflow-auto rounded-[8px] border border-line-subtle bg-surface-sunken px-[14px] py-[12px] text-start font-mono text-[12px] leading-[1.6] text-[#374151]">
          {json || "…"}
        </pre>
      </DrawerSection>
    </Drawer>
  );
}
