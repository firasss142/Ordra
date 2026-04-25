"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { fetcher } from "@/lib/swr-config";

interface OverdueAgentRow {
  confirming_agent_id: string;
  full_name: string;
  overdue_count: number;
}

interface Props {
  marketId: string | null;
  locale?: string;
  onSelectAgent: (agentId: string) => void;
}

const WARNING_THRESHOLD = 5;

export function OverdueByAgentTable({ marketId, onSelectAgent }: Props) {
  const t = useTranslations("crm.followUps");

  const params = marketId ? `?market_id=${marketId}` : "";
  const { data, isLoading } = useSWR<{ data: OverdueAgentRow[] }>(
    `/api/follow-ups/overdue-by-agent${params}`,
    fetcher,
    { revalidateOnFocus: false, refreshInterval: 60_000 }
  );

  const rows = data?.data ?? [];

  if (isLoading || rows.length === 0) return null;

  return (
    <div
      style={{
        background: "white",
        border: "1px solid #E1E3E5",
        borderRadius: 8,
        overflow: "hidden",
        marginBottom: 8,
      }}
    >
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid #E1E3E5",
          fontSize: 13,
          fontWeight: 600,
          color: "#1A1A1A",
        }}
      >
        {t("managerView.title")}
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "#F6F6F7" }}>
            <th
              style={{
                textAlign: "start",
                padding: "8px 16px",
                fontSize: 12,
                fontWeight: 500,
                color: "#6D7175",
              }}
            >
              {t("managerView.agentColumn")}
            </th>
            <th
              style={{
                textAlign: "end",
                padding: "8px 16px",
                fontSize: 12,
                fontWeight: 500,
                color: "#6D7175",
              }}
            >
              &nbsp;
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const isWarning = row.overdue_count > WARNING_THRESHOLD;
            return (
              <tr
                key={row.confirming_agent_id}
                data-overdue-warning={isWarning ? "true" : undefined}
                onClick={() => onSelectAgent(row.confirming_agent_id)}
                style={{
                  cursor: "pointer",
                  background: isWarning ? "#FEF3C7" : "white",
                  borderTop: "1px solid #F3F4F6",
                }}
              >
                <td style={{ padding: "10px 16px", fontSize: 13, color: "#1A1A1A" }}>
                  {row.full_name}
                </td>
                <td style={{ padding: "10px 16px", textAlign: "end" }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: isWarning ? "#92400E" : "#6D7175",
                      background: isWarning ? "#FDE68A" : "#F3F4F6",
                      borderRadius: 4,
                      padding: "2px 8px",
                    }}
                  >
                    {t("managerView.overdueCount", { count: row.overdue_count })}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
