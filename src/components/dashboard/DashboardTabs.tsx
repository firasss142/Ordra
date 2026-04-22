"use client";

export type DashboardTab = "equipe" | "rentabilite";

interface DashboardTabsProps {
  activeTab: DashboardTab;
  onChange: (tab: DashboardTab) => void;
  showProfitability?: boolean;
}

const ALL_TABS: { key: DashboardTab; label: string }[] = [
  { key: "equipe", label: "Équipe" },
  { key: "rentabilite", label: "Rentabilité" },
];

export function DashboardTabs({ activeTab, onChange, showProfitability = true }: DashboardTabsProps) {
  const tabs = showProfitability ? ALL_TABS : ALL_TABS.filter((t) => t.key !== "rentabilite");
  if (tabs.length <= 1) return null;
  return (
    <div style={{ display: "flex", gap: 0, borderBottom: "1px solid #D1D5DB", marginBottom: 24 }}>
      {tabs.map((tab) => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          style={{
            padding: "8px 20px",
            fontSize: 14,
            fontWeight: 600,
            color: activeTab === tab.key ? "#1A1A1A" : "#6D7175",
            background: "none",
            border: "none",
            borderBottom: activeTab === tab.key ? "2px solid #1A1A1A" : "2px solid transparent",
            cursor: "pointer",
            marginBottom: -1,
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
