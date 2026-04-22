"use client";

import { useTranslations } from "next-intl";
import {
  getPresence,
  getOfflineDuration,
  PRESENCE_COLOR,
  type OfflineDuration,
} from "@/lib/presence";

interface PresenceDotProps {
  lastSeenAt: string | null;
  showLabel?: boolean;
  labelStyle?: React.CSSProperties;
}

export function PresenceDot({
  lastSeenAt,
  showLabel = true,
  labelStyle,
}: PresenceDotProps) {
  const t = useTranslations("presence");
  const state = getPresence(lastSeenAt);
  const duration = getOfflineDuration(lastSeenAt);

  const presenceLabel = t(stateLabelKey(state));
  const tooltip = buildTooltip(t, state, duration, presenceLabel);
  const inlineLabel =
    !showLabel || state === "online" || !duration
      ? null
      : buildInlineLabel(t, duration);

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span
        title={tooltip}
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          backgroundColor: PRESENCE_COLOR[state],
          flexShrink: 0,
        }}
      />
      {inlineLabel && (
        <span
          style={{
            fontSize: 12,
            color: "#6B6B6B",
            fontVariantNumeric: "tabular-nums",
            ...labelStyle,
          }}
        >
          {inlineLabel}
        </span>
      )}
    </span>
  );
}

function stateLabelKey(state: "online" | "idle" | "offline") {
  return state === "online"
    ? "labelOnline"
    : state === "idle"
      ? "labelIdle"
      : "labelOffline";
}

function buildInlineLabel(
  t: ReturnType<typeof useTranslations>,
  duration: OfflineDuration,
): string {
  if (duration.kind === "never") return t("neverSeen");
  if (duration.kind === "minutes") return t("offlineMinutes", { value: duration.value });
  if (duration.kind === "hours") return t("offlineHours", { value: duration.value });
  return t("offlineDays", { value: duration.value });
}

function buildTooltip(
  t: ReturnType<typeof useTranslations>,
  state: "online" | "idle" | "offline",
  duration: OfflineDuration | null,
  presenceLabel: string,
): string {
  if (state === "online") return presenceLabel;
  if (!duration) return presenceLabel;
  if (duration.kind === "never") return `${presenceLabel} — ${t("neverSeen")}`;
  const tooltipKey =
    duration.kind === "minutes"
      ? "tooltipMinutes"
      : duration.kind === "hours"
        ? "tooltipHours"
        : "tooltipDays";
  return `${presenceLabel} — ${t(tooltipKey, { value: duration.value })}`;
}
