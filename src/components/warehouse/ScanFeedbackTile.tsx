"use client";

import { CheckCircle2, XCircle, Clock } from "lucide-react";

export type FeedbackState =
  | { kind: "idle" }
  | { kind: "success"; title: string; subtitle?: string; meta?: string }
  | { kind: "error"; title: string; subtitle?: string };

interface ColorOverride {
  bg: string;
  border: string;
  accent: string;
}

interface Props {
  state: FeedbackState;
  idleLabel: string;
  successColors?: ColorOverride;
  errorColors?: ColorOverride;
  idleStyle?: React.CSSProperties;
}

export function ScanFeedbackTile({
  state,
  idleLabel,
  successColors,
  errorColors,
  idleStyle,
}: Props) {
  if (state.kind === "idle") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "32px 24px",
          borderRadius: 8,
          border: "2px dashed var(--border)",
          backgroundColor: "var(--bg-card)",
          color: "var(--text-secondary)",
          fontSize: 16,
          minHeight: 120,
          ...idleStyle,
        }}
        aria-live="polite"
      >
        <Clock size={24} strokeWidth={1.5} aria-hidden="true" />
        <span>{idleLabel}</span>
      </div>
    );
  }

  const isSuccess = state.kind === "success";
  const colors = isSuccess
    ? (successColors ?? { bg: "#ECFDF5", border: "#A7F3D0", accent: "#059669" })
    : (errorColors ?? { bg: "#FEF2F2", border: "#FECACA", accent: "#DC2626" });

  const Icon = isSuccess ? CheckCircle2 : XCircle;

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "20px 24px",
        borderRadius: 8,
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        minHeight: 120,
      }}
    >
      <Icon size={40} strokeWidth={1.75} color={colors.accent} aria-hidden="true" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 22,
            fontWeight: 700,
            color: colors.accent,
            lineHeight: 1.2,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {state.title}
        </div>
        {state.subtitle && (
          <div
            style={{
              marginTop: 4,
              fontSize: 14,
              color: "var(--text-primary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {state.subtitle}
          </div>
        )}
      </div>
      {isSuccess && state.meta && (
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: colors.accent,
            backgroundColor: "rgba(255,255,255,0.15)",
            padding: "6px 10px",
            borderRadius: 999,
            flexShrink: 0,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {state.meta}
        </div>
      )}
    </div>
  );
}

export function playBeep(kind: "success" | "error"): void {
  if (typeof window === "undefined") return;
  try {
    const W = window as Window & {
      AudioContext?: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
    };
    const Ctx = W.AudioContext ?? W.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = kind === "success" ? 880 : 220;
    gain.gain.value = 0.1;
    osc.start();
    osc.stop(ctx.currentTime + (kind === "success" ? 0.08 : 0.18));
    osc.onended = () => ctx.close();
  } catch {
    // audio unavailable — silent failure
  }
  if (typeof navigator !== "undefined" && "vibrate" in navigator) {
    navigator.vibrate?.(kind === "success" ? 40 : [60, 40, 60]);
  }
}
