"use client";

/**
 * A choice shown as cards with a radio dot (prototype `.opt`). Two or four
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
    <div
      role="radiogroup"
      aria-label={label}
      className={`grid gap-[10px] ${columns === 4 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-2"}`}
    >
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
            className={`flex flex-col gap-[3px] rounded-[8px] bg-white text-start disabled:cursor-default ${on ? "border-[1.5px] border-brand bg-brand-tint px-[11.5px] py-[10.5px]" : "border border-[#D2D5D9] px-[12px] py-[11px]"}`}
          >
            <span className="flex items-center gap-[8px] text-[13.5px] font-semibold text-ink-primary">
              <span
                aria-hidden
                className={`h-[16px] w-[16px] flex-none rounded-full border-[1.5px] ${on ? "border-brand bg-brand shadow-[inset_0_0_0_3px_#fff]" : "border-[#C9CCCF]"}`}
              />
              {o.label}
            </span>
            {o.description && <span className="text-[12.5px] leading-[1.4] text-ink-secondary">{o.description}</span>}
          </button>
        );
      })}
    </div>
  );
}
