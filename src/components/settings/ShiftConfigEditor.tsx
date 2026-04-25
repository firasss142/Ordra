"use client";

import type { ShiftConfig } from "@/types/settings";

const DAY_LABELS = ["Dim", "Lun", "Mar", "Mer", "Jeu", "Ven", "Sam"];

interface Props {
  value: ShiftConfig;
  onChange: (next: ShiftConfig) => void;
  error?: string;
}

export function ShiftConfigEditor({ value, onChange, error }: Props) {
  const toggleDay = (d: number) => {
    const next = value.days.includes(d)
      ? value.days.filter((x) => x !== d)
      : [...value.days, d].sort((a, b) => a - b);
    onChange({ ...value, days: next });
  };

  const [sh, sm] = value.start.split(":").map(Number);
  const [eh, em] = value.end.split(":").map(Number);
  const endsBeforeStart = sh * 60 + sm >= eh * 60 + em;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#374151" }}>
          Début
          <input
            type="time"
            value={value.start}
            onChange={(e) => onChange({ ...value, start: e.target.value })}
            style={timeInput}
          />
        </label>
        <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#374151" }}>
          Fin
          <input
            type="time"
            value={value.end}
            onChange={(e) => onChange({ ...value, end: e.target.value })}
            style={timeInput}
          />
        </label>
      </div>

      <div>
        <div style={{ fontSize: 13, color: "#374151", marginBottom: 6 }}>Jours ouvrés</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {DAY_LABELS.map((label, idx) => {
            const active = value.days.includes(idx);
            return (
              <button
                key={idx}
                type="button"
                onClick={() => toggleDay(idx)}
                aria-pressed={active}
                style={{
                  padding: "6px 12px",
                  border: `1px solid ${active ? "#1A1A1A" : "#E1E3E5"}`,
                  borderRadius: 6,
                  backgroundColor: active ? "#1A1A1A" : "#FFFFFF",
                  color: active ? "#FFFFFF" : "#1A1A1A",
                  fontSize: 13,
                  fontWeight: active ? 500 : 400,
                  cursor: "pointer",
                  minWidth: 48,
                }}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: "#374151" }}>
        Fuseau horaire
        <input
          type="text"
          value={value.timezone}
          onChange={(e) => onChange({ ...value, timezone: e.target.value })}
          placeholder="Africa/Tunis"
          style={{ ...timeInput, width: 200 }}
        />
      </label>

      {(endsBeforeStart || error) && (
        <p style={{ fontSize: 12, color: "#D72C0D", margin: 0 }}>
          {endsBeforeStart ? "L'heure de fin doit être après l'heure de début." : error}
        </p>
      )}
      <p style={{ fontSize: 12, color: "#6D7175", margin: 0 }}>
        Utilisé pour déterminer qui est &quot;en ligne&quot; pendant les heures ouvrées.
      </p>
    </div>
  );
}

const timeInput: React.CSSProperties = {
  height: 36,
  padding: "0 10px",
  fontSize: 14,
  border: "1px solid #D1D5DB",
  borderRadius: 6,
  backgroundColor: "#FFFFFF",
  outline: "none",
  boxSizing: "border-box",
};
