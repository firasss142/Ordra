"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useLeadDetail } from "@/hooks/useLeadDetail";
import { LeadStatusBadge } from "./LeadStatusBadge";
import { ConvertLeadModal } from "./ConvertLeadModal";
import { MarkLostModal } from "./MarkLostModal";
import { ScheduleCallbackModal } from "./ScheduleCallbackModal";
import type { LeadStatus } from "@/types/lead";
import { isTerminalLeadStatus } from "@/types/lead";
import { formatDateTime } from "@/lib/format";
import type { Role } from "@/types";

interface Props {
  leadId: string;
  role: Role;
  locale: string;
  actorId: string;
}

const sectionLabel: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "#6B7280",
  textTransform: "uppercase",
  letterSpacing: "0.05em",
  marginTop: 20,
  marginBottom: 8,
};

const actionBtn: React.CSSProperties = {
  height: 36,
  padding: "0 14px",
  fontSize: 13,
  fontWeight: 500,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  background: "white",
  color: "#1A1A1A",
  cursor: "pointer",
};

const primaryBtn: React.CSSProperties = {
  ...actionBtn,
  border: "1px solid #1A1A1A",
  background: "#1A1A1A",
  color: "white",
};

const dangerBtn: React.CSSProperties = {
  ...actionBtn,
  border: "1px solid #DC2626",
  color: "#DC2626",
};

