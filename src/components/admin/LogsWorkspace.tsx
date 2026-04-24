"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
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
import {
  type CarrierEventRow,
  type WebhookLogRow,
  useCarrierEvents,
  useLogsSummary,
  useWebhookLogs,
} from "@/hooks/useLogsWorkspace";
import type { AuthUser } from "@/types";

type Tab = "webhooks" | "carrier";

type PayloadRow =
  | { kind: "webhook"; row: WebhookLogRow }
  | { kind: "carrier"; row: CarrierEventRow };

interface DetailPayload {
  kind: "webhook" | "carrier";
  id: string;
  payload: unknown;
  raw?: unknown;
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

function OutcomeBadge({
  value,
  labels,
}: {
  value: string | null;
  labels: { processed: string; ignored: string; error: string; unknown: string };
}) {
  let bg = "var(--neutral-bg)";
  let color = "var(--neutral)";
  let label = labels.unknown;

  if (value === "processed" || value === "delivered") {
    bg = "var(--success-bg)";
    color = "var(--success)";
    label = labels.processed;
  } else if (value === "ignored") {
    bg = "var(--warning-bg)";
    color = "var(--warning)";
    label = labels.ignored;
  } else if (value === "error" || value === "failed") {
    bg = "var(--critical-bg)";
    color = "var(--critical)";
    label = labels.error;
  }

  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        backgroundColor: bg,
        color,
      }}
    >
      {label}
    </span>
  );
}

