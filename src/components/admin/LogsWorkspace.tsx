"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  Search,
  Webhook,
  Truck,
  X,
} from "lucide-react";
import { SettingsPageHeader } from "@/components/settings/SettingsPageHeader";
import {
  type CarrierEventRow,
  type WebhookLogRow,
  useCarrierEvents,
  useLogsSummary,
  useWebhookLogs,
} from "@/hooks/useLogsWorkspace";
import type { AuthUser } from "@/types";

type Tab = "webhooks" | "carrier";
type OutcomeFilter = "all" | "processed" | "ignored" | "error";

type PayloadRow =
  | { kind: "webhook"; row: WebhookLogRow }
  | { kind: "carrier"; row: CarrierEventRow };

interface DetailPayload {
  kind: "webhook" | "carrier";
  id: string;
  payload: unknown;
}

const PAGE_LIMIT = 50;

function fmtDate(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleString(locale === "ar" ? "ar" : "fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}

function truncate(s: string | null | undefined, n = 18): string {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function outcomeBadgeClass(value: string | null): { className: string } {
  if (value === "processed" || value === "delivered") {
    return { className: "bg-status-successBg text-status-success" };
  }
  if (value === "ignored") {
    return { className: "bg-status-warningBg text-status-warning" };
  }
  if (value === "error" || value === "failed") {
    return { className: "bg-status-criticalBg text-status-critical" };
  }
  return { className: "bg-status-neutralBg text-status-neutral" };
}

function OutcomeBadge({
  value,
  labels,
}: {
  value: string | null;
  labels: { processed: string; ignored: string; error: string; unknown: string };
}) {
  const { className } = outcomeBadgeClass(value);
  let label = labels.unknown;
  if (value === "processed" || value === "delivered") label = labels.processed;
  else if (value === "ignored") label = labels.ignored;
  else if (value === "error" || value === "failed") label = labels.error;

  return (
    <span
      className={`inline-block rounded-pill px-2 py-0.5 text-[12px] font-medium ${className}`}
    >
      {label}
    </span>
  );
}

export function LogsWorkspace({ user }: { user: AuthUser }) {
  const t = useTranslations("logs");
  const locale = user.locale;
  const isRtl = user.direction === "rtl";

  const [tab, setTab] = useState<Tab>("webhooks");
  const [page, setPage] = useState(1);
  const [failuresOnly, setFailuresOnly] = useState(true);
  const [outcomeFilter, setOutcomeFilter] = useState<OutcomeFilter>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<PayloadRow | null>(null);
  const [replayBusy, setReplayBusy] = useState(false);
  const [replayFeedback, setReplayFeedback] = useState<
    { kind: "success" | "duplicate" | "error"; message: string } | null
  >(null);

  const isWebhooks = tab === "webhooks";

  const webhook = useWebhookLogs({
    page,
    limit: PAGE_LIMIT,
    failuresOnly,
    outcome: outcomeFilter,
    search,
    enabled: isWebhooks,
  });

  const carrier = useCarrierEvents({
    page,
    limit: PAGE_LIMIT,
    failuresOnly,
    outcome: outcomeFilter,
    search,
    enabled: !isWebhooks,
  });

  const { summary } = useLogsSummary(60);

  const pagination = isWebhooks ? webhook.pagination : carrier.pagination;
  const totalPages = pagination
    ? Math.max(1, Math.ceil(pagination.total / pagination.limit))
    : 1;

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    setSearch(searchInput.trim());
  };

  const switchTab = (next: Tab) => {
    setTab(next);
    setPage(1);
    setSelected(null);
    setReplayFeedback(null);
    setOutcomeFilter("all");
  };

  const refresh = () => {
    if (isWebhooks) webhook.refresh();
    else carrier.refresh();
  };

  return (
    <div
      dir={isRtl ? "rtl" : "ltr"}
      className="min-h-screen bg-surface-page p-4 sm:p-6"
    >
      <SettingsPageHeader
        title={t("title")}
        description={t("subtitle")}
        isRtl={isRtl}
      />

      <StatsStrip summary={summary} t={t} />

      <div className="mb-3 flex flex-wrap items-center gap-3">
        <Tabs tab={tab} onChange={switchTab} t={t} />

        <div className="flex-1" />

        <form onSubmit={handleSearchSubmit} className="relative">
          <Search
            size={14}
            aria-hidden
            className="absolute top-1/2 -translate-y-1/2 text-ink-secondary start-[10px]"
          />
          <input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t("searchAria")}
            className="min-w-[260px] rounded-md border border-line bg-surface-card py-1.5 pe-2.5 ps-7 text-[13px] text-ink-primary placeholder:text-ink-secondary"
          />
        </form>

        <OutcomeSelect
          value={outcomeFilter}
          onChange={(v) => {
            setOutcomeFilter(v);
            setPage(1);
            if (v !== "all") setFailuresOnly(false);
          }}
          t={t}
        />

        <ToggleButton
          active={failuresOnly}
          onClick={() => {
            setFailuresOnly((v) => {
              const next = !v;
              if (next) setOutcomeFilter("all");
              return next;
            });
            setPage(1);
          }}
          label={t("failuresOnly")}
        />

        <button
          type="button"
          onClick={refresh}
          aria-label={t("refresh")}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-card px-2.5 py-1.5 text-[13px] font-medium text-ink-primary hover:bg-surface-hover transition-colors duration-fast"
        >
          <RefreshCw size={14} />
          {t("refresh")}
        </button>
      </div>

      <div className="overflow-hidden rounded-card border border-line-subtle bg-surface-card">
        {isWebhooks ? (
          <WebhookTable
            rows={webhook.rows}
            isLoading={webhook.isLoading}
            locale={locale}
            onSelect={(row) => {
              setSelected({ kind: "webhook", row });
              setReplayFeedback(null);
            }}
            selectedId={selected?.kind === "webhook" ? selected.row.id : null}
            t={t}
          />
        ) : (
          <CarrierTable
            rows={carrier.rows}
            isLoading={carrier.isLoading}
            locale={locale}
            onSelect={(row) => {
              setSelected({ kind: "carrier", row });
              setReplayFeedback(null);
            }}
            selectedId={selected?.kind === "carrier" ? selected.row.id : null}
            t={t}
          />
        )}

        {pagination && pagination.total > 0 && (
          <PaginationBar
            page={page}
            totalPages={totalPages}
            total={pagination.total}
            onPrev={() => setPage((p) => Math.max(1, p - 1))}
            onNext={() => setPage((p) => Math.min(totalPages, p + 1))}
            t={t}
          />
        )}
      </div>

      <p className="mt-3 text-[12px] text-ink-secondary">{t("retentionNote")}</p>

      {selected && (
        <PayloadInspector
          selected={selected}
          locale={locale}
          onClose={() => setSelected(null)}
          t={t}
          onReplay={async () => {
            if (selected.kind !== "webhook") return;
            setReplayBusy(true);
            setReplayFeedback(null);
            try {
              const res = await fetch(
                `/api/admin/webhook-logs/${selected.row.id}/replay`,
                { method: "POST" },
              );
              const body = await res.json();
              if (!res.ok) {
                setReplayFeedback({
                  kind: "error",
                  message: t("replay.error", {
                    message:
                      typeof body?.error === "string"
                        ? body.error
                        : String(res.status),
                  }),
                });
              } else if (body?.result?.duplicate) {
                setReplayFeedback({
                  kind: "duplicate",
                  message: t("replay.duplicate"),
                });
              } else if (body?.result?.success || body?.result?.order_id) {
                setReplayFeedback({
                  kind: "success",
                  message: t("replay.success"),
                });
              } else {
                setReplayFeedback({
                  kind: "error",
                  message: t("replay.ambiguous", {
                    message: body?.result?.error ?? t("replay.noDetail"),
                  }),
                });
              }
              webhook.refresh();
            } catch {
              setReplayFeedback({
                kind: "error",
                message: t("replay.networkError"),
              });
            } finally {
              setReplayBusy(false);
            }
          }}
          replayBusy={replayBusy}
          replayFeedback={replayFeedback}
        />
      )}
    </div>
  );
}

/* ───────────────────────────── Stats strip ───────────────────────────── */

function StatsStrip({
  summary,
  t,
}: {
  summary:
    | {
        window_minutes: number;
        webhook: {
          total: number;
          failed: number;
          failure_rate: number;
          buckets: { total: number; failed: number }[];
        };
        carrier: {
          total: number;
          failed: number;
          failure_rate: number;
          buckets: { total: number; failed: number }[];
        };
      }
    | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
      <StatCard
        icon={<Webhook size={14} />}
        label={t("stats.webhookRate")}
        total={summary?.webhook.total ?? 0}
        failed={summary?.webhook.failed ?? 0}
        buckets={summary?.webhook.buckets.map((b) => b.total) ?? []}
        failedBuckets={summary?.webhook.buckets.map((b) => b.failed) ?? []}
        windowLabel={t("stats.window60")}
      />
      <StatCard
        icon={<Truck size={14} />}
        label={t("stats.carrierRate")}
        total={summary?.carrier.total ?? 0}
        failed={summary?.carrier.failed ?? 0}
        buckets={summary?.carrier.buckets.map((b) => b.total) ?? []}
        failedBuckets={summary?.carrier.buckets.map((b) => b.failed) ?? []}
        windowLabel={t("stats.window60")}
      />
    </div>
  );
}

function StatCard({
  icon,
  label,
  total,
  failed,
  buckets,
  failedBuckets,
  windowLabel,
}: {
  icon: React.ReactNode;
  label: string;
  total: number;
  failed: number;
  buckets: number[];
  failedBuckets: number[];
  windowLabel: string;
}) {
  const failureRate = total > 0 ? (failed / total) * 100 : 0;
  const hasFailures = failed > 0;

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-subtle bg-surface-card p-4">
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-ink-secondary">
        {icon}
        <span>{label}</span>
        <span className="ms-auto">{windowLabel}</span>
      </div>
      <div className="flex items-baseline gap-3">
        <span className="text-[24px] font-bold tabular-nums text-ink-primary">
          {total}
        </span>
        <span
          className={`text-[13px] font-medium tabular-nums ${
            hasFailures ? "text-status-critical" : "text-ink-secondary"
          }`}
        >
          {failed} / {failureRate.toFixed(1)}%
        </span>
      </div>
      <Sparkline totals={buckets} failed={failedBuckets} />
    </div>
  );
}

