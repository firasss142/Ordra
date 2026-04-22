"use client";

import React, { useState } from "react";
import { useTranslations } from "next-intl";
import type { FollowUpCampaign } from "@/types/follow-up";

interface Props {
  open: boolean;
  onClose: () => void;
  campaigns: FollowUpCampaign[];
  activeCampaignId: string;
  onSelect: (id: string) => void;
  onNew?: () => void;
  onMutate?: () => void;
  readOnly?: boolean;
}

// ── SVG Icons ─────────────────────────────────────────────────────────────
function IconPencil() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61Z" fill="currentColor"/>
    </svg>
  );
}

function IconTrash() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6.5 1.75a.25.25 0 0 1 .25-.25h2.5a.25.25 0 0 1 .25.25V3h-3V1.75Zm4.5 0V3h2.25a.75.75 0 0 1 0 1.5H2.75a.75.75 0 0 1 0-1.5H5V1.75C5 .784 5.784 0 6.75 0h2.5C10.216 0 11 .784 11 1.75ZM4.496 6.675a.75.75 0 1 0-1.492.15l.66 6.6A1.75 1.75 0 0 0 5.405 15h5.19a1.75 1.75 0 0 0 1.741-1.574l.66-6.6a.75.75 0 1 0-1.492-.15l-.66 6.6a.25.25 0 0 1-.249.225H5.405a.25.25 0 0 1-.249-.225l-.66-6.6Z" fill="currentColor"/>
    </svg>
  );
}

function IconClose() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" fill="currentColor"/>
    </svg>
  );
}

function IconPlus() {
  return (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2Z" fill="currentColor"/>
    </svg>
  );
}

function IconCampaign() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 2.5a.5.5 0 0 0-.5-.5H2.5a.5.5 0 0 0-.5.5v10a.5.5 0 0 0 .5.5h4.25v-1.5H3.5v-8h9v3.5H14V2.5Z" fill="currentColor" opacity=".4"/>
      <path d="M9 9.25A2.75 2.75 0 1 0 9 14.75 2.75 2.75 0 0 0 9 9.25Zm-1.25 2.75a1.25 1.25 0 1 1 2.5 0 1.25 1.25 0 0 1-2.5 0Z" fill="currentColor"/>
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────────
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
}

