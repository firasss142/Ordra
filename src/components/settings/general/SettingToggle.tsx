"use client";

interface Props {
  on: boolean;
  onToggle: () => void;
  label: string;
  disabled?: boolean;
}

/** The pill switch used across the settings sections (a real role="switch"). */
export function SettingToggle({ on, onToggle, label, disabled }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onToggle}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-pill transition-colors duration-fast ${
        on ? "bg-brand" : "bg-line-strong"
      } ${disabled ? "opacity-50 cursor-not-allowed" : ""}`}
    >
      <span
        className={`absolute top-0.5 h-[18px] w-[18px] rounded-pill bg-white shadow-hover-row transition-all duration-fast ${
          on ? "start-[18px]" : "start-0.5"
        }`}
      />
    </button>
  );
}