function Sparkline({
  totals,
  failed,
}: {
  totals: number[];
  failed: number[];
}) {
  const width = 220;
  const height = 32;
  const max = Math.max(1, ...totals);
  const step = totals.length > 1 ? width / (totals.length - 1) : width;

  const totalsPath = totals
    .map((v, i) => {
      const x = i * step;
      const y = height - (v / max) * height;
      return `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");

  return (
    <svg
      width="100%"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block max-w-full"
      aria-hidden="true"
    >
      <path d={totalsPath} stroke="#1A1A1A" strokeWidth={1.5} fill="none" />
      {failed.map((f, i) =>
        f > 0 ? (
          <circle
            key={i}
            cx={i * step}
            cy={height - (totals[i] / max) * height}
            r={2}
            fill="var(--critical)"
          />
        ) : null,
      )}
    </svg>
  );
}

/* ───────────────────────────── Tabs / Toggles ───────────────────────────── */

function Tabs({
  tab,
  onChange,
  t,
}: {
  tab: Tab;
  onChange: (t: Tab) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      role="tablist"
      className="inline-flex rounded-md border border-line-subtle bg-surface-card p-0.5"
    >
      <TabButton
        active={tab === "webhooks"}
        onClick={() => onChange("webhooks")}
        icon={<Webhook size={14} />}
        label={t("tabs.webhooks")}
      />
      <TabButton
        active={tab === "carrier"}
        onClick={() => onChange("carrier")}
        icon={<Truck size={14} />}
        label={t("tabs.carrier")}
      />
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded px-3 py-1.5 text-[13px] font-medium transition-colors duration-fast ${
        active
          ? "bg-surface-selected text-ink-primary"
          : "text-ink-secondary hover:text-ink-primary"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

function ToggleButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[13px] font-medium transition-colors duration-fast ${
        active
          ? "border-status-critical bg-status-criticalBg text-status-critical"
          : "border-line bg-surface-card text-ink-primary hover:bg-surface-hover"
      }`}
    >
      {active ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {label}
    </button>
  );
}

function OutcomeSelect({
  value,
  onChange,
  t,
}: {
  value: OutcomeFilter;
  onChange: (v: OutcomeFilter) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <label className="inline-flex items-center gap-2 text-[12px] font-medium text-ink-secondary">
      <span className="uppercase tracking-wider">{t("cols.outcome")}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as OutcomeFilter)}
        className="rounded-md border border-line bg-surface-card px-2 py-1.5 text-[13px] font-medium text-ink-primary"
      >
        <option value="all">{t("filters.all")}</option>
        <option value="processed">{t("outcome.processed")}</option>
        <option value="ignored">{t("outcome.ignored")}</option>
        <option value="error">{t("outcome.error")}</option>
      </select>
    </label>
  );
}

