"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";

const fetcher = async (url: string) => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

interface HistoryRow {
  order_id: string;
  status_from: string;
  status_to: string;
  created_at: string;
  customer_name: string | null;
  product_name: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  confirmed: "#008060",
  uploaded: "#008060",
  rejected: "#D72C0D",
  attempt_1: "#D97706",
  attempt_2: "#D97706",
  attempt_3: "#D97706",
  callback_scheduled: "#2563EB",
  assigned: "#9CA3AF",
};

function dayLabel(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
  });
}

interface AgentHistoryPanelProps {
  agentId: string;
}

export function AgentHistoryPanel({ agentId }: AgentHistoryPanelProps) {
  const t = useTranslations("teamPerf.drilldown");
  const { data, isLoading } = useSWR<{ data: HistoryRow[] }>(
    `/api/team/${agentId}/history?days=30`,
    fetcher,
    { revalidateOnFocus: false }
  );

  if (isLoading) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#6D7175" }}>
        {t("historyEmpty")}
      </div>
    );
  }

  const rows = data?.data ?? [];

  if (rows.length === 0) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontSize: 14, color: "#6D7175" }}>
        {t("historyEmpty")}
      </div>
    );
  }

  // Group by date
  const grouped = new Map<string, HistoryRow[]>();
  for (const row of rows) {
    const day = row.created_at.slice(0, 10);
    if (!grouped.has(day)) grouped.set(day, []);
    grouped.get(day)!.push(row);
  }

  return (
    <div style={{ padding: "0 0 24px 0" }}>
      {[...grouped.entries()].map(([day, dayRows]) => (
        <div key={day}>
          <div
            style={{
              padding: "10px 24px 6px",
              fontSize: 11,
              fontWeight: 600,
              color: "#6D7175",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              borderBottom: "1px solid #F3F4F6",
              backgroundColor: "#FAFBFB",
            }}
          >
            {dayLabel(day)}
          </div>
          {dayRows.map((row, i) => (
            <div
              key={`${row.order_id}-${i}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                padding: "10px 24px",
                borderBottom: "1px solid #F3F4F6",
              }}
            >
              <div
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  backgroundColor: STATUS_COLOR[row.status_to] ?? "#9CA3AF",
                  marginTop: 5,
                  flexShrink: 0,
                }}
              />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "#1A1A1A" }}>
                  {row.customer_name ?? row.order_id.slice(0, 8)}
                </div>
                <div style={{ fontSize: 12, color: "#6D7175", marginTop: 2 }}>
                  {row.product_name}
                  {" · "}
                  <span style={{ color: STATUS_COLOR[row.status_to] ?? "#6D7175" }}>
                    {row.status_from} → {row.status_to}
                  </span>
                </div>
              </div>
              <div style={{ fontSize: 11, color: "#9CA3AF", whiteSpace: "nowrap" }}>
                {new Date(row.created_at).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
