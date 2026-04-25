"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import type { Role } from "@/types";

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

interface ManagerNotesEditorProps {
  agentId: string;
  marketId: string;
  role: Role;
}

type SettingsRow = { key: string; value: unknown };

export function ManagerNotesEditor({ agentId, marketId, role }: ManagerNotesEditorProps) {
  const t = useTranslations("teamPerf");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const canEdit = role === "market_manager" || role === "super_admin";
  const noteKey = `agent_note_${agentId}`;

  const { data } = useSWR<{ data: SettingsRow[] }>(
    `/api/settings/${marketId}`,
    fetcher,
    { revalidateOnFocus: false }
  );

  useEffect(() => {
    if (!data?.data) return;
    const row = data.data.find((r) => r.key === noteKey);
    if (row && typeof row.value === "string") setText(row.value);
    else if (row && typeof row.value === "object" && row.value !== null) {
      const v = (row.value as { text?: string }).text;
      if (typeof v === "string") setText(v);
    }
  }, [data, noteKey]);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch(`/api/settings/${marketId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [noteKey]: text }),
        credentials: "same-origin",
      });
      if (res.ok) setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ padding: "16px 24px" }}>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setSaved(false); }}
        disabled={!canEdit}
        placeholder={t("drilldown.notesPlaceholder")}
        rows={6}
        style={{
          width: "100%",
          fontSize: 14,
          color: "#1A1A1A",
          border: "1px solid #C9CCCF",
          borderRadius: 6,
          padding: "10px 12px",
          resize: "vertical",
          backgroundColor: canEdit ? "#FFFFFF" : "#F6F6F7",
          fontFamily: "inherit",
          boxSizing: "border-box",
        }}
      />
      {canEdit && (
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 10 }}>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            style={{
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              color: "#FFFFFF",
              backgroundColor: saving ? "#6D7175" : "#1A1A1A",
              border: "none",
              borderRadius: 6,
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            {t("targets.save")}
          </button>
          {saved && (
            <span style={{ fontSize: 13, color: "#008060" }}>{t("targets.saved")}</span>
          )}
        </div>
      )}
    </div>
  );
}
