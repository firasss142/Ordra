"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

interface ShortcutsOverlayProps {
  open: boolean;
  onClose: () => void;
}

export function ShortcutsOverlay({ open, onClose }: ShortcutsOverlayProps) {
  const t = useTranslations("queue.shortcuts");

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const rows: { keys: string; label: string }[] = [
    { keys: "↑ / ↓", label: t("navigate") },
    { keys: "Enter", label: t("open") },
    { keys: "1", label: t("outcomeNoAnswer") },
    { keys: "2", label: t("outcomeConfirmed") },
    { keys: "3", label: t("outcomeRejected") },
    { keys: "4", label: t("outcomeCallback") },
    { keys: "p", label: t("productSheet") },
    { keys: "Esc", label: t("cancel") },
    { keys: "?", label: t("help") },
  ];

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(26,26,26,0.5)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 60,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "#FFFFFF",
          borderRadius: 8,
          padding: 24,
          width: 420,
          maxWidth: "90vw",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 600, color: "#1A1A1A", margin: 0 }}>{t("title")}</h2>
          <button
            onClick={onClose}
            style={{ background: "none", border: "none", fontSize: 14, color: "#6B7280", cursor: "pointer" }}
          >
            {t("close")}
          </button>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {rows.map((r) => (
            <div key={r.keys} style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "#374151" }}>{r.label}</span>
              <kbd
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  fontSize: 12,
                  backgroundColor: "#F3F4F6",
                  border: "1px solid #E1E3E5",
                  borderRadius: 4,
                  padding: "2px 8px",
                  color: "#1A1A1A",
                }}
              >
                {r.keys}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