export function LeadDetailCard({ leadId, role, locale, actorId }: Props) {
  const t = useTranslations("crm.leads");
  const tDetail = useTranslations("crm.leads.detail");
  const tSources = useTranslations("crm.leads.sources");
  const router = useRouter();

  const { lead, isLoading, error, mutate } = useLeadDetail(leadId);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const [convertOpen, setConvertOpen] = useState(false);
  const [lostOpen, setLostOpen] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);

  if (isLoading) {
    return <div style={{ color: "#6B7280", padding: 24 }}>…</div>;
  }
  if (error || !lead) {
    return (
      <div style={{ color: "#DC2626", padding: 24 }}>
        {tDetail("close")} — {String(error?.message ?? "not found")}
      </div>
    );
  }

  const terminal = isTerminalLeadStatus(lead.status as LeadStatus);
  const isAgent = role === "agent";
  const canConvert = lead.status === "qualified" && !terminal;
  const canAgentAct = !isAgent || lead.assigned_to === actorId;
  const canArchive = !isAgent && !terminal;

  async function post(path: string, body?: unknown) {
    setActionErr(null);
    setBusy(true);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const json = await res.json();
      if (!res.ok) {
        setActionErr(json.error || "Error");
        return null;
      }
      await mutate();
      return json;
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Error");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function handleLogAttempt() {
    await post(`/api/leads/${leadId}/attempt`);
  }

  async function handleMarkQualified() {
    await post(`/api/leads/${leadId}/transition`, {
      new_status: "qualified",
      note: "Qualifié par l'agent",
    });
  }

  async function handleArchive() {
    setActionErr(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${leadId}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) {
        setActionErr(json.error || "Error");
      } else {
        router.push(`/${locale}/leads`);
      }
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E1E3E5",
        borderRadius: 12,
        padding: 24,
        maxWidth: 720,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          paddingBottom: 16,
          borderBottom: "1px solid #E1E3E5",
        }}
      >
        <div>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#1A1A1A" }}>
            {lead.customer_name}
          </div>
          <div style={{ fontSize: 13, color: "#6B7280" }}>
            {tSources(lead.source)} · {formatDateTime(lead.created_at, locale)}
          </div>
        </div>
        <LeadStatusBadge status={lead.status as LeadStatus} />
      </div>

      {/* Client */}
      <div style={sectionLabel}>{tDetail("client")}</div>
      <div style={{ fontSize: 14, color: "#1A1A1A" }}>
        <div>
          <a
            href={`tel:${lead.customer_phone}`}
            style={{ color: "#1A1A1A", textDecoration: "none" }}
          >
            {lead.customer_phone}
          </a>
        </div>
        {lead.customer_city && <div>{lead.customer_city}</div>}
        {lead.customer_address && (
          <div style={{ color: "#6B7280" }}>{lead.customer_address}</div>
        )}
      </div>

      {/* Inquiry */}
      <div style={sectionLabel}>{tDetail("inquiry")}</div>
      <div style={{ fontSize: 14, color: "#1A1A1A" }}>
        {lead.product_interest_note || (
          <span style={{ color: "#6B7280" }}>—</span>
        )}
      </div>

      {lead.callback_scheduled_at && (
        <>
          <div style={sectionLabel}>{tDetail("callbackScheduledAt")}</div>
          <div style={{ fontSize: 14, color: "#1A1A1A" }}>
            {formatDateTime(lead.callback_scheduled_at, locale)}
          </div>
        </>
      )}

      {lead.converted_order_id && (
        <>
          <div style={sectionLabel}>{tDetail("convertedToOrder")}</div>
          <div style={{ fontSize: 14 }}>
            <Link
              href={`/${locale}/orders?highlight=${lead.converted_order_id}`}
              style={{ color: "#1A1A1A" }}
            >
              {lead.converted_order_id}
            </Link>
          </div>
        </>
      )}

      {lead.notes && (
        <>
          <div style={sectionLabel}>{tDetail("notes")}</div>
          <div style={{ fontSize: 14, color: "#1A1A1A", whiteSpace: "pre-wrap" }}>
            {lead.notes}
          </div>
        </>
      )}

      {/* Actions */}
      {!terminal && canAgentAct && (
        <div
          style={{
            display: "flex",
            gap: 8,
            marginTop: 20,
            flexWrap: "wrap",
          }}
        >
          {(lead.status === "assigned" ||
            lead.status === "attempt_1" ||
            lead.status === "attempt_2" ||
            lead.status === "attempt_3" ||
            lead.status === "callback_scheduled") && (
            <>
              <button
                type="button"
                disabled={busy}
                onClick={handleLogAttempt}
                style={actionBtn}
              >
                {t("logAttempt")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setCallbackOpen(true)}
                style={actionBtn}
              >
                {t("scheduleCallback")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={handleMarkQualified}
                style={primaryBtn}
              >
                {t("markQualified")}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => setLostOpen(true)}
                style={dangerBtn}
              >
                {t("markLost")}
              </button>
            </>
          )}

          {canConvert && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setConvertOpen(true)}
              style={primaryBtn}
            >
              {t("convertToOrder")}
            </button>
          )}
          {canConvert && lead.status === "qualified" && (
            <button
              type="button"
              disabled={busy}
              onClick={() => setLostOpen(true)}
              style={dangerBtn}
            >
              {t("markLost")}
            </button>
          )}

          {canArchive && (
            <button
              type="button"
              disabled={busy}
              onClick={handleArchive}
              style={{ ...actionBtn, marginInlineStart: "auto" }}
            >
              {t("archive")}
            </button>
          )}
        </div>
      )}

      {actionErr && (
        <div style={{ color: "#DC2626", fontSize: 13, marginTop: 12 }}>
          {actionErr}
        </div>
      )}

      {/* History */}
      <div style={sectionLabel}>{tDetail("history")}</div>
      {lead.history.length === 0 ? (
        <div style={{ color: "#6B7280", fontSize: 13 }}>
          {tDetail("noHistory")}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {lead.history.map((h) => (
            <div
              key={h.id}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 10,
                fontSize: 13,
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: "50%",
                  background: "#9CA3AF",
                  marginTop: 6,
                  flexShrink: 0,
                }}
              />
              <div>
                <div style={{ color: "#1A1A1A" }}>
                  {h.status_from ?? "—"} → {h.status_to}
                </div>
                {h.note && (
                  <div style={{ color: "#6B7280", fontSize: 12 }}>{h.note}</div>
                )}
                <div style={{ color: "#9CA3AF", fontSize: 12 }}>
                  {formatDateTime(h.created_at, locale)}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Modals */}
      <ConvertLeadModal
        open={convertOpen}
        lead={lead}
        locale={locale}
        onClose={() => setConvertOpen(false)}
        onConverted={(orderId) => {
          setConvertOpen(false);
          router.push(`/${locale}/orders?highlight=${orderId}`);
        }}
      />
      <MarkLostModal
        open={lostOpen}
        leadId={leadId}
        locale={locale}
        onClose={() => setLostOpen(false)}
        onDone={() => {
          setLostOpen(false);
          mutate();
        }}
      />
      <ScheduleCallbackModal
        open={callbackOpen}
        leadId={leadId}
        locale={locale}
        onClose={() => setCallbackOpen(false)}
        onDone={() => {
          setCallbackOpen(false);
          mutate();
        }}
      />
    </div>
  );
}
