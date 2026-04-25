"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { getDueUrgency, type DueUrgency, type OrderFollowUpWithOrder } from "@/types/follow-up";
import { FollowUpCard } from "./FollowUpCard";

interface Props {
  rows: OrderFollowUpWithOrder[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  marketCode: "TN" | "LY";
  locale: string;
  nowMs?: number;
  onLogAttempt: (fu: OrderFollowUpWithOrder) => void;
}

type Bucket = { urgency: DueUrgency; rows: OrderFollowUpWithOrder[] };

const BUCKET_ORDER: DueUrgency[] = ["overdue", "due_today", "due_future", "no_schedule"];

const BUCKET_HEADER_STYLE: Record<DueUrgency, React.CSSProperties> = {
  overdue: { borderInlineStart: "3px solid #B91C1C", paddingInlineStart: 10, color: "#B91C1C" },
  due_today: { borderInlineStart: "3px solid #92400E", paddingInlineStart: 10, color: "#92400E" },
  due_future: { borderInlineStart: "3px solid #6B7280", paddingInlineStart: 10, color: "#6B7280" },
  no_schedule: { borderInlineStart: "3px solid #D1D5DB", paddingInlineStart: 10, color: "#6B7280" },
};

const I18N_KEYS: Record<DueUrgency, string> = {
  overdue: "overdueBucket",
  due_today: "dueTodayBucket",
  due_future: "dueFutureBucket",
  no_schedule: "noScheduleBucket",
};

export function FollowUpsTimeline({
  rows,
  hasMore,
  loadingMore,
  onLoadMore,
  marketCode,
  locale,
  nowMs = Date.now(),
  onLogAttempt,
}: Props) {
  const t = useTranslations("crm.followUps");

  const buckets = useMemo<Bucket[]>(() => {
    const map: Record<DueUrgency, OrderFollowUpWithOrder[]> = {
      overdue: [],
      due_today: [],
      due_future: [],
      no_schedule: [],
    };
    for (const row of rows) {
      map[getDueUrgency(row.due_at, nowMs)].push(row);
    }
    return BUCKET_ORDER.map((urgency) => ({ urgency, rows: map[urgency] })).filter(
      (b) => b.rows.length > 0
    );
  }, [rows, nowMs]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
      {buckets.map(({ urgency, rows: bucketRows }) => (
        <section key={urgency}>
          <h2
            role="heading"
            aria-level={2}
            style={{
              fontSize: 13,
              fontWeight: 600,
              margin: "0 0 10px",
              ...BUCKET_HEADER_STYLE[urgency],
            }}
          >
            {t(I18N_KEYS[urgency])}
            <span
              style={{
                marginInlineStart: 8,
                fontSize: 12,
                fontWeight: 400,
                color: "#9CA3AF",
              }}
            >
              {bucketRows.length}
            </span>
          </h2>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {bucketRows.map((fu) => (
              <div key={fu.id} style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <FollowUpCard
                    followUp={fu}
                    marketCode={marketCode}
                    locale={locale}
                    density="compact"
                  />
                </div>
                <button
                  type="button"
                  onClick={() => onLogAttempt(fu)}
                  style={{
                    flexShrink: 0,
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: "1px solid #E1E3E5",
                    background: "white",
                    color: "#1A1A1A",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  {t("logAttempt")}
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}

      {hasMore && (
        <div style={{ textAlign: "center" }}>
          <button
            type="button"
            onClick={onLoadMore}
            disabled={loadingMore}
            style={{
              fontSize: 13,
              padding: "8px 16px",
              borderRadius: 6,
              border: "1px solid #E1E3E5",
              background: "white",
              color: "#1A1A1A",
              cursor: loadingMore ? "not-allowed" : "pointer",
              opacity: loadingMore ? 0.6 : 1,
            }}
          >
            {loadingMore ? "…" : t("column.loadMore")}
          </button>
        </div>
      )}
    </div>
  );
}
