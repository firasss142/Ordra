import { TONE_COLOR, type Tone } from "@/components/dashboard/kpiDelta";

export type HeroTone = "positive" | "negative" | "neutral";

const SURFACE: Record<HeroTone, string> = {
  positive: "#F1F8F5",
  negative: "#FFF4F4",
  neutral: "#FFFFFF",
};

const VALUE_COLOR: Record<HeroTone, string> = {
  positive: "#1A1A1A",
  negative: "#D72C0D",
  neutral: "#1A1A1A",
};

export function FinanceHeroCard({
  label,
  value,
  subtitle,
  tone,
  deltaText,
  deltaTone = "neutral",
}: {
  label: string;
  value: string;
  subtitle?: string | null;
  tone: HeroTone;
  deltaText?: string | null;
  deltaTone?: Tone;
}) {
  return (
    <div
      data-testid="hero-card"
      style={{
        background: SURFACE[tone],
        border: "1px solid #E1E3E5",
        borderRadius: 10,
        padding: "16px 20px",
        minHeight: 132,
        display: "flex",
        flexDirection: "column",
        gap: 6,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: "#6D7175",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          {label}
        </span>
        {deltaText ? (
          <span
            style={{
              fontSize: 12,
              fontWeight: 600,
              color: TONE_COLOR[deltaTone],
              fontVariantNumeric: "tabular-nums",
              padding: "2px 8px",
              borderRadius: 999,
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
            }}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
      <div
        style={{
          fontSize: 32,
          fontWeight: 700,
          color: VALUE_COLOR[tone],
          fontVariantNumeric: "tabular-nums",
          lineHeight: 1.1,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          marginTop: 4,
        }}
      >
        {value}
      </div>
      {subtitle ? (
        <div
          style={{
            fontSize: 13,
            color: "#6D7175",
            fontVariantNumeric: "tabular-nums",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
