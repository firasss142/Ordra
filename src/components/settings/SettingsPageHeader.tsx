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
      style={{
        direction: isRtl ? "rtl" : "ltr",
        marginBottom: 24,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 16,
        flexWrap: "wrap",
      }}
    >
      <div>
        <h1
          style={{
            fontSize: 20,
            fontWeight: 600,
            color: "#1A1A1A",
            margin: 0,
          }}
        >
          {title}
        </h1>
        {description && (
          <p
            style={{
              fontSize: 13,
              color: "#6D7175",
              margin: "4px 0 0 0",
            }}
          >
            {description}
          </p>
        )}
      </div>

      {showMarketSelector && markets.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label
            htmlFor="settings-market-selector"
            style={{
              fontSize: 13,
              fontWeight: 500,
              color: "#374151",
            }}
          >
            Marché
          </label>
          <select
            id="settings-market-selector"
            value={selectedMarketId}
            onChange={(e) => onChange(e.target.value)}
            style={{
              height: 32,
              padding: "0 8px",
              fontSize: 13,
              border: "1px solid #E1E3E5",
              borderRadius: "0.5rem",
              background: "white",
              cursor: "pointer",
            }}
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
