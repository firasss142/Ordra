"use client";

export interface ConnTab {
  key: string;
  label: string;
  count?: number;
  countTone?: "neutral" | "critical" | "warning";
}

interface Props {
  tabs: ConnTab[];
  active: string;
  onChange: (key: string) => void;
}

/**
 * Underline tabs for the light console (Connexions / Journaux). Deliberately not
 * `ui/SegmentedTabs`, which is agent-shell-themed (dark emerald tokens) and reads
 * as off-brand on the white content surface. Matches the prototype's tab row and
 * the settings SettingsTabNav idiom.
 */
export function ConnectionsTabs({ tabs, active, onChange }: Props) {
  return (
    <div role="tablist" className="mb-4 flex gap-0.5 overflow-x-auto border-b border-line">
      {tabs.map((t) => {
        const on = t.key === active;
        const toneCls =
          t.countTone === "critical"
            ? "bg-status-criticalBg text-status-critical"
            : t.countTone === "warning"
              ? "bg-status-warningBg text-status-warning"
              : on
                ? "bg-brand-bg text-brand"
                : "bg-surface-selected text-ink-secondary";
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3.5 py-2.5 text-[13.5px] transition-colors ${
              on
                ? "border-brand font-semibold text-ink-primary"
                : "border-transparent text-ink-secondary hover:text-ink-primary"
            }`}
          >
            {t.label}
            {typeof t.count === "number" && (
              <span className={`rounded-pill px-1.5 py-0.5 text-[11px] font-semibold ${toneCls}`}>
                {t.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
