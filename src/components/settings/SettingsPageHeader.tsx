"use client";

interface SettingsPageHeaderProps {
  title: string;
  isRtl: boolean;
  description?: string;
}

export function SettingsPageHeader({
  title,
  isRtl,
  description,
}: SettingsPageHeaderProps) {
  return (
    <div
      style={{ direction: isRtl ? "rtl" : "ltr" }}
      className="mb-6 flex flex-wrap items-center justify-between gap-4"
    >
      <div className="min-w-0">
        <h1 className="m-0 text-[20px] font-semibold text-ink-primary">
          {title}
        </h1>
        {description && (
          <p className="mt-1 m-0 text-[13px] text-ink-secondary">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}
