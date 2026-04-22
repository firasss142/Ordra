"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";
import {
  LEAD_STATUSES,
  LEAD_SOURCES,
  type LeadStatus,
  type LeadSource,
} from "@/types/lead";
import { useLeads } from "@/hooks/useLeads";
import { formatDateTime } from "@/lib/format";
import { LeadStatusBadge } from "./LeadStatusBadge";
import { LeadsKanban } from "./LeadsKanban";

const NewLeadModal = dynamic(
  () => import("./NewLeadModal").then((m) => m.NewLeadModal),
  { ssr: false },
);
const CsvImportModal = dynamic(
  () => import("./CsvImportModal").then((m) => m.CsvImportModal),
  { ssr: false },
);
import { DensityToggle } from "@/components/shared/DensityToggle";
import type { KanbanDensity } from "@/components/shared/KanbanBoard";

const VIEW_STORAGE_KEY = "crm.leads.view";
const DENSITY_STORAGE_KEY = "crm.leads.density";
type LeadsView = "list" | "kanban";

interface LeadListProps {
  role: Role;
  marketId: string | null;
  locale: string;
}

const thStyle: React.CSSProperties = {
  padding: "12px 16px",
  textAlign: "start",
  fontSize: 13,
  fontWeight: 500,
  color: "#6D7175",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  borderBottom: "1px solid #E1E3E5",
};

const tdStyle: React.CSSProperties = {
  padding: "12px 16px",
  fontSize: 14,
  color: "#1A1A1A",
  borderBottom: "1px solid #E1E3E5",
};

const inputStyle: React.CSSProperties = {
  height: 32,
  padding: "0 8px",
  fontSize: 13,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  outline: "none",
};

