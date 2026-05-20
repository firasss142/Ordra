"use client";

import useSWR from "swr";
import { useTranslations } from "next-intl";
import { fetcher } from "@/lib/swr-config";
import type { StatusCounts } from "@/app/api/orders/status-counts/route";

interface Props {
  marketId: string | null;
}

interface Tile {
  key: keyof Omit<StatusCounts, "total">;
  dot: string;
}

const TILES: Tile[] = [
  { key: "pending",   dot: "#F59E0B" },
  { key: "confirmed", dot: "#3B82F6" },
  { key: "uploaded",  dot: "#8B5CF6" },
  { key: "rejected",  dot: "#EF4444" },
  { key: "cancelled", dot: "#9CA3AF" },
];

export function OrdersStatusStrip({ marketId }: Props) {
  const t = useTranslations("orders.statusStrip");

  const url = marketId
    ? `/api/orders/status-counts?market_id=${marketId}`
    : `/api/orders/status-counts`;

  const { data, isLoading } = useSWR<{ data: StatusCounts }>(url, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: false,
  });

  const counts = data?.data;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      {TILES.map(({ key, dot }) => {
        const count = counts?.[key] ?? 0;
        return (
          <div
            key={key}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "5px 10px",
              background: "#FFFFFF",
              border: "1px solid #E1E3E5",
              borderRadius: 6,
              fontSize: 12,
              fontWeight: 500,
              color: "#1A1A1A",
              opacity: isLoading ? 0.5 : 1,
              transition: "opacity 200ms ease",
              whiteSpace: "nowrap",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: dot,
                flexShrink: 0,
              }}
            />
            <span style={{ color: "#6D7175" }}>{t(key)}</span>
            <span
              style={{
                fontVariantNumeric: "tabular-nums",
                fontWeight: 700,
                color: "#1A1A1A",
                marginInlineStart: 1,
              }}
            >
              {isLoading ? "—" : count.toLocaleString()}
            </span>
          </div>
        );
      })}

      {counts && (
        <div
          style={{
            marginInlineStart: 4,
            fontSize: 12,
            color: "#9CA3AF",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {t("total", { count: counts.total })}
        </div>
      )}
    </div>
  );
}