/* ───────────────────────────── Tables ───────────────────────────── */

const thClass =
  "px-4 py-3 text-start text-[12px] font-medium uppercase tracking-wider text-ink-secondary border-b border-line whitespace-nowrap";

const tdClass =
  "px-4 py-3 text-[13px] text-ink-primary border-b border-line-subtle align-middle";

function WebhookTable({
  rows,
  isLoading,
  locale,
  selectedId,
  onSelect,
  t,
}: {
  rows: WebhookLogRow[];
  isLoading: boolean;
  locale: string;
  selectedId: string | null;
  onSelect: (r: WebhookLogRow) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  if (isLoading && rows.length === 0) {
    return <TableState label={t("loading")} />;
  }
  if (rows.length === 0) {
    return <TableState label={t("empty")} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1024px] border-collapse">
        <thead className="bg-surface-page">
          <tr>
            <th className={thClass}>{t("cols.date")}</th>
            <th className={thClass}>{t("cols.source")}</th>
            <th className={thClass}>{t("cols.event")}</th>
            <th className={thClass}>{t("cols.externalId")}</th>
            <th className={thClass}>{t("cols.status")}</th>
            <th className={thClass}>{t("cols.order")}</th>
            <th className={thClass}>{t("cols.message")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row)}
                className={`cursor-pointer transition-colors duration-fast ${
                  isSelected
                    ? "bg-surface-selected"
                    : "bg-surface-card hover:bg-surface-hover"
                }`}
              >
                <td className={`${tdClass} tabular-nums whitespace-nowrap`}>
                  {fmtDate(row.created_at, locale)}
                </td>
                <td className={tdClass}>{row.source ?? "—"}</td>
                <td
                  className={`${tdClass} font-mono text-[12px]`}
                >
                  {row.event ?? "—"}
                </td>
                <td className={`${tdClass} font-mono text-[12px]`}>
                  {truncate(row.external_id, 22)}
                </td>
                <td className={tdClass}>
                  <OutcomeBadge
                    value={row.status}
                    labels={{
                      processed: t("outcome.processed"),
                      ignored: t("outcome.ignored"),
                      error: t("outcome.error"),
                      unknown: t("outcome.unknown"),
                    }}
                  />
                </td>
                <td className={`${tdClass} font-mono text-[12px]`}>
                  {row.order_id ? (
                    <Link
                      href={`/${locale}/orders/${row.order_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-status-action no-underline hover:underline"
                    >
                      {truncate(row.order_id, 10)}
                      <ExternalLink size={11} />
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  className={`${tdClass} max-w-[280px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] ${
                    row.error_message
                      ? "text-status-critical"
                      : "text-ink-secondary"
                  }`}
                  title={row.error_message ?? undefined}
                >
                  {row.error_message ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function CarrierTable({
  rows,
  isLoading,
  locale,
  selectedId,
  onSelect,
  t,
}: {
  rows: CarrierEventRow[];
  isLoading: boolean;
  locale: string;
  selectedId: string | null;
  onSelect: (r: CarrierEventRow) => void;
  t: ReturnType<typeof useTranslations>;
}) {
  if (isLoading && rows.length === 0) {
    return <TableState label={t("loading")} />;
  }
  if (rows.length === 0) {
    return <TableState label={t("empty")} />;
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[1024px] border-collapse">
        <thead className="bg-surface-page">
          <tr>
            <th className={thClass}>{t("cols.date")}</th>
            <th className={thClass}>{t("cols.carrier")}</th>
            <th className={thClass}>{t("cols.carrierSource")}</th>
            <th className={thClass}>{t("cols.tracking")}</th>
            <th className={thClass}>{t("cols.rawStatus")}</th>
            <th className={thClass}>{t("cols.outcome")}</th>
            <th className={thClass}>{t("cols.order")}</th>
            <th className={thClass}>{t("cols.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row)}
                className={`cursor-pointer transition-colors duration-fast ${
                  isSelected
                    ? "bg-surface-selected"
                    : "bg-surface-card hover:bg-surface-hover"
                }`}
              >
                <td className={`${tdClass} tabular-nums whitespace-nowrap`}>
                  {fmtDate(row.created_at, locale)}
                </td>
                <td className={tdClass}>{row.carrier_code ?? "—"}</td>
                <td className={tdClass}>
                  <span className="inline-block rounded px-2 py-0.5 text-[12px] font-medium bg-surface-page text-ink-secondary">
                    {row.source ?? "—"}
                  </span>
                </td>
                <td className={`${tdClass} font-mono text-[12px]`}>
                  {truncate(row.tracking_number, 22)}
                </td>
                <td className={`${tdClass} font-mono text-[12px]`}>
                  {truncate(row.carrier_status_raw, 18)}
                </td>
                <td className={tdClass}>
                  <OutcomeBadge
                    value={row.outcome}
                    labels={{
                      processed: t("outcome.processed"),
                      ignored: t("outcome.ignored"),
                      error: t("outcome.error"),
                      unknown: t("outcome.unknown"),
                    }}
                  />
                </td>
                <td className={`${tdClass} font-mono text-[12px]`}>
                  {row.order_id ? (
                    <Link
                      href={`/${locale}/orders/${row.order_id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-status-action no-underline hover:underline"
                    >
                      {truncate(row.order_id, 10)}
                      <ExternalLink size={11} />
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  className={`${tdClass} max-w-[240px] overflow-hidden text-ellipsis whitespace-nowrap text-[12px] ${
                    row.outcome === "error"
                      ? "text-status-critical"
                      : "text-ink-secondary"
                  }`}
                  title={row.outcome_reason ?? undefined}
                >
                  {row.outcome_reason ?? "—"}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function TableState({ label }: { label: string }) {
  return (
    <div className="px-4 py-12 text-center text-[13px] text-ink-secondary">
      {label}
    </div>
  );
}

function PaginationBar({
  page,
  totalPages,
  total,
  onPrev,
  onNext,
  t,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div className="flex items-center justify-between border-t border-line-subtle bg-surface-page px-4 py-3">
      <span className="text-[13px] tabular-nums text-ink-secondary">
        {t("paginationLabel", { total, page, totalPages })}
      </span>
      <div className="flex gap-2">
        <PaginationButton
          onClick={onPrev}
          disabled={page <= 1}
          ariaLabel={t("prev")}
        >
          <ChevronLeft size={14} />
        </PaginationButton>
        <PaginationButton
          onClick={onNext}
          disabled={page >= totalPages}
          ariaLabel={t("next")}
        >
          <ChevronRight size={14} />
        </PaginationButton>
      </div>
    </div>
  );
}

function PaginationButton({
  onClick,
  disabled,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  disabled: boolean;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center rounded border border-line px-2.5 py-1.5 text-[13px] font-medium ${
        disabled
          ? "cursor-not-allowed bg-surface-page text-ink-muted"
          : "bg-surface-card text-ink-primary hover:bg-surface-hover"
      }`}
    >
      {children}
    </button>
  );
}

/* ───────────────────────────── Payload inspector ───────────────────────────── */

function PayloadInspector({
  selected,
  locale,
  onClose,
  onReplay,
  replayBusy,
  replayFeedback,
  t,
}: {
  selected: PayloadRow;
  locale: string;
  onClose: () => void;
  onReplay: () => void;
  replayBusy: boolean;
  replayFeedback: { kind: "success" | "duplicate" | "error"; message: string } | null;
  t: ReturnType<typeof useTranslations>;
}) {
  const [detail, setDetail] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const id = selected.row.id;
  const canReplay =
    selected.kind === "webhook" && selected.row.status === "error";

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const controller = new AbortController();
    setDetail(null);
    setLoading(true);
    setSearch("");
    const url =
      selected.kind === "webhook"
        ? `/api/admin/webhook-logs/${id}`
        : `/api/admin/carrier-events/${id}`;
    fetch(url, { signal: controller.signal })
      .then((r) => r.json())
      .then((body) => {
        if (selected.kind === "webhook") {
          setDetail({ kind: "webhook", id, payload: body?.data?.payload ?? null });
        } else {
          setDetail({ kind: "carrier", id, payload: body?.data?.raw_body ?? null });
        }
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setDetail({ kind: selected.kind, id, payload: null });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, selected.kind]);

  const prettyJson =
    detail?.payload != null
      ? (() => {
          try {
            return JSON.stringify(detail.payload, null, 2);
          } catch {
            return String(detail.payload);
          }
        })()
      : "";

  const filteredJson = search.trim()
    ? prettyJson
        .split("\n")
        .filter((line) =>
          line.toLowerCase().includes(search.toLowerCase()),
        )
        .join("\n")
    : prettyJson;

  const handleCopy = async () => {
    if (!prettyJson) return;
    try {
      await navigator.clipboard.writeText(prettyJson);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  const row = selected.row;
  const isWebhook = selected.kind === "webhook";
  const headerStatus = isWebhook
    ? (row as WebhookLogRow).status
    : (row as CarrierEventRow).outcome;
  const orderId = row.order_id;

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-[rgba(26,26,26,0.5)]"
      />
      <FocusTrap
        active
        focusTrapOptions={{
          escapeDeactivates: false,
          allowOutsideClick: true,
          initialFocus: () => closeButtonRef.current ?? undefined,
        }}
      >
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t("inspector.title")}
          className="fixed inset-y-0 z-50 flex w-[min(560px,92vw)] flex-col border-s border-line bg-surface-card shadow-floating end-0"
        >
          <header className="flex items-center gap-3 border-b border-line-subtle px-5 py-4">
            <div className="min-w-0 flex-1">
              <div className="text-[12px] font-medium text-ink-secondary">
                {isWebhook ? t("inspector.webhookTitle") : t("inspector.carrierTitle")}
              </div>
              <div className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[14px] font-semibold text-ink-primary">
                {id}
              </div>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={t("inspector.close")}
              className="cursor-pointer rounded p-1.5 text-ink-secondary hover:bg-surface-hover"
            >
              <X size={18} />
            </button>
          </header>

          <div className="flex flex-col gap-2 border-b border-line-subtle px-5 py-4">
            <MetaRow
              label={t("inspector.date")}
              value={fmtDate(row.created_at, locale)}
              mono
            />
            {isWebhook ? (
              <>
                <MetaRow
                  label={t("cols.source")}
                  value={(row as WebhookLogRow).source ?? "—"}
                />
                <MetaRow
                  label={t("cols.event")}
                  value={(row as WebhookLogRow).event ?? "—"}
                  mono
                />
                <MetaRow
                  label={t("cols.externalId")}
                  value={(row as WebhookLogRow).external_id ?? "—"}
                  mono
                />
              </>
            ) : (
              <>
                <MetaRow
                  label={t("cols.carrier")}
                  value={(row as CarrierEventRow).carrier_code ?? "—"}
                />
                <MetaRow
                  label={t("cols.carrierSource")}
                  value={(row as CarrierEventRow).source ?? "—"}
                />
                <MetaRow
                  label={t("cols.tracking")}
                  value={(row as CarrierEventRow).tracking_number ?? "—"}
                  mono
                />
                <MetaRow
                  label={t("cols.rawStatus")}
                  value={(row as CarrierEventRow).carrier_status_raw ?? "—"}
                  mono
                />
              </>
            )}
            <MetaRow label={t("cols.status")}>
              <OutcomeBadge
                value={headerStatus}
                labels={{
                  processed: t("outcome.processed"),
                  ignored: t("outcome.ignored"),
                  error: t("outcome.error"),
                  unknown: t("outcome.unknown"),
                }}
              />
            </MetaRow>
            {orderId && (
              <MetaRow label={t("cols.order")}>
                <Link
                  href={`/${locale}/orders/${orderId}`}
                  className="inline-flex items-center gap-1 text-status-action no-underline hover:underline"
                >
                  {orderId}
                  <ExternalLink size={12} />
                </Link>
              </MetaRow>
            )}
            {isWebhook && (row as WebhookLogRow).error_message && (
              <MetaRow label={t("inspector.errorMessage")}>
                <span className="text-status-critical">
                  {(row as WebhookLogRow).error_message}
                </span>
              </MetaRow>
            )}
            {!isWebhook && (row as CarrierEventRow).outcome_reason && (
              <MetaRow label={t("inspector.reason")}>
                <span className="text-ink-secondary">
                  {(row as CarrierEventRow).outcome_reason}
                </span>
              </MetaRow>
            )}
          </div>

          {canReplay && (
            <div className="flex flex-col gap-2 border-b border-line-subtle px-5 py-3">
              <button
                type="button"
                onClick={onReplay}
                disabled={replayBusy}
                className={`inline-flex items-center gap-2 self-start rounded px-3.5 py-2 text-[13px] font-medium ${
                  replayBusy
                    ? "cursor-not-allowed bg-surface-selected text-ink-muted"
                    : "bg-ink-primary text-white hover:opacity-90"
                }`}
              >
                <RotateCcw size={14} />
                {replayBusy ? t("replay.inProgress") : t("replay.action")}
              </button>
              <p className="m-0 text-[12px] text-ink-secondary">
                {t("replay.help")}
              </p>
              {replayFeedback && (
                <div
                  role="status"
                  className={`rounded px-2.5 py-2 text-[12px] ${
                    replayFeedback.kind === "duplicate"
                      ? "bg-status-warningBg text-status-warning"
                      : replayFeedback.kind === "success"
                        ? "bg-status-successBg text-status-success"
                        : "bg-status-criticalBg text-status-critical"
                  }`}
                >
                  {replayFeedback.message}
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-2 border-b border-line-subtle px-5 py-3">
            <input
              type="search"
              placeholder={t("inspector.searchPayload")}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="flex-1 rounded-md border border-line bg-surface-card px-2.5 py-1.5 font-mono text-[12px] text-ink-primary"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!prettyJson}
              aria-label={t("inspector.copy")}
              className={`inline-flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 text-[12px] font-medium text-ink-primary ${
                prettyJson
                  ? "cursor-pointer bg-surface-card hover:bg-surface-hover"
                  : "cursor-not-allowed bg-surface-page text-ink-muted"
              }`}
            >
              <Copy size={12} />
              {copied ? t("inspector.copied") : t("inspector.copy")}
            </button>
          </div>

          <div className="flex-1 overflow-auto bg-[#0F172A] p-4">
            {loading ? (
              <div className="text-[12px] text-[#8C9196]">{t("loading")}</div>
            ) : detail &&
              (detail.payload === null || detail.payload === undefined) ? (
              <div className="text-[12px] text-[#8C9196]">
                {t("inspector.noPayload")}
              </div>
            ) : (
              <pre className="m-0 whitespace-pre-wrap break-words font-mono text-[12px] text-[#E3E5E7]">
                {filteredJson || t("inspector.noSearchMatch")}
              </pre>
            )}
          </div>
        </aside>
      </FocusTrap>
    </>
  );
}

function MetaRow({
  label,
  value,
  mono,
  children,
}: {
  label: string;
  value?: string;
  mono?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex gap-3 text-[12px]">
      <div className="min-w-[110px] font-medium uppercase tracking-wider text-ink-secondary">
        {label}
      </div>
      <div
        className={`flex-1 overflow-hidden text-ellipsis text-ink-primary ${
          mono ? "font-mono" : ""
        }`}
      >
        {children ?? value}
      </div>
    </div>
  );
}
