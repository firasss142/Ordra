"use client";

/**
 * A choice shown as cards with a radio dot (reglages.css `.rg-choice`). Two or four
 * columns. Read-only renders the same cards, not clickable.
 */
export interface OptionCard<V extends string> {
  value: V;
  label: string;
  description?: string;
}

export function OptionCards<V extends string>({
  label,
  value,
  onChange,
  options,
  columns = 4,
  disabled = false,
}: {
  label: string;
  value: V;
  onChange: (next: V) => void;
  options: OptionCard<V>[];
  columns?: 2 | 4;
  disabled?: boolean;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={`rg-choice ${columns === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => !disabled && o.value !== value && onChange(o.value)}
          >
            <b>
              <span aria-hidden className="rad" />
              {o.label}
            </b>
            {o.description && <small>{o.description}</small>}
          </button>
        );
      })}
    </div>
  );
}
