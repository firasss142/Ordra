"use client";

import type { ReactNode } from "react";

interface SettingsPageHeaderProps {
  title: string;
  isRtl: boolean;
  description?: string;
  /** Optional actions rendered on the trailing edge (toggles, pills, buttons). */
  right?: ReactNode;
}

export function SettingsPageHeader({
  title,
  isRtl,
  description,
  right,
}: SettingsPageHeaderProps) {
  return (
    <div
      style={{ direction: isRtl ? "rtl" : "ltr" }}
      className="mb-6 flex flex-wrap items-start justify-between gap-4"
    >
      <div className="min-w-0">
        <h1 className="m-0 text-[20px] font-semibold text-ink-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 m-0 max-w-[64ch] text-[13px] text-ink-secondary">
            {description}
          </p>
        )}
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}