// ── Ghost icon button (shared) ─────────────────────────────────────────────
function IconBtn({
  onClick,
  title,
  danger = false,
  children,
}: {
  onClick: () => void;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: 30, height: 30,
        display: "flex", alignItems: "center", justifyContent: "center",
        borderRadius: 6, border: "none", cursor: "pointer",
        background: hovered ? (danger ? "#FFF4F4" : "#F6F6F7") : "transparent",
        color: hovered ? (danger ? "#D72C0D" : "#1A1A1A") : "#6D7175",
        transition: "background-color 120ms ease, color 120ms ease",
        flexShrink: 0,
      }}
    >
      {children}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export function CampaignPanel({
  open,
  onClose,
  campaigns,
  activeCampaignId,
  onSelect,
  onNew,
  onMutate,
  readOnly = false,
}: Props) {
  const t = useTranslations("crm.followUps.campaigns");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [allRowHover, setAllRowHover] = useState(false);

  if (!open) return null;

  const startEdit = (c: FollowUpCampaign) => {
    setDeletingId(null);
    setEditingId(c.id);
    setEditName(c.name);
    setErr(null);
  };

  const cancelEdit = () => { setEditingId(null); setEditName(""); setErr(null); };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/follow-up-campaigns/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? "error");
      setEditingId(null);
      onMutate?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async (id: string) => {
    setSaving(true);
    setErr(null);
    try {
      const res = await fetch(`/api/follow-up-campaigns/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json?.error ?? "error");
      }
      setDeletingId(null);
      if (activeCampaignId === id) onSelect("");
      onMutate?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0,
          background: "rgba(26,26,26,0.45)",
          zIndex: 40,
          backdropFilter: "blur(1px)",
        }}
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          insetBlockStart: 0,
          insetInlineEnd: 0,
          width: 380,
          maxWidth: "92vw",
          height: "100vh",
          background: "white",
          zIndex: 41,
          display: "flex",
          flexDirection: "column",
          boxShadow: "-12px 0 40px rgba(0,0,0,0.12)",
        }}
      >
        {/* ── Header ── */}
        <div style={{
          padding: "20px 20px 16px",
          borderBottom: "1px solid #E1E3E5",
          flexShrink: 0,
        }}>
          <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                width: 36, height: 36,
                background: "#F6F6F7",
                border: "1px solid #E1E3E5",
                borderRadius: 8,
                display: "flex", alignItems: "center", justifyContent: "center",
                color: "#1A1A1A",
                flexShrink: 0,
              }}>
                <IconCampaign />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: "#1A1A1A", lineHeight: 1.3 }}>
                  {t("panelTitle")}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175", marginTop: 1 }}>
                  {campaigns.length} {t("panelCount")}
                </div>
              </div>
            </div>
            <IconBtn onClick={onClose} title={t("close")}>
              <IconClose />
            </IconBtn>
          </div>

          {/* New campaign CTA */}
          {!readOnly && onNew && (
            <NewCampaignButton onClick={onNew} label={t("new")} />
          )}
        </div>

        {/* ── "All campaigns" row ── */}
        <button
          type="button"
          onClick={() => onSelect("")}
          onMouseEnter={() => setAllRowHover(true)}
          onMouseLeave={() => setAllRowHover(false)}
          style={{
            display: "flex", alignItems: "center", gap: 12,
            padding: "12px 20px",
            background: activeCampaignId === "" ? "#F6F6F7" : allRowHover ? "#FAFBFB" : "white",
            border: "none",
            borderBottom: "1px solid #E1E3E5",
            cursor: "pointer", textAlign: "left", width: "100%",
            transition: "background-color 120ms ease",
            flexShrink: 0,
          }}
        >
          <span style={{
            width: 8, height: 8, borderRadius: 9999, flexShrink: 0,
            background: activeCampaignId === "" ? "#1A1A1A" : "#C9CCCF",
            transition: "background-color 120ms ease",
          }} />
          <span style={{
            fontSize: 13,
            fontWeight: activeCampaignId === "" ? 600 : 400,
            color: "#1A1A1A",
          }}>
            {t("allCampaigns")}
          </span>
          {activeCampaignId === "" && (
            <span style={{
              marginInlineStart: "auto",
              fontSize: 11, fontWeight: 500,
              color: "#6D7175",
              background: "#F6F6F7",
              border: "1px solid #E1E3E5",
              borderRadius: 9999,
              padding: "1px 8px",
            }}>
              {t("active")}
            </span>
          )}
        </button>

        {/* ── Campaign list ── */}
        <div style={{ flex: 1, overflowY: "auto", padding: "8px 0" }}>
          {campaigns.length === 0 ? (
            <EmptyState label={t("panelEmpty")} />
          ) : (
            campaigns.map((c) => {
              const isActive = activeCampaignId === c.id;
              const isEditing = editingId === c.id;
              const isDeleting = deletingId === c.id;

              return (
                <CampaignCard
                  key={c.id}
                  campaign={c}
                  isActive={isActive}
                  isEditing={isEditing}
                  isDeleting={isDeleting}
                  editName={editName}
                  saving={saving}
                  err={isEditing || isDeleting ? err : null}
                  readOnly={readOnly}
                  onSelect={() => onSelect(isActive ? "" : c.id)}
                  onStartEdit={() => startEdit(c)}
                  onCancelEdit={cancelEdit}
                  onSaveEdit={saveEdit}
                  onEditNameChange={setEditName}
                  onStartDelete={() => { cancelEdit(); setDeletingId(c.id); setErr(null); }}
                  onCancelDelete={() => { setDeletingId(null); setErr(null); }}
                  onConfirmDelete={() => confirmDelete(c.id)}
                  tSave={t("save")}
                  tLoading={t("loading")}
                  tCancel={t("cancel")}
                  tEdit={t("editBtn")}
                  tDelete={t("deleteBtn")}
                  tDeleteConfirm={t("deleteConfirm", { name: c.name })}
                  tDeleteConfirmBtn={t("deleteConfirmBtn")}
                  tActive={t("active")}
                />
              );
            })
          )}
        </div>
      </div>
    </>
  );
}

// ── Sub-components ──────────────────────────────────────────────────────────

function NewCampaignButton({ onClick, label }: { onClick: () => void; label: string }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        width: "100%", height: 36,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
        fontSize: 13, fontWeight: 500,
        background: hovered ? "#2A2A2A" : "#1A1A1A",
        color: "white",
        border: "none", borderRadius: 6, cursor: "pointer",
        transition: "background-color 120ms ease",
      }}
    >
      <IconPlus />
      {label}
    </button>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      padding: "48px 24px", gap: 12,
    }}>
      <div style={{
        width: 48, height: 48,
        background: "#F6F6F7", border: "1px solid #E1E3E5",
        borderRadius: 12,
        display: "flex", alignItems: "center", justifyContent: "center",
        color: "#C9CCCF",
      }}>
        <IconCampaign />
      </div>
      <p style={{ fontSize: 13, color: "#6D7175", textAlign: "center", margin: 0, maxWidth: 240 }}>
        {label}
      </p>
    </div>
  );
}

interface CampaignCardProps {
  campaign: FollowUpCampaign;
  isActive: boolean;
  isEditing: boolean;
  isDeleting: boolean;
  editName: string;
  saving: boolean;
  err: string | null;
  readOnly: boolean;
  onSelect: () => void;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSaveEdit: () => void;
  onEditNameChange: (v: string) => void;
  onStartDelete: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  tSave: string;
  tLoading: string;
  tCancel: string;
  tEdit: string;
  tDelete: string;
  tDeleteConfirm: string;
  tDeleteConfirmBtn: string;
  tActive: string;
}

function CampaignCard({
  campaign: c,
  isActive, isEditing, isDeleting,
  editName, saving, err, readOnly,
  onSelect, onStartEdit, onCancelEdit, onSaveEdit, onEditNameChange,
  onStartDelete, onCancelDelete, onConfirmDelete,
  tSave, tLoading, tCancel, tEdit, tDelete, tDeleteConfirm, tDeleteConfirmBtn, tActive,
}: CampaignCardProps) {
  const [hovered, setHovered] = useState(false);
  const [saveBtnHover, setSaveBtnHover] = useState(false);
  const [cancelBtnHover, setCancelBtnHover] = useState(false);
  const [deleteBtnHover, setDeleteBtnHover] = useState(false);

  const showActions = hovered && !isEditing && !isDeleting;

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        margin: "0 8px 4px",
        borderRadius: 8,
        border: isActive ? "1.5px solid #1A1A1A" : "1px solid #E1E3E5",
        background: isActive ? "#FAFBFB" : hovered && !isEditing && !isDeleting ? "#FAFBFB" : "white",
        transition: "border-color 120ms ease, background-color 120ms ease",
        overflow: "hidden",
      }}
    >
      {/* ── Normal view ── */}
      {!isEditing && !isDeleting && (
        <div style={{ display: "flex", alignItems: "stretch" }}>
          {/* Active indicator strip */}
          <div style={{
            width: 3, flexShrink: 0,
            background: isActive ? "#1A1A1A" : "transparent",
            transition: "background-color 120ms ease",
          }} />

          <button
            type="button"
            onClick={onSelect}
            style={{
              flex: 1, background: "none", border: "none",
              textAlign: "left", cursor: "pointer",
              padding: "11px 10px 11px 12px",
              minWidth: 0,
            }}
          >
            <div style={{
              fontSize: 13, fontWeight: isActive ? 600 : 400,
              color: "#1A1A1A",
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
              marginBottom: 3,
            }}>
              {c.name}
            </div>
            <div style={{ fontSize: 11, color: "#6D7175" }}>
              {formatDate(c.created_at)}
            </div>
          </button>

          {/* Action buttons — visible on hover or when active */}
          <div style={{
            display: "flex", alignItems: "center", gap: 2,
            paddingInlineEnd: 8,
            opacity: showActions || isActive ? 1 : 0,
            transition: "opacity 120ms ease",
            pointerEvents: showActions || isActive ? "auto" : "none",
          }}>
            {isActive && (
              <span style={{
                fontSize: 10, fontWeight: 500, color: "#6D7175",
                background: "#F6F6F7", border: "1px solid #E1E3E5",
                borderRadius: 9999, padding: "1px 6px",
                marginInlineEnd: 4,
                whiteSpace: "nowrap",
              }}>
                {tActive}
              </span>
            )}
            {!readOnly && (
              <>
                <IconBtn onClick={onStartEdit} title={tEdit}>
                  <IconPencil />
                </IconBtn>
                <IconBtn onClick={onStartDelete} title={tDelete} danger>
                  <IconTrash />
                </IconBtn>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Edit mode ── */}
      {isEditing && (
        <div style={{ padding: "12px 14px" }}>
          <input
            type="text"
            value={editName}
            onChange={(e) => onEditNameChange(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") onSaveEdit(); if (e.key === "Escape") onCancelEdit(); }}
            autoFocus
            style={{
              width: "100%", height: 34, padding: "0 10px",
              fontSize: 13, fontWeight: 500,
              border: "1.5px solid #1A1A1A", borderRadius: 6,
              background: "white", color: "#1A1A1A", outline: "none",
              boxSizing: "border-box", marginBottom: err ? 6 : 10,
            }}
          />
          {err && (
            <div style={{
              fontSize: 12, color: "#D72C0D", marginBottom: 8,
              padding: "5px 8px", background: "#FFF4F4",
              border: "1px solid #FECACA", borderRadius: 4,
            }}>
              {err}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={saving || !editName.trim()}
              onClick={onSaveEdit}
              onMouseEnter={() => setSaveBtnHover(true)}
              onMouseLeave={() => setSaveBtnHover(false)}
              style={{
                height: 28, padding: "0 12px",
                fontSize: 12, fontWeight: 500,
                background: saving || !editName.trim() ? "#F3F4F6" : saveBtnHover ? "#2A2A2A" : "#1A1A1A",
                color: saving || !editName.trim() ? "#9CA3AF" : "white",
                border: "none", borderRadius: 4,
                cursor: saving || !editName.trim() ? "not-allowed" : "pointer",
                transition: "background-color 120ms ease",
              }}
            >
              {saving ? tLoading : tSave}
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              onMouseEnter={() => setCancelBtnHover(true)}
              onMouseLeave={() => setCancelBtnHover(false)}
              style={{
                height: 28, padding: "0 12px",
                fontSize: 12, fontWeight: 500,
                background: cancelBtnHover ? "#F6F6F7" : "white",
                color: "#1A1A1A",
                border: "1px solid #E1E3E5", borderRadius: 4, cursor: "pointer",
                transition: "background-color 120ms ease",
              }}
            >
              {tCancel}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirm ── */}
      {isDeleting && (
        <div style={{ padding: "12px 14px" }}>
          <div style={{
            fontSize: 12, color: "#D72C0D", marginBottom: 10,
            padding: "8px 10px",
            background: "#FFF4F4", border: "1px solid #FECACA", borderRadius: 6,
            lineHeight: 1.5,
          }}>
            {tDeleteConfirm}
          </div>
          {err && (
            <div style={{
              fontSize: 12, color: "#D72C0D", marginBottom: 8,
              padding: "5px 8px", background: "#FFF4F4",
              border: "1px solid #FECACA", borderRadius: 4,
            }}>
              {err}
            </div>
          )}
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              disabled={saving}
              onClick={onConfirmDelete}
              onMouseEnter={() => setDeleteBtnHover(true)}
              onMouseLeave={() => setDeleteBtnHover(false)}
              style={{
                height: 28, padding: "0 12px",
                fontSize: 12, fontWeight: 500,
                background: saving ? "#F3F4F6" : deleteBtnHover ? "#B82208" : "#D72C0D",
                color: saving ? "#9CA3AF" : "white",
                border: "none", borderRadius: 4,
                cursor: saving ? "not-allowed" : "pointer",
                transition: "background-color 120ms ease",
              }}
            >
              {saving ? tLoading : tDeleteConfirmBtn}
            </button>
            <button
              type="button"
              onClick={onCancelDelete}
              onMouseEnter={() => setCancelBtnHover(true)}
              onMouseLeave={() => setCancelBtnHover(false)}
              style={{
                height: 28, padding: "0 12px",
                fontSize: 12, fontWeight: 500,
                background: cancelBtnHover ? "#F6F6F7" : "white",
                color: "#1A1A1A",
                border: "1px solid #E1E3E5", borderRadius: 4, cursor: "pointer",
                transition: "background-color 120ms ease",
              }}
            >
              {tCancel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
