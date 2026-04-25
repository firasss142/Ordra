"use client";

interface Tab<T extends string> {
  key: T;
  label: string;
  description?: string;
}

interface Props<T extends string> {
  tabs: Tab<T>[];
  active: T;
  onChange: (key: T) => void;
}

export function SettingsTabNav<T extends string>({
  tabs,
  active,
  onChange,
}: Props<T>) {
  return (
    <div
      role="tablist"
      className="inline-flex overflow-hidden rounded-md border border-line bg-surface-card"
    >
      {tabs.map((t) => {
        const isActive = active === t.key;
        return (
          <button
            key={t.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(t.key)}
            className={
              "h-9 px-4 text-[13px] font-medium transition-colors duration-fast " +
              (isActive
                ? "bg-ink-primary text-white"
                : "bg-transparent text-ink-primary hover:bg-surface-hover")
            }
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