export function LogsWorkspace({ user }: { user: AuthUser }) {
  const t = useTranslations("logs");
  const locale = user.locale;

  const [tab, setTab] = useState<Tab>("webhooks");
  const [page, setPage] = useState(1);
  const [failuresOnly, setFailuresOnly] = useState(true);
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
    search,
    enabled: isWebhooks,
  });

  const carrier = useCarrierEvents({
    page,
    limit: PAGE_LIMIT,
    failuresOnly,
    search,
    enabled: !isWebhooks,
  });

  const { summary } = useLogsSummary(60);

  const pagination = isWebhooks ? webhook.pagination : carrier.pagination;
  const totalPages = pagination ? Math.max(1, Math.ceil(pagination.total / pagination.limit)) : 1;

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
  };

  const refresh = () => {
    if (isWebhooks) webhook.refresh();
    else carrier.refresh();
  };

  return (
    <div style={{ backgroundColor: "#F6F6F7", minHeight: "100vh", padding: "32px 32px 64px" }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 20, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>
          {t("title")}
        </h1>
        <p style={{ fontSize: 13, color: "#6D7175", margin: "4px 0 0" }}>
          {t("subtitle")}
        </p>
      </header>

      <StatsStrip summary={summary} t={t} />

      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 12,
        }}
      >
        <Tabs tab={tab} onChange={switchTab} t={t} />

        <div style={{ flex: 1 }} />

        <form onSubmit={handleSearchSubmit} style={{ position: "relative" }}>
          <Search
            size={14}
            aria-hidden
            style={{
              position: "absolute",
              insetInlineStart: 10,
              top: "50%",
              transform: "translateY(-50%)",
              color: "#6D7175",
            }}
          />
          <input
            type="search"
            placeholder={t("searchPlaceholder")}
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            aria-label={t("searchAria")}
            style={{
              paddingBlock: 6,
              paddingInlineStart: 30,
              paddingInlineEnd: 10,
              fontSize: 13,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              minWidth: 260,
              background: "#FFFFFF",
              color: "#1A1A1A",
            }}
          />
        </form>

        <ToggleButton
          active={failuresOnly}
          onClick={() => {
            setFailuresOnly((v) => !v);
            setPage(1);
          }}
          label={t("failuresOnly")}
        />

        <button
          type="button"
          onClick={refresh}
          aria-label={t("refresh")}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "6px 10px",
            fontSize: 13,
            fontWeight: 500,
            background: "#FFFFFF",
            border: "1px solid #D1D5DB",
            borderRadius: 6,
            color: "#1A1A1A",
            cursor: "pointer",
          }}
        >
          <RefreshCw size={14} />
          {t("refresh")}
        </button>
      </div>

      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
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

      <p style={{ fontSize: 12, color: "#6D7175", marginBlockStart: 12 }}>
        {t("retentionNote")}
      </p>

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
                      typeof body?.error === "string" ? body.error : String(res.status),
                  }),
                });
              } else if (body?.result?.duplicate) {
                setReplayFeedback({ kind: "duplicate", message: t("replay.duplicate") });
              } else if (body?.result?.success || body?.result?.order_id) {
                setReplayFeedback({ kind: "success", message: t("replay.success") });
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
              setReplayFeedback({ kind: "error", message: t("replay.networkError") });
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
        webhook: { total: number; failed: number; failure_rate: number; buckets: { total: number; failed: number }[] };
        carrier: { total: number; failed: number; failure_rate: number; buckets: { total: number; failed: number }[] };
      }
    | undefined;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
        marginBottom: 16,
      }}
    >
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

  return (
    <div
      style={{
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 6,
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#6D7175", fontSize: 12, fontWeight: 500 }}>
        {icon}
        <span>{label}</span>
        <span style={{ marginInlineStart: "auto", color: "#6D7175" }}>{windowLabel}</span>
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12 }}>
        <span
          style={{
            fontSize: 24,
            fontWeight: 700,
            color: "#1A1A1A",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {total}
        </span>
        <span
          style={{
            fontSize: 13,
            fontWeight: 500,
            color: failureRate > 0 ? "var(--critical)" : "#6D7175",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {failed} / {failureRate.toFixed(1)}%
        </span>
      </div>
      <Sparkline totals={buckets} failed={failedBuckets} />
    </div>
  );
}

function Sparkline({ totals, failed }: { totals: number[]; failed: number[] }) {
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
      style={{ display: "block", maxWidth: "100%" }}
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

/* ───────────────────────────── Tabs ───────────────────────────── */

function Tabs({ tab, onChange, t }: { tab: Tab; onChange: (t: Tab) => void; t: ReturnType<typeof useTranslations> }) {
  return (
    <div
      role="tablist"
      style={{
        display: "inline-flex",
        backgroundColor: "#FFFFFF",
        border: "1px solid #E1E3E5",
        borderRadius: 6,
        padding: 2,
      }}
    >
      <TabButton active={tab === "webhooks"} onClick={() => onChange("webhooks")} icon={<Webhook size={14} />} label={t("tabs.webhooks")} />
      <TabButton active={tab === "carrier"} onClick={() => onChange("carrier")} icon={<Truck size={14} />} label={t("tabs.carrier")} />
    </div>
  );
}

function TabButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        all: "unset",
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 12px",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        borderRadius: 4,
        color: active ? "#1A1A1A" : "#6D7175",
        backgroundColor: active ? "#F2F2F2" : "transparent",
        transition: "background-color 120ms ease, color 120ms ease",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function ToggleButton({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={active}
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 10px",
        fontSize: 13,
        fontWeight: 500,
        cursor: "pointer",
        border: "1px solid",
        borderColor: active ? "var(--critical)" : "#D1D5DB",
        backgroundColor: active ? "var(--critical-bg)" : "#FFFFFF",
        color: active ? "var(--critical)" : "#1A1A1A",
        borderRadius: 6,
      }}
    >
      {active ? <AlertTriangle size={14} /> : <CheckCircle2 size={14} />}
      {label}
    </button>
  );
}

/* ───────────────────────────── Tables ───────────────────────────── */

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "start",
  fontSize: 12,
  fontWeight: 500,
  color: "#6D7175",
  borderBottom: "1px solid #D1D5DB",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  whiteSpace: "nowrap",
};

const tdBaseStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 13,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
  verticalAlign: "middle",
};

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
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ backgroundColor: "#FAFBFB" }}>
          <tr>
            <th style={thStyle}>{t("cols.date")}</th>
            <th style={thStyle}>{t("cols.source")}</th>
            <th style={thStyle}>{t("cols.event")}</th>
            <th style={thStyle}>{t("cols.externalId")}</th>
            <th style={thStyle}>{t("cols.status")}</th>
            <th style={thStyle}>{t("cols.order")}</th>
            <th style={thStyle}>{t("cols.message")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row)}
                style={{
                  cursor: "pointer",
                  backgroundColor: isSelected ? "#F2F2F2" : "#FFFFFF",
                  transition: "background-color 120ms ease",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#F7F7F7";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#FFFFFF";
                }}
              >
                <td style={{ ...tdBaseStyle, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {fmtDate(row.created_at, locale)}
                </td>
                <td style={tdBaseStyle}>{row.source ?? "—"}</td>
                <td style={{ ...tdBaseStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {row.event ?? "—"}
                </td>
                <td style={{ ...tdBaseStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {truncate(row.external_id, 22)}
                </td>
                <td style={tdBaseStyle}>
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
                <td style={{ ...tdBaseStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {row.order_id ? (
                    <Link
                      href={`/${locale}/orders/${row.order_id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "var(--action)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      {truncate(row.order_id, 10)}
                      <ExternalLink size={11} />
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  style={{
                    ...tdBaseStyle,
                    maxWidth: 280,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: row.error_message ? "var(--critical)" : "#6D7175",
                    fontSize: 12,
                  }}
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
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ backgroundColor: "#FAFBFB" }}>
          <tr>
            <th style={thStyle}>{t("cols.date")}</th>
            <th style={thStyle}>{t("cols.carrier")}</th>
            <th style={thStyle}>{t("cols.carrierSource")}</th>
            <th style={thStyle}>{t("cols.tracking")}</th>
            <th style={thStyle}>{t("cols.rawStatus")}</th>
            <th style={thStyle}>{t("cols.outcome")}</th>
            <th style={thStyle}>{t("cols.order")}</th>
            <th style={thStyle}>{t("cols.reason")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isSelected = row.id === selectedId;
            return (
              <tr
                key={row.id}
                onClick={() => onSelect(row)}
                style={{
                  cursor: "pointer",
                  backgroundColor: isSelected ? "#F2F2F2" : "#FFFFFF",
                }}
                onMouseEnter={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#F7F7F7";
                }}
                onMouseLeave={(e) => {
                  if (!isSelected) (e.currentTarget as HTMLTableRowElement).style.backgroundColor = "#FFFFFF";
                }}
              >
                <td style={{ ...tdBaseStyle, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
                  {fmtDate(row.created_at, locale)}
                </td>
                <td style={tdBaseStyle}>{row.carrier_code ?? "—"}</td>
                <td style={tdBaseStyle}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 4,
                      fontSize: 12,
                      fontWeight: 500,
                      backgroundColor: "#F6F6F7",
                      color: "#6D7175",
                    }}
                  >
                    {row.source ?? "—"}
                  </span>
                </td>
                <td style={{ ...tdBaseStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {truncate(row.tracking_number, 22)}
                </td>
                <td style={{ ...tdBaseStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {truncate(row.carrier_status_raw, 18)}
                </td>
                <td style={tdBaseStyle}>
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
                <td style={{ ...tdBaseStyle, fontFamily: "ui-monospace, monospace", fontSize: 12 }}>
                  {row.order_id ? (
                    <Link
                      href={`/${locale}/orders/${row.order_id}`}
                      onClick={(e) => e.stopPropagation()}
                      style={{ color: "var(--action)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
                    >
                      {truncate(row.order_id, 10)}
                      <ExternalLink size={11} />
                    </Link>
                  ) : (
                    "—"
                  )}
                </td>
                <td
                  style={{
                    ...tdBaseStyle,
                    maxWidth: 240,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    color: row.outcome === "error" ? "var(--critical)" : "#6D7175",
                    fontSize: 12,
                  }}
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
    <div style={{ padding: 48, textAlign: "center", color: "#6D7175", fontSize: 13 }}>
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
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 16px",
        borderTop: "1px solid #E1E3E5",
        backgroundColor: "#FAFBFB",
      }}
    >
      <span style={{ fontSize: 13, color: "#6D7175", fontVariantNumeric: "tabular-nums" }}>
        {t("paginationLabel", { total, page, totalPages })}
      </span>
      <div style={{ display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={onPrev}
          disabled={page <= 1}
          aria-label={t("prev")}
          style={paginationButtonStyle(page <= 1)}
        >
          <ChevronLeft size={14} />
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={page >= totalPages}
          aria-label={t("next")}
          style={paginationButtonStyle(page >= totalPages)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

function paginationButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: "6px 10px",
    fontSize: 13,
    fontWeight: 500,
    border: "1px solid #D1D5DB",
    borderRadius: 4,
    backgroundColor: disabled ? "#F6F6F7" : "#FFFFFF",
    color: disabled ? "#9CA3AF" : "#1A1A1A",
    cursor: disabled ? "not-allowed" : "pointer",
    display: "inline-flex",
    alignItems: "center",
  };
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

  const id = selected.kind === "webhook" ? selected.row.id : selected.row.id;
  const canReplay =
    selected.kind === "webhook" && selected.row.status === "error";

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
        if (!controller.signal.aborted) setDetail({ kind: selected.kind, id, payload: null });
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [id, selected.kind]);

  const prettyJson =
    detail?.payload != null
      ? (() => { try { return JSON.stringify(detail.payload, null, 2); } catch { return String(detail.payload); } })()
      : "";

  const filteredJson = search.trim()
    ? prettyJson.split("\n").filter((line) => line.toLowerCase().includes(search.toLowerCase())).join("\n")
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
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "rgba(26, 26, 26, 0.5)",
          zIndex: 40,
        }}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={t("inspector.title")}
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          insetInlineEnd: 0,
          width: "min(560px, 92vw)",
          backgroundColor: "#FFFFFF",
          borderInlineStart: "1px solid #E1E3E5",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
          zIndex: 50,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <header
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid #E5E7EB",
            display: "flex",
            alignItems: "center",
            gap: 12,
          }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 12, color: "#6D7175", fontWeight: 500 }}>
              {isWebhook ? t("inspector.webhookTitle") : t("inspector.carrierTitle")}
            </div>
            <div
              style={{
                fontSize: 14,
                fontWeight: 600,
                color: "#1A1A1A",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                fontFamily: "ui-monospace, monospace",
              }}
            >
              {id}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("inspector.close")}
            style={{
              all: "unset",
              cursor: "pointer",
              padding: 6,
              borderRadius: 4,
              color: "#6D7175",
            }}
          >
            <X size={18} />
          </button>
        </header>

        <div style={{ padding: "16px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 8 }}>
          <MetaRow label={t("inspector.date")} value={fmtDate(row.created_at, locale)} mono />
          {isWebhook ? (
            <>
              <MetaRow label={t("cols.source")} value={(row as WebhookLogRow).source ?? "—"} />
              <MetaRow label={t("cols.event")} value={(row as WebhookLogRow).event ?? "—"} mono />
              <MetaRow label={t("cols.externalId")} value={(row as WebhookLogRow).external_id ?? "—"} mono />
            </>
          ) : (
            <>
              <MetaRow label={t("cols.carrier")} value={(row as CarrierEventRow).carrier_code ?? "—"} />
              <MetaRow label={t("cols.carrierSource")} value={(row as CarrierEventRow).source ?? "—"} />
              <MetaRow label={t("cols.tracking")} value={(row as CarrierEventRow).tracking_number ?? "—"} mono />
              <MetaRow label={t("cols.rawStatus")} value={(row as CarrierEventRow).carrier_status_raw ?? "—"} mono />
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
                style={{ color: "var(--action)", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: 4 }}
              >
                {orderId}
                <ExternalLink size={12} />
              </Link>
            </MetaRow>
          )}
          {isWebhook && (row as WebhookLogRow).error_message && (
            <MetaRow label={t("inspector.errorMessage")}>
              <span style={{ color: "var(--critical)" }}>{(row as WebhookLogRow).error_message}</span>
            </MetaRow>
          )}
          {!isWebhook && (row as CarrierEventRow).outcome_reason && (
            <MetaRow label={t("inspector.reason")}>
              <span style={{ color: "#6D7175" }}>{(row as CarrierEventRow).outcome_reason}</span>
            </MetaRow>
          )}
        </div>

        {canReplay && (
          <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", flexDirection: "column", gap: 8 }}>
            <button
              type="button"
              onClick={onReplay}
              disabled={replayBusy}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 14px",
                fontSize: 13,
                fontWeight: 500,
                backgroundColor: replayBusy ? "#F3F4F6" : "#1A1A1A",
                color: replayBusy ? "#9CA3AF" : "#FFFFFF",
                border: "1px solid transparent",
                borderRadius: 4,
                cursor: replayBusy ? "not-allowed" : "pointer",
              }}
            >
              <RotateCcw size={14} />
              {replayBusy ? t("replay.inProgress") : t("replay.action")}
            </button>
            <p style={{ margin: 0, fontSize: 12, color: "#6D7175" }}>
              {t("replay.help")}
            </p>
            {replayFeedback && (
              <div
                role="status"
                style={{
                  padding: "8px 10px",
                  borderRadius: 4,
                  fontSize: 12,
                  backgroundColor:
                    replayFeedback.kind === "duplicate"
                      ? "var(--warning-bg)"
                      : replayFeedback.kind === "success"
                        ? "var(--success-bg)"
                        : "var(--critical-bg)",
                  color:
                    replayFeedback.kind === "duplicate"
                      ? "var(--warning)"
                      : replayFeedback.kind === "success"
                        ? "var(--success)"
                        : "var(--critical)",
                }}
              >
                {replayFeedback.message}
              </div>
            )}
          </div>
        )}

        <div style={{ padding: "12px 20px", borderBottom: "1px solid #E5E7EB", display: "flex", alignItems: "center", gap: 8 }}>
          <input
            type="search"
            placeholder={t("inspector.searchPayload")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{
              flex: 1,
              padding: "6px 10px",
              fontSize: 12,
              fontFamily: "ui-monospace, monospace",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
            }}
          />
          <button
            type="button"
            onClick={handleCopy}
            disabled={!prettyJson}
            aria-label={t("inspector.copy")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              fontSize: 12,
              fontWeight: 500,
              backgroundColor: "#FFFFFF",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              color: "#1A1A1A",
              cursor: prettyJson ? "pointer" : "not-allowed",
            }}
          >
            <Copy size={12} />
            {copied ? t("inspector.copied") : t("inspector.copy")}
          </button>
        </div>

        <div style={{ flex: 1, overflow: "auto", padding: 16, backgroundColor: "#0F172A" }}>
          {loading ? (
            <div style={{ color: "#8C9196", fontSize: 12 }}>{t("loading")}</div>
          ) : detail && (detail.payload === null || detail.payload === undefined) ? (
            <div style={{ color: "#8C9196", fontSize: 12 }}>{t("inspector.noPayload")}</div>
          ) : (
            <pre
              style={{
                margin: 0,
                fontSize: 12,
                fontFamily: "ui-monospace, monospace",
                color: "#E3E5E7",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
              }}
            >
              {filteredJson || t("inspector.noSearchMatch")}
            </pre>
          )}
        </div>
      </aside>
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
    <div style={{ display: "flex", gap: 12, fontSize: 12 }}>
      <div style={{ minWidth: 110, color: "#6D7175", fontWeight: 500, textTransform: "uppercase", letterSpacing: "0.05em" }}>
        {label}
      </div>
      <div
        style={{
          flex: 1,
          color: "#1A1A1A",
          fontFamily: mono ? "ui-monospace, monospace" : undefined,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {children ?? value}
      </div>
    </div>
  );
}
