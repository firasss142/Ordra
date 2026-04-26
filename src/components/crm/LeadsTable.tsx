"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLeads } from "@/hooks/useLeads";
import { LeadStatusBadge } from "./LeadStatusBadge";
import type { Lead, LeadStatus, LeadSource } from "@/types/lead";

const MarkLostModal = dynamic(
  () => import("./MarkLostModal").then((m) => m.MarkLostModal),
  { ssr: false },
);
const ScheduleCallbackModal = dynamic(
  () => import("./ScheduleCallbackModal").then((m) => m.ScheduleCallbackModal),
  { ssr: false },
);
const ConvertLeadModal = dynamic(
  () => import("./ConvertLeadModal").then((m) => m.ConvertLeadModal),
  { ssr: false },
);
const ReassignLeadModal = dynamic(
  () => import("./ReassignLeadModal").then((m) => m.ReassignLeadModal),
  { ssr: false },
);

type ActiveModal = "callback" | "convert" | "lost" | "reassign" | null;

interface Props {
  marketId: string | null;
  locale: string;
  sourceFilter?: LeadSource | null;
  campaignId?: string | null;
  agentId?: string | null;
  isSuperAdmin?: boolean;
  hotOnly?: boolean;
  visibleStatuses?: LeadStatus[];
}

export function LeadsTable({
  marketId,
  locale,
  sourceFilter,
  campaignId,
  agentId,
  isSuperAdmin,
  hotOnly,
  visibleStatuses,
}: Props) {
  const t = useTranslations("crm.leads");
  const tActions = useTranslations("crm.leads.actions");

  const [page, setPage] = useState(1);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [activeModal, setActiveModal] = useState<ActiveModal>(null);

  const { leads, total, limit, isLoading, mutate } = useLeads({
    marketId: marketId ?? undefined,
    source: sourceFilter || undefined,
    campaignId: campaignId ?? undefined,
    agentId: agentId ?? undefined,
    hotOnly,
    page,
    limit: 50,
  });

  const totalPages = Math.max(1, Math.ceil(total / limit));

  const openModal = (modal: ActiveModal, lead: Lead) => {
    setActiveLead(lead);
    setActiveModal(modal);
  };
  const closeModal = () => {
    setActiveLead(null);
    setActiveModal(null);
  };

  const canReassign = isSuperAdmin || true; // managers can also reassign

  const thStyle: React.CSSProperties = {
    padding: "12px 16px",
    textAlign: "start",
    fontSize: 13,
    fontWeight: 500,
    color: "#6D7175",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    borderBottom: "1px solid #E1E3E5",
    whiteSpace: "nowrap",
  };

  const tdStyle: React.CSSProperties = {
    padding: "12px 16px",
    fontSize: 14,
    color: "#1A1A1A",
    borderBottom: "1px solid #F2F2F2",
    verticalAlign: "middle",
  };

  return (
    <>
      <div
        style={{
          background: "#fff",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflowX: "auto",
        }}
      >
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr>
              <th style={thStyle}>{t("columns.customer") || "Client"}</th>
              <th style={thStyle}>{t("columns.phone") || "Téléphone"}</th>
              <th style={thStyle}>{t("columns.city") || "Ville"}</th>
              <th style={thStyle}>{t("columns.status") || "Statut"}</th>
              <th style={thStyle}>{t("columns.source") || "Source"}</th>
              <th style={thStyle}>{t("columns.created") || "Créé"}</th>
              <th style={thStyle}></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#6D7175" }}>
                  …
                </td>
              </tr>
            )}
            {!isLoading && leads.length === 0 && (
              <tr>
                <td colSpan={7} style={{ ...tdStyle, textAlign: "center", color: "#6D7175" }}>
                  {t("emptyState")}
                </td>
              </tr>
            )}
            {leads.map((lead) => (
              <TableRow
                key={lead.id}
                lead={lead}
                locale={locale}
                tdStyle={tdStyle}
                tActions={tActions}
                canReassign={canReassign}
                onCallback={() => openModal("callback", lead)}
                onConvert={() => openModal("convert", lead)}
                onMarkLost={() => openModal("lost", lead)}
                onReassign={() => openModal("reassign", lead)}
              />
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "flex-end",
              gap: 8,
              padding: "10px 16px",
              borderTop: "1px solid #E1E3E5",
              fontSize: 13,
              color: "#6D7175",
            }}
          >
            <button
              type="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
              style={{
                padding: "4px 10px",
                border: "1px solid #D1D5DB",
                borderRadius: 4,
                background: "#fff",
                cursor: page === 1 ? "default" : "pointer",
                fontSize: 13,
                color: page === 1 ? "#D1D5DB" : "#1A1A1A",
              }}
            >
              {t("previous")}
            </button>
            <span>
              {t("pageOf", { page, total: totalPages })}
            </span>
            <button
              type="button"
              disabled={page === totalPages}
              onClick={() => setPage((p) => p + 1)}
              style={{
                padding: "4px 10px",
                border: "1px solid #D1D5DB",
                borderRadius: 4,
                background: "#fff",
                cursor: page === totalPages ? "default" : "pointer",
                fontSize: 13,
                color: page === totalPages ? "#D1D5DB" : "#1A1A1A",
              }}
            >
              {t("next")}
            </button>
          </div>
        )}
      </div>

      {activeModal === "callback" && activeLead && (
        <ScheduleCallbackModal
          open
          leadId={activeLead.id}
          locale={locale}
          onClose={closeModal}
          onDone={() => { closeModal(); mutate(); }}
        />
      )}
      {activeModal === "convert" && activeLead && (
        <ConvertLeadModal
          open
          lead={activeLead}
          locale={locale}
          onClose={closeModal}
          onConverted={() => { closeModal(); mutate(); }}
        />
      )}
      {activeModal === "lost" && activeLead && (
        <MarkLostModal
          open
          leadId={activeLead.id}
          locale={locale}
          onClose={closeModal}
          onDone={() => { closeModal(); mutate(); }}
        />
      )}
      {activeModal === "reassign" && activeLead && marketId && (
        <ReassignLeadModal
          open
          lead={activeLead}
          marketId={marketId}
          onClose={closeModal}
          onDone={() => { closeModal(); mutate(); }}
        />
      )}
    </>
  );
}

