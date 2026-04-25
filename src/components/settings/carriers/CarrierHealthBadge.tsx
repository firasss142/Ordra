"use client";

export type CarrierHealthState =
  | "connected"
  | "failing"
  | "idle"
  | "inactive"
  | "unknown";

export interface CarrierHealthInput {
  is_active: boolean;
  reachable: boolean | null;
  delivery_rate_30d: number | null;
  sample_size: number;
  minSample?: number;
  minDeliveryRate?: number;
}

export function computeCarrierHealth(params: CarrierHealthInput): CarrierHealthState {
  const {
    is_active,
    reachable,
    delivery_rate_30d,
    sample_size,
    minSample = 10,
    minDeliveryRate = 0.6,
  } = params;

  if (!is_active) return "inactive";
  if (reachable === false) return "failing";
  if (
    delivery_rate_30d !== null &&
    sample_size >= minSample &&
    delivery_rate_30d < minDeliveryRate
  ) {
    return "failing";
  }
  if (reachable === null && sample_size === 0) return "unknown";
  if (sample_size === 0) return "idle";
  return "connected";
}

const STATE_STYLE: Record<
  CarrierHealthState,
  { color: string; bg: string; label: string }
> = {
  connected: { color: "#008060", bg: "#E3F2E8", label: "Connecté" },
  failing: { color: "#D72C0D", bg: "#FDEDEA", label: "En échec" },
  idle: { color: "#8A6116", bg: "#FFF3CD", label: "Inactif" },
  inactive: { color: "#6D7175", bg: "#F6F6F7", label: "Désactivé" },
  unknown: { color: "#6D7175", bg: "#F6F6F7", label: "Non testé" },
};

export function CarrierHealthBadge({ state }: { state: CarrierHealthState }) {
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

export function AdapterBadge({
  code,
  known,
}: {
  code: string;
  known: boolean;
}) {
  const label = known
    ? code.charAt(0).toUpperCase() + code.slice(1)
    : "Personnalisé";
  const color = known ? "#1A1A1A" : "#6D7175";
  const bg = known ? "#F6F6F7" : "#F6F6F7";
  const border = known ? "1px solid #E1E3E5" : "1px dashed #C9CCCF";
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "2px 8px",
        borderRadius: 6,
        fontSize: 12,
        fontWeight: 500,
        color,
        backgroundColor: bg,
        border,
        fontFamily: "monospace",
        letterSpacing: "0.02em",
      }}
    >
      {label}
    </span>
  );
}

export function formatDeliveryRate(v: number | null): string {
  if (v === null) return "—";
  return `${Math.round(v * 100)}%`;
}

export function formatHours(v: number | null): string {
  if (v === null) return "—";
  if (v < 1) return "< 1 h";
  if (v < 48) return `${Math.round(v)} h`;
  return `${Math.round(v / 24)} j`;
}
