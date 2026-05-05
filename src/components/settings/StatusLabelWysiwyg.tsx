"use client";

import { useLocale } from "next-intl";
import useSWR from "swr";
import { useState } from "react";
import type { StatusScope, StatusConfig } from "@/types/status-config";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface Props {
  marketId: string;
  scope: StatusScope;
}

function LiveBadge({ label, color }: { label: string; color: string }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "3px 10px",
        borderRadius: 999,
        backgroundColor: `${color}18`,
        color,
        border: `1px solid ${color}40`,
        fontSize: 12,
        fontWeight: 500,
        lineHeight: 1.4,
        whiteSpace: "nowrap",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: color,
        }}
      />
      {label || "—"}
    </span>
  );
}

export function StatusLabelWysiwyg({ marketId, scope }: Props) {
  const locale = useLocale();
  const { data, mutate } = useSWR<{ data: StatusConfig[] }>(
    marketId ? `/api/settings/statuses?market_id=${marketId}&scope=${scope}` : null,
    fetcher,
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { label_fr: string; label_ar: string; color: string }>>({});

  const configs = (data?.data ?? []).slice().sort((a, b) => a.sort_order - b.sort_order);

  const getDraft = (c: StatusConfig) =>
    drafts[c.id] ?? { label_fr: c.label_fr, label_ar: c.label_ar, color: c.color };

  const setDraftField = (id: string, patch: Partial<{ label_fr: string; label_ar: string; color: string }>) => {
    setDrafts((prev) => {
      const current = prev[id] ?? { label_fr: "", label_ar: "", color: "#64748B" };
      return { ...prev, [id]: { ...current, ...patch } };
    });
  };

  const isDirty = (c: StatusConfig) => {
    const d = drafts[c.id];
    if (!d) return false;
    return d.label_fr !== c.label_fr || d.label_ar !== c.label_ar || d.color !== c.color;
  };

  const save = async (c: StatusConfig) => {
    const d = drafts[c.id];
    if (!d) return;
    setSaving(c.id);
    try {
      const res = await fetch(`/api/settings/statuses/${c.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(d),
      });
      if (res.ok) {
        setDrafts((prev) => {
          const next = { ...prev };
          delete next[c.id];
          return next;
        });
        await mutate();
      }
    } finally {
      setSaving(null);
    }
  };

  if (!marketId) {
    return <div style={{ fontSize: 13, color: "#6D7175" }}>Sélectionnez un marché.</div>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <p style={{ fontSize: 13, color: "#6D7175", margin: 0 }}>
        Ce que vous tapez est ce que les agents verront. L&apos;aperçu se met à jour en temps réel.
      </p>

      <div
        style={{
          backgroundColor: "#FFFFFF",
          border: "1px solid #E1E3E5",
          borderRadius: 8,
          overflow: "hidden",
        }}
      >
        {configs.length === 0 && (
          <div style={{ padding: 24, fontSize: 13, color: "#6D7175", textAlign: "center" }}>
            Aucun statut configuré pour ce scope.
          </div>
        )}
        {configs.map((c) => {
          const draft = getDraft(c);
          const dirty = isDirty(c);
          const previewLabel = locale === "ar" ? draft.label_ar : draft.label_fr;
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                flexWrap: "wrap",
                gap: 12,
                alignItems: "flex-end",
                padding: "12px 16px",
                borderBottom: "1px solid #F4F5F6",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flex: "0 0 auto",
                  minWidth: 140,
                  paddingBottom: 6,
                }}
              >
                <LiveBadge label={previewLabel} color={draft.color} />
              </div>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px", minWidth: 160 }}>
                <span style={{ fontSize: 11, color: "#6D7175" }}>Étiquette (FR)</span>
                <input
                  type="text"
                  value={draft.label_fr}
                  onChange={(e) => setDraftField(c.id, { label_fr: e.target.value })}
                  style={inlineInput}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "1 1 180px", minWidth: 160 }}>
                <span style={{ fontSize: 11, color: "#6D7175" }}>Étiquette (AR)</span>
                <input
                  type="text"
                  value={draft.label_ar}
                  onChange={(e) => setDraftField(c.id, { label_ar: e.target.value })}
                  dir="rtl"
                  style={inlineInput}
                />
              </label>
              <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: "0 0 auto" }}>
                <span style={{ fontSize: 11, color: "#6D7175" }}>Couleur</span>
                <input
                  type="color"
                  value={draft.color}
                  onChange={(e) => setDraftField(c.id, { color: e.target.value })}
                  style={{ width: 48, height: 32, padding: 0, border: "1px solid #E1E3E5", borderRadius: 4 }}
                />
              </label>
              <button
                type="button"
                onClick={() => save(c)}
                disabled={!dirty || saving === c.id}
                style={{
                  height: 32,
                  padding: "0 12px",
                  fontSize: 13,
                  fontWeight: 500,
                  border: "1px solid #1A1A1A",
                  borderRadius: 6,
                  backgroundColor: dirty ? "#1A1A1A" : "#FFFFFF",
                  color: dirty ? "#FFFFFF" : "#9CA3AF",
                  cursor: dirty ? "pointer" : "not-allowed",
                  flex: "0 0 auto",
                  alignSelf: "flex-end",
                }}
              >
                {saving === c.id ? "…" : "Enregistrer"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const inlineInput: React.CSSProperties = {
  height: 32,
  padding: "0 10px",
  fontSize: 13,
  border: "1px solid #E1E3E5",
  borderRadius: 6,
  backgroundColor: "#FFFFFF",
  color: "#1A1A1A",
  outline: "none",
  boxSizing: "border-box",
};