interface RowProps {
  lead: Lead;
  locale: string;
  tdStyle: React.CSSProperties;
  tActions: ReturnType<typeof useTranslations>;
  canReassign: boolean;
  onCallback: () => void;
  onConvert: () => void;
  onMarkLost: () => void;
  onReassign: () => void;
}

function TableRow({ lead, locale, tdStyle, tActions, canReassign, onCallback, onConvert, onMarkLost, onReassign }: RowProps) {
  const tSources = useTranslations("crm.leads.sources");

  return (
    <tr style={{ cursor: "default" }}>
      <td style={tdStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {lead.is_hot && (
            <span style={{ fontSize: 11, color: "#B98900", fontWeight: 600 }}>●</span>
          )}
          {lead.has_duplicate && (
            <span style={{ fontSize: 11, color: "#D72C0D", fontWeight: 600 }}>!</span>
          )}
          <Link
            href={`/${locale}/leads/${lead.id}`}
            style={{ color: "#1A1A1A", textDecoration: "none", fontWeight: 500 }}
          >
            {lead.customer_name}
          </Link>
        </div>
      </td>
      <td style={{ ...tdStyle, fontVariantNumeric: "tabular-nums" }}>
        <a href={`tel:${lead.customer_phone}`} style={{ color: "#2C6ECB", textDecoration: "none" }} aria-label={tActions("callNow")}>
          {tActions("callNow")}
        </a>
        {" "}
        <span style={{ color: "#6D7175" }}>{lead.customer_phone}</span>
      </td>
      <td style={{ ...tdStyle, color: "#6D7175" }}>{lead.customer_city ?? "—"}</td>
      <td style={tdStyle}>
        <LeadStatusBadge status={lead.status as LeadStatus} />
      </td>
      <td style={{ ...tdStyle, color: "#6D7175", fontSize: 13 }}>{tSources(lead.source as LeadSource)}</td>
      <td style={{ ...tdStyle, color: "#6D7175", fontSize: 13, fontVariantNumeric: "tabular-nums" }}>
        {new Date(lead.created_at).toLocaleDateString(locale === "ar" ? "ar-LY" : "fr-TN")}
      </td>
      <td style={{ ...tdStyle, whiteSpace: "nowrap" }}>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          <button type="button" onClick={onCallback} style={rowBtnStyle} aria-label={tActions("scheduleCallback")}>
            {tActions("scheduleCallback")}
          </button>
          {lead.status === "qualified" && (
            <button type="button" onClick={onConvert} style={rowBtnStyle} aria-label={tActions("convertToOrder")}>
              {tActions("convertToOrder")}
            </button>
          )}
          <button type="button" onClick={onMarkLost} style={{ ...rowBtnStyle, color: "#D72C0D" }} aria-label={tActions("markLostAction")}>
            {tActions("markLostAction")}
          </button>
          {canReassign && (
            <button type="button" onClick={onReassign} style={rowBtnStyle} aria-label={tActions("reassignLead")}>
              {tActions("reassignLead")}
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

const rowBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 500,
  color: "#1A1A1A",
  padding: "2px 6px",
  borderRadius: 4,
};
