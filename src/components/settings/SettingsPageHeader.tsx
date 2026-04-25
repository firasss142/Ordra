"use client";

interface Market {
  id: string;
  name: string;
  code: string;
}

interface SettingsPageHeaderProps {
  title: string;
  markets: Market[];
  selectedMarketId: string;
  onChange: (marketId: string) => void;
  showMarketSelector: boolean;
  isRtl: boolean;
  description?: string;
}

export function SettingsPageHeader({
  title,
  markets,
  selectedMarketId,
  onChange,
  showMarketSelector,
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

      {showMarketSelector && markets.length > 0 && (
        <div className="flex items-center gap-2">
          <label
            htmlFor="settings-market-selector"
            className="text-[13px] font-medium text-ink-secondary"
          >
            Marché
          </label>
          <select
            id="settings-market-selector"
            value={selectedMarketId}
            onChange={(e) => onChange(e.target.value)}
            className="h-8 cursor-pointer rounded-md border border-line bg-surface-card px-2 text-[13px] text-ink-primary"
          >
            {markets.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
