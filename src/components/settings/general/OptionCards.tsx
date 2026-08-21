"use client";

import type { ReactNode } from "react";

export interface OptionCard {
  value: string;
  label: string;
  hint?: string;
  icon?: ReactNode;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  options: OptionCard[];
  disabled?: boolean;
}

/**
 * A row of radio "cards" — the prototype's option picker. Each card is a real
 * radio (aria-checked) so it stays keyboard- and screen-reader-navigable; the
 * selected one gets the brand ring + a filled dot. Used for enum settings
 * (after_max_attempts_action, unknown_city_policy, outside_hours_policy).
 */
export function OptionCards({ value, onChange, options, disabled = false }: Props) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup">
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={opt.label}
            disabled={disabled}
            onClick={() => !disabled && onChange(opt.value)}
            className={`relative flex-1 min-w-[150px] rounded-md border px-3 py-2.5 ps-9 text-start transition-colors duration-fast ${
              selected
                ? "border-brand bg-brand-tint shadow-[0_0_0_1px_var(--brand)_inset]"
                : "border-line bg-surface-card hover:border-line-strong hover:bg-surface-hover"
            } ${disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
          >
            <span
              aria-hidden
              className={`absolute start-3 top-3 h-[15px] w-[15px] rounded-pill border transition-colors ${
                selected ? "border-brand" : "border-line-strong bg-surface-card"
              }`}
            >
              {selected && (
                <span className="absolute inset-[3px] rounded-pill bg-brand" />
              )}
            </span>
            <span className="block text-[13px] font-medium text-ink-primary">
              {opt.label}
            </span>
            {opt.hint && (
              <span className="block text-[12px] text-ink-secondary">{opt.hint}</span>
            )}
            {opt.icon && (
              <span className="absolute end-3 top-3 text-ink-muted opacity-40">
                {opt.icon}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
