"use client";

/**
 * The one switch of Réglages (prototype `.sw`): 36×20 track, brand green when
 * on. A read-only setting never renders a disabled switch — it shows a badge
 * (see ReadOnlyState) — so `disabled` is only for "not right now".
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        if (!disabled) onChange(!checked);
      }}
      className="inline-flex items-center rounded-full p-[2px] disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span
        className={`relative h-[20px] w-[36px] rounded-full transition-colors ${checked ? "bg-brand" : "bg-[#C9CDD2]"}`}
      >
        <span
          className={`absolute top-[2px] h-[16px] w-[16px] rounded-full bg-white transition-[inset-inline-start] ${checked ? "start-[18px]" : "start-[2px]"}`}
        />
      </span>
    </button>
  );
}
