"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFollowUpDetail } from "@/hooks/useFollowUpDetail";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { FollowUpStatusBadge } from "./FollowUpStatusBadge";
import {
  FOLLOW_UP_STATUSES,
  isValidFollowUpTransition,
  type FollowUpStatus,
} from "@/types/follow-up";

interface Props {
  id: string;
  marketCode: "TN" | "LY";
  locale: string;
}

const labelStyle: React.CSSProperties = {
  fontSize: 12,
  color: "#6D7175",
  marginBottom: 2,
};

const cardStyle: React.CSSProperties = {
  background: "white",
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  padding: 16,
  marginBottom: 16,
};

export function FollowUpDetail({ id, marketCode, locale }: Props) {
  const t = useTranslations("crm.followUps");
  const { followUp, isLoading, mutate } = useFollowUpDetail(id);
  const [newNote, setNewNote] = useState("");
  const [submittingNote, setSubmittingNote] = useState(false);
  const [deliveryManPhone, setDeliveryManPhone] = useState("");
  const [description, setDescription] = useState("");
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  React.useEffect(() => {
    if (followUp) {
      setDeliveryManPhone(followUp.delivery_man_phone ?? "");
      setDescription(followUp.description ?? "");
    }
  }, [followUp]);

  if (isLoading) {
    return (
      <div style={{ padding: 24, fontSize: 13, color: "#6B7280" }}>
        {t("loading")}
      </div>
    );
  }

  if (!followUp) {
    return (
      <div style={{ padding: 24 }}>
        <div style={{ fontSize: 14, color: "#1A1A1A" }}>{t("notFound")}</div>
        <Link
          href={`/${locale}/follow-ups`}
          style={{ fontSize: 13, color: "#3B82F6" }}
        >
          ← {t("backToBoard")}
        </Link>
      </div>
    );
  }

  const appendNote = async () => {
    if (!newNote.trim()) return;
    setSubmittingNote(true);
    setErr(null);
    try {
      const res = await fetch(`/api/follow-ups/${followUp.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: newNote.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "error");
      }
      setNewNote("");
      await mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingNote(false);
    }
  };

  const saveEdit = async () => {
    setSavingEdit(true);
    setErr(null);
    try {
      const res = await fetch(`/api/follow-ups/${followUp.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          delivery_man_phone: deliveryManPhone,
          description,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "error");
      }
      setEditing(false);
      await mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingEdit(false);
    }
  };

  const transition = async (to: FollowUpStatus) => {
    setErr(null);
    try {
      const res = await fetch(`/api/follow-ups/${followUp.id}/transition`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_status: to }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j?.error ?? "error");
      }
      await mutate();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  const availableTransitions = FOLLOW_UP_STATUSES.filter((s) =>
    isValidFollowUpTransition(followUp.status, s)
  );

  return (
    <div
      style={{
        padding: "32px 32px 64px",
        background: "#F6F6F7",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
      <Link
        href={`/${locale}/follow-ups`}
        style={{ fontSize: 13, color: "#3B82F6", marginBottom: 16, display: "inline-block" }}
      >
        ← {t("backToBoard")}
      </Link>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 16,
        }}
      >
        <h1 style={{ fontSize: 22, fontWeight: 700, color: "#1A1A1A", margin: 0 }}>
          {followUp.order.customer_name}
        </h1>
        <FollowUpStatusBadge status={followUp.status} />
      </div>

      {err && (
        <div
          style={{
            background: "#FEF2F2",
            color: "#991B1B",
            fontSize: 13,
            padding: 10,
            borderRadius: 6,
            marginBottom: 12,
          }}
        >
          {err}
        </div>
      )}

      <div style={cardStyle}>
        <div style={labelStyle}>{t("order")}</div>
        <div style={{ fontSize: 14, color: "#1A1A1A" }}>
          {followUp.order.customer_phone}
          {followUp.order.customer_city ? ` · ${followUp.order.customer_city}` : ""}
        </div>
        <div style={{ fontSize: 14, color: "#1A1A1A", marginTop: 4 }}>
          {formatCurrency(followUp.order.total_price, marketCode)} ·{" "}
          <span style={{ color: "#6B7280" }}>{followUp.order.status}</span>
        </div>
      </div>

      <div style={cardStyle}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 8,
          }}
        >
          <strong style={{ fontSize: 14, color: "#1A1A1A" }}>{t("info")}</strong>
          {!editing && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              style={{
                fontSize: 13,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: "#3B82F6",
              }}
            >
              {t("edit")}
            </button>
          )}
        </div>
        {editing ? (
          <div>
            <label style={labelStyle}>{t("deliveryManPhone")}</label>
            <input
              type="tel"
              value={deliveryManPhone}
              onChange={(e) => setDeliveryManPhone(e.target.value)}
              style={{
                width: "100%",
                height: 36,
                padding: "0 10px",
                fontSize: 14,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                background: "white",
                color: "#1A1A1A",
                outline: "none",
                marginBottom: 12,
              }}
            />
            <label style={labelStyle}>{t("description")}</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              style={{
                width: "100%",
                height: 96,
                padding: "8px 10px",
                fontSize: 14,
                border: "1px solid #D1D5DB",
                borderRadius: 6,
                background: "white",
                color: "#1A1A1A",
                outline: "none",
                resize: "vertical",
                marginBottom: 12,
              }}
            />
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => setEditing(false)}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: "1px solid #D1D5DB",
                  background: "white",
                  color: "#1A1A1A",
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                disabled={savingEdit}
                onClick={saveEdit}
                style={{
                  height: 32,
                  padding: "0 12px",
                  borderRadius: 6,
                  border: "none",
                  background: "#1A1A1A",
                  color: "white",
                  fontSize: 13,
                  cursor: savingEdit ? "not-allowed" : "pointer",
                }}
              >
                {savingEdit ? t("saving") : t("save")}
              </button>
            </div>
          </div>
        ) : (
          <div>
            <div style={labelStyle}>{t("deliveryManPhone")}</div>
            <div style={{ fontSize: 14, color: "#1A1A1A", marginBottom: 8 }}>
              {followUp.delivery_man_phone || "—"}
            </div>
            <div style={labelStyle}>{t("description")}</div>
            <div style={{ fontSize: 14, color: "#1A1A1A", whiteSpace: "pre-wrap" }}>
              {followUp.description || "—"}
            </div>
          </div>
        )}
      </div>

      {availableTransitions.length > 0 && (
        <div style={cardStyle}>
          <strong style={{ fontSize: 14, color: "#1A1A1A", display: "block", marginBottom: 8 }}>
            {t("transitions")}
          </strong>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {availableTransitions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => transition(s)}
                style={{
                  height: 32,
                  padding: "0 10px",
                  borderRadius: 6,
                  border: "1px solid #D1D5DB",
                  background: "white",
                  color: "#1A1A1A",
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                → {t(`statuses.${s}`)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div style={cardStyle}>
        <strong style={{ fontSize: 14, color: "#1A1A1A", display: "block", marginBottom: 8 }}>
          {t("timeline")}
        </strong>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {followUp.entries.map((e) => (
            <div
              key={e.id}
              style={{
                borderLeft: "3px solid #E1E3E5",
                paddingLeft: 10,
              }}
            >
              <div style={{ fontSize: 12, color: "#6B7280" }}>
                {formatDateTime(e.created_at, locale)} · {e.actor_type}
                {e.status_from || e.status_to ? (
                  <>
                    {" · "}
                    {e.status_from ?? "∅"} → {e.status_to ?? "∅"}
                  </>
                ) : null}
              </div>
              {e.note && (
                <div style={{ fontSize: 14, color: "#1A1A1A", marginTop: 2 }}>
                  {e.note}
                </div>
              )}
            </div>
          ))}
          {followUp.entries.length === 0 && (
            <div style={{ fontSize: 13, color: "#6B7280" }}>{t("noEntries")}</div>
          )}
        </div>

        <div style={{ marginTop: 12 }}>
          <textarea
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
            placeholder={t("addNotePlaceholder")}
            style={{
              width: "100%",
              height: 72,
              padding: "8px 10px",
              fontSize: 14,
              border: "1px solid #D1D5DB",
              borderRadius: 6,
              background: "white",
              color: "#1A1A1A",
              outline: "none",
              resize: "vertical",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 8 }}>
            <button
              type="button"
              disabled={submittingNote || !newNote.trim()}
              onClick={appendNote}
              style={{
                height: 32,
                padding: "0 12px",
                borderRadius: 6,
                border: "none",
                background:
                  submittingNote || !newNote.trim() ? "#9CA3AF" : "#1A1A1A",
                color: "white",
                fontSize: 13,
                cursor:
                  submittingNote || !newNote.trim() ? "not-allowed" : "pointer",
              }}
            >
              {submittingNote ? t("adding") : t("addNote")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
