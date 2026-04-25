"use client";

export type HealthState = "ok" | "stale" | "failing" | "never" | "inactive";

export function computeHealthState(params: {
  is_active: boolean;
  last_webhook_received_at: string | null;
  last_webhook_status: "processed" | "ignored" | "error" | null;
  webhook_failure_count: number;
  staleThresholdMs?: number;
}): HealthState {
  const {
    is_active,
    last_webhook_received_at,
    last_webhook_status,
    webhook_failure_count,
    staleThresholdMs = 1000 * 60 * 60 * 24, // 24h
  } = params;

  if (!is_active) return "inactive";
  if (!last_webhook_received_at) return "never";
  if (webhook_failure_count >= 3 || last_webhook_status === "error") return "failing";

  const ageMs = Date.now() - new Date(last_webhook_received_at).getTime();
  if (ageMs > staleThresholdMs) return "stale";
  return "ok";
}

const STATE_STYLE: Record<
  HealthState,
  { color: string; bg: string; label: string }
> = {
  ok: { color: "#008060", bg: "#E3F2E8", label: "Connecté" },
  stale: { color: "#8A6116", bg: "#FFF3CD", label: "Inactif" },
  failing: { color: "#D72C0D", bg: "#FDEDEA", label: "Échec" },
  never: { color: "#6D7175", bg: "#F6F6F7", label: "Jamais reçu" },
  inactive: { color: "#6D7175", bg: "#F6F6F7", label: "Désactivé" },
};

interface HealthBadgeProps {
  state: HealthState;
}

export function HealthBadge({ state }: HealthBadgeProps) {
  const s = STATE_STYLE[state];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        padding: "2px 10px",
        borderRadius: 9999,
        fontSize: 12,
        fontWeight: 500,
        color: s.color,
        backgroundColor: s.bg,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          backgroundColor: s.color,
        }}
      />
      {s.label}
    </span>
  );
}

export function formatRelative(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "à l'instant";
  const min = Math.floor(sec / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `il y a ${d} j`;
  return new Date(iso).toLocaleDateString("fr-FR");
}
