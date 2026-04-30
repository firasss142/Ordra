"use client";

import { Layout, ScanLine } from "lucide-react";

export type ScanMode = "scan" | "workbench";

interface Props {
  mode: ScanMode;
  onChange: (mode: ScanMode) => void;
  labels: {
    scan: string;
    workbench: string;
    ariaLabel: string;
  };
}

export function ScanModeToggle({ mode, onChange, labels }: Props) {
  const items: { key: ScanMode; label: string; Icon: typeof ScanLine }[] = [
    { key: "scan", label: labels.scan, Icon: ScanLine },
    { key: "workbench", label: labels.workbench, Icon: Layout },
  ];
  return (
    <div
      role="tablist"
      aria-label={labels.ariaLabel}
      className="inline-flex items-center bg-surface-page border border-line-subtle rounded-card p-0.5 gap-0.5"
    >
      {items.map(({ key, label, Icon }) => {
        const active = mode === key;
        return (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={label}
            onClick={() => onChange(key)}
            className={[
              "inline-flex items-center gap-1.5 h-7 px-2.5 rounded-md text-[12px] font-medium transition-colors duration-fast cursor-pointer",
              active
                ? "bg-surface-card text-ink-primary shadow-hover-row"
                : "bg-transparent text-ink-secondary hover:text-ink-primary",
            ].join(" ")}
          >
            <Icon size={13} strokeWidth={1.75} aria-hidden />
            <span>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
