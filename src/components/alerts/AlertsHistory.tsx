"use client";

import useSWR from "swr";
import { Panel, EmptyState } from "@/components/dashboard/Panel";
import { typeLabel, type AlertsTranslator } from "./format";

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
        <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
          {data.history.map((h) => (
            <li
              key={h.id}
              className="flex items-center gap-2.5 rounded-[8px] border border-oms-border px-3 py-2 text-[12px] text-oms-ink-1"
            >
              <span className="flex-shrink-0 font-medium">{typeLabel(h.alert_type, t)}</span>
              <span className="truncate text-oms-ink-3">
                {h.acknowledged_at
                  ? t("acknowledgedAt", { when: new Date(h.acknowledged_at).toLocaleString() })
                  : h.snoozed_until
                    ? t("snoozedUntil", { when: new Date(h.snoozed_until).toLocaleString() })
                    : ""}
              </span>
              <span className="flex-1" />
              <span className="flex-shrink-0 text-[10px] tabular-nums text-oms-ink-3">
                {new Date(h.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
