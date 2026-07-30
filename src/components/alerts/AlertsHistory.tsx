"use client";

import useSWR from "swr";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import type { AlertType } from "@/app/api/alerts/summary/route";
import type { AlertsTranslator } from "./format";

interface HistoryRow {
  id: string;
  alert_key: string;
  alert_type: string;
  entity_id: string;
  market_id: string | null;
  acknowledged_at: string | null;
  snoozed_until: string | null;
  actor_id: string;
  created_at: string;
  updated_at: string;
}

export function AlertsHistory({
  marketId,
  t,
}: {
  marketId: string | undefined;
  t: AlertsTranslator;
}) {
  const qs = marketId ? `?market_id=${marketId}` : "";
  const { data, error, isLoading } = useSWR<{ history: HistoryRow[]; days: number }>(
    `/api/alerts/history${qs}`,
    { revalidateOnFocus: false, refreshInterval: 60_000 },
  );

  return (
    <Panel title={t("historyTitle")}>
      {isLoading ? (
        <EmptyState label={t("loading")} />
      ) : error ? (
        <EmptyState label={t("loadError")} />
      ) : !data || data.history.length === 0 ? (
        <EmptyState label={t("historyEmpty")} />
      ) : (
        <ul
          style={{
            listStyle: "none",
            margin: 0,
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {data.history.map((h) => (
            <li
              key={h.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 12px",
                border: "1px solid #E1E3E5",
                borderRadius: 6,
                fontSize: 12,
                color: "#1A1A1A",
              }}
            >
              <span style={{ fontWeight: 500 }}>
                {t(`types.${h.alert_type as AlertType}.label` as never, {
                  default: h.alert_type,
                })}
              </span>
              <span style={{ color: "#6D7175" }}>
                {h.acknowledged_at
                  ? t("acknowledgedAt", { when: new Date(h.acknowledged_at).toLocaleString() })
                  : h.snoozed_until
                    ? t("snoozedUntil", { when: new Date(h.snoozed_until).toLocaleString() })
                    : ""}
              </span>
              <div style={{ flex: 1 }} />
              <span
                style={{
                  fontSize: 10,
                  color: "#6D7175",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {new Date(h.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
