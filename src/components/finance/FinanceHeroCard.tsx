import { TONE_COLOR, type Tone } from "@/components/dashboard/kpiDelta";

/**
 * @deprecated Superseded by `FinanceKpiCard`, which is the P&L console's card.
 *
 * Still alive for `products/ProductRentabilityClient`, the one other consumer.
 * That page was not part of the P&L redesign and migrating only its three hero
 * cards would leave it visibly half-converted — new cards above old panels.
 * It goes when that page is migrated as a whole; do not add consumers.
 */

export type HeroTone = "positive" | "negative" | "neutral";

// Flat white cards per the design system — tone colors only the value text
// (functional color, never a decorative surface tint).
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
      className="bg-surface-card border border-line-subtle rounded-[8px] px-5 py-4 min-h-[132px] flex flex-col gap-1.5 transition-shadow duration-fast hover:shadow-hover-row"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-[0.05em] text-ink-secondary">
          {label}
        </span>
        {deltaText ? (
          <span
            className="text-[12px] font-semibold tabular-nums px-2 py-0.5 rounded-pill bg-surface-page"
            style={{ color: TONE_COLOR[deltaTone] }}
          >
            {deltaText}
          </span>
        ) : null}
      </div>
      <div
        className="font-bold tabular-nums leading-[1.1] break-words mt-1"
        style={{ fontSize: "clamp(22px, 2.5vw, 32px)", color: VALUE_COLOR[tone] }}
      >
        {value}
      </div>
      {subtitle ? (
        <div className="text-[13px] text-ink-secondary tabular-nums whitespace-nowrap overflow-hidden text-ellipsis">
          {subtitle}
        </div>
      ) : null}
    </div>
  );
}