export function LeadList({ role, marketId, locale }: LeadListProps) {
  const t = useTranslations("crm.leads");
  const tStatuses = useTranslations("crm.leads.statuses");
  const tSources = useTranslations("crm.leads.sources");

  const [page, setPage] = useState(1);
  const [filterStatus, setFilterStatus] = useState<string>("");
  const [filterSource, setFilterSource] = useState<string>("");
  const [newLeadOpen, setNewLeadOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [view, setView] = useState<LeadsView>("list");
  const [density, setDensity] = useState<KanbanDensity>("comfortable");

  React.useEffect(() => {
    if (typeof window === "undefined") return;
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    if (stored === "list" || stored === "kanban") setView(stored);
    const storedDensity = window.localStorage.getItem(DENSITY_STORAGE_KEY);
    if (storedDensity === "comfortable" || storedDensity === "compact") {
      setDensity(storedDensity);
    }
  }, []);

  const switchView = (v: LeadsView) => {
    setView(v);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(VIEW_STORAGE_KEY, v);
    }
  };

  const switchDensity = (d: KanbanDensity) => {
    setDensity(d);
    if (typeof window !== "undefined") {
      window.localStorage.setItem(DENSITY_STORAGE_KEY, d);
    }
  };

  const { leads, total, limit, isLoading, mutate } = useLeads({
    marketId: marketId ?? undefined,
    status: filterStatus || undefined,
    source: filterSource || undefined,
    page,
    limit: 50,
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));
  const localeHref = `/${locale}/leads`;

  return (
    <div>
      {/* Filters + action bar */}
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          marginBottom: 16,
        }}
      >
        <select
          value={filterStatus}
          onChange={(e) => {
            setFilterStatus(e.target.value);
            setPage(1);
          }}
          style={inputStyle}
        >
          <option value="">{t("allStatuses")}</option>
          {LEAD_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatuses(s)}
            </option>
          ))}
        </select>

        <select
          value={filterSource}
          onChange={(e) => {
            setFilterSource(e.target.value);
            setPage(1);
          }}
          style={inputStyle}
        >
          <option value="">{t("allSources")}</option>
          {LEAD_SOURCES.map((s) => (
            <option key={s} value={s}>
              {tSources(s)}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={() => {
            setFilterStatus("");
            setFilterSource("");
            setPage(1);
          }}
          style={{
            ...inputStyle,
            cursor: "pointer",
            padding: "0 12px",
          }}
        >
          {t("reset")}
        </button>

        <div style={{ marginInlineStart: "auto", display: "flex", gap: 8 }}>
          {view === "kanban" && (
            <DensityToggle value={density} onChange={switchDensity} />
          )}
          <div
            role="tablist"
            aria-label="view"
            style={{
              display: "inline-flex",
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              overflow: "hidden",
            }}
          >
            <button
              type="button"
              role="tab"
              aria-selected={view === "list"}
              onClick={() => switchView("list")}
              style={{
                height: 32,
                padding: "0 10px",
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                background: view === "list" ? "#1A1A1A" : "white",
                color: view === "list" ? "white" : "#1A1A1A",
              }}
            >
              {t("view.list")}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={view === "kanban"}
              onClick={() => switchView("kanban")}
              style={{
                height: 32,
                padding: "0 10px",
                fontSize: 12,
                border: "none",
                cursor: "pointer",
                background: view === "kanban" ? "#1A1A1A" : "white",
                color: view === "kanban" ? "white" : "#1A1A1A",
              }}
            >
              {t("view.kanban")}
            </button>
          </div>
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            style={{
              ...inputStyle,
              cursor: "pointer",
              padding: "0 12px",
            }}
          >
            ↑ CSV
          </button>
          <button
            type="button"
            onClick={() => setNewLeadOpen(true)}
            style={{
              height: 32,
              padding: "0 14px",
              fontSize: 13,
              fontWeight: 500,
              border: "1px solid #1A1A1A",
              borderRadius: 6,
              background: "#1A1A1A",
              color: "white",
              cursor: "pointer",
            }}
          >
            + {t("newLead")}
          </button>
        </div>
      </div>

      {view === "kanban" ? (
        <LeadsKanban
          marketId={marketId}
          locale={locale}
          sourceFilter={filterSource || undefined}
          density={density}
        />
      ) : (
      /* Table */
      <div
        style={{
          background: "white",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("columns.customer")}</th>
              <th style={thStyle}>{t("columns.phone")}</th>
              <th style={thStyle}>{t("columns.source")}</th>
              <th style={thStyle}>{t("columns.status")}</th>
              <th style={thStyle}>{t("columns.date")}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && leads.length === 0 ? (
              <tr>
                <td colSpan={5} style={{ ...tdStyle, textAlign: "center", padding: 48 }}>
                  …
                </td>
              </tr>
            ) : leads.length === 0 ? (
              <tr>
                <td
                  colSpan={5}
                  style={{
                    ...tdStyle,
                    textAlign: "center",
                    padding: 48,
                    color: "#6D7175",
                  }}
                >
                  {t("emptyState")}
                </td>
              </tr>
            ) : (
              leads.map((l) => (
                <tr key={l.id} style={{ cursor: "pointer" }}>
                  <td style={tdStyle}>
                    <Link
                      href={`${localeHref}/${l.id}`}
                      style={{
                        color: "#1A1A1A",
                        textDecoration: "none",
                        fontWeight: 500,
                      }}
                    >
                      {l.customer_name}
                    </Link>
                    {l.customer_city && (
                      <div style={{ fontSize: 12, color: "#6B7280" }}>
                        {l.customer_city}
                      </div>
                    )}
                  </td>
                  <td style={tdStyle}>
                    <a
                      href={`tel:${l.customer_phone}`}
                      style={{ color: "#1A1A1A", textDecoration: "none" }}
                    >
                      {l.customer_phone}
                    </a>
                  </td>
                  <td style={tdStyle}>{tSources(l.source)}</td>
                  <td style={tdStyle}>
                    <LeadStatusBadge status={l.status as LeadStatus} />
                  </td>
                  <td style={{ ...tdStyle, color: "#6B7280", fontSize: 13 }}>
                    {formatDateTime(l.created_at, locale)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      )}

      {view === "list" && (
      /* Pagination */
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 16,
          fontSize: 13,
          color: "#6D7175",
        }}
      >
        <span>{t("totalCount", { count: total })}</span>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="button"
            disabled={page <= 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            style={{
              ...inputStyle,
              cursor: page <= 1 ? "not-allowed" : "pointer",
              color: page <= 1 ? "#9CA3AF" : "#1A1A1A",
            }}
          >
            {t("previous")}
          </button>
          <span>{t("pageOf", { page, total: totalPages })}</span>
          <button
            type="button"
            disabled={page >= totalPages}
            onClick={() => setPage((p) => p + 1)}
            style={{
              ...inputStyle,
              cursor: page >= totalPages ? "not-allowed" : "pointer",
              color: page >= totalPages ? "#9CA3AF" : "#1A1A1A",
            }}
          >
            {t("next")}
          </button>
        </div>
      </div>
      )}

      {newLeadOpen && (
        <NewLeadModal
          open={newLeadOpen}
          onClose={() => setNewLeadOpen(false)}
          onCreated={() => mutate()}
          defaultMarketId={marketId}
          isSuperAdmin={role === "super_admin"}
          locale={locale}
        />
      )}
      {csvOpen && (
        <CsvImportModal
          open={csvOpen}
          locale={locale}
          defaultMarketId={marketId}
          isSuperAdmin={role === "super_admin"}
          onClose={() => setCsvOpen(false)}
          onImported={() => mutate()}
        />
      )}
    </div>
  );
}
