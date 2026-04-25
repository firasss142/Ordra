"use client";

import { useState } from "react";
import useSWR from "swr";

interface HistoryEntry {
  id: string;
  key: string;
  old_value: unknown;
  new_value: unknown;
  changed_at: string;
  users: { full_name: string } | null;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

function formatValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "—";
  if (typeof raw === "object" && raw !== null && "value" in raw) {
    return formatValue((raw as { value: unknown }).value);
  }
  if (Array.isArray(raw)) return raw.length === 0 ? "∅" : raw.join(", ");
  if (typeof raw === "object") return JSON.stringify(raw);
  return String(raw);
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "à l'instant";
  if (mins < 60) return `il y a ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `il y a ${hrs} h`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `il y a ${days} j`;
  return d.toLocaleDateString("fr-FR");
}

export function ChangeHistoryPopover({
  marketId,
  settingKey,
}: {
  marketId: string;
  settingKey: string;
}) {
  const [open, setOpen] = useState(false);
  const { data } = useSWR<{ data: HistoryEntry[] }>(
    open && marketId
      ? `/api/settings/${marketId}/history?key=${encodeURIComponent(settingKey)}`
      : null,
    fetcher,
  );

  const entries = data?.data ?? [];
  const latest = entries[0];

  return (
    <div style={{ position: "relative", display: "inline-block" }}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Historique des modifications"
        aria-expanded={open}
        style={{
          background: "none",
          border: "none",
          color: "#6D7175",
          fontSize: 12,
          cursor: "pointer",
          padding: 0,
          textDecoration: "underline",
        }}
      >
        {latest
          ? `Modifié ${formatWhen(latest.changed_at)}${
              latest.users?.full_name ? ` par ${latest.users.full_name}` : ""
            }`
          : "Historique"}
      </button>

      {open && (
        <div
          role="dialog"
          style={{
            position: "absolute",
            top: 24,
            insetInlineStart: 0,
            width: 320,
            backgroundColor: "#FFFFFF",
            border: "1px solid #E1E3E5",
            borderRadius: 6,
            padding: 12,
            zIndex: 20,
            boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
          }}
        >
          <div style={{ fontSize: 12, fontWeight: 600, color: "#1A1A1A", marginBottom: 8 }}>
            Historique
          </div>
          {entries.length === 0 && (
            <div style={{ fontSize: 12, color: "#6D7175" }}>
              Aucune modification enregistrée.
            </div>
          )}
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 8 }}>
            {entries.map((e) => (
              <li
                key={e.id}
                style={{
                  fontSize: 12,
                  color: "#1A1A1A",
                  borderBottom: "1px solid #F4F5F6",
                  paddingBottom: 8,
                }}
              >
                <div style={{ color: "#6D7175" }}>
                  {formatWhen(e.changed_at)}
                  {e.users?.full_name ? ` — ${e.users.full_name}` : ""}
                </div>
                <div>
                  <span style={{ color: "#6D7175" }}>{formatValue(e.old_value)}</span>
                  <span style={{ margin: "0 6px" }}>→</span>
                  <span style={{ fontWeight: 500 }}>{formatValue(e.new_value)}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
