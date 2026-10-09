"use client";

/**
 * The one switch of Réglages: brand green when on (reglages.css `.rg-sw`). A
 * read-only setting never renders a disabled switch — it shows a badge — so
 * `disabled` is only for "not right now".
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
      <span className="rg-sw" />
    </button>
  );
}
