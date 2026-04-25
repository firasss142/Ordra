"use client";

import { useTranslations } from "next-intl";
import type { OrderStatus } from "@/types/order-status";
import type { TimelineStage } from "@/app/api/orders/[id]/timeline/route";

const PIPELINE: OrderStatus[] = ["dispatched", "deposit", "in_transit", "delivered"];
const ALT_TERMINAL: OrderStatus[] = ["to_be_returned", "returned"];

export function OrderTimeline({
  stages,
  currentStatus,
}: {
  stages: TimelineStage[];
  currentStatus: OrderStatus;
}) {
  const t = useTranslations("inDelivery.timeline");
  const tStatus = useTranslations("orders.statuses");

  const isReturnPath =
    currentStatus === "to_be_returned" ||
    currentStatus === "returned" ||
    stages.some((s) => s.status === "to_be_returned" || s.status === "returned");
  const displayPipeline = isReturnPath
    ? (["dispatched", "deposit", "in_transit", ...ALT_TERMINAL] as OrderStatus[])
    : PIPELINE;

  const reached = new Map<OrderStatus, TimelineStage>();
  for (const stage of stages) reached.set(stage.status, stage);

  const currentIdx = displayPipeline.indexOf(currentStatus);
  const activeIdx = currentIdx >= 0 ? currentIdx : displayPipeline.length - 1;

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        alignItems: "stretch",
        width: "100%",
      }}
      role="list"
      aria-label={t("label")}
    >
      {displayPipeline.map((status, idx) => {
        const stage = reached.get(status);
        const isActive = idx === activeIdx;
        const isReached = idx <= activeIdx;
        const dur =
          stage?.duration_hours != null ? formatDuration(stage.duration_hours, t) : null;

        const bg = isActive
          ? "#1A1A1A"
          : isReached
            ? "#E3E5E7"
            : "#F6F6F7";
        const fg = isActive ? "#FFFFFF" : isReached ? "#1A1A1A" : "#6D7175";
        const border = isReached ? "1px solid #D1D5DB" : "1px dashed #E1E3E5";

        return (
          <div
            key={status}
            role="listitem"
            style={{
              flex: 1,
              minWidth: 0,
              padding: "8px 10px",
              border,
              borderRadius: 4,
              backgroundColor: bg,
              color: fg,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {tStatus(status)}
            </span>
            <span
              style={{
                fontSize: 11,
                fontVariantNumeric: "tabular-nums",
                opacity: isReached ? 0.85 : 1,
              }}
            >
              {dur ?? (isReached ? "—" : t("pending"))}
            </span>
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(
  hours: number,
  t: ReturnType<typeof useTranslations<"inDelivery.timeline">>,
): string {
  if (hours < 1) return t("under1h");
  if (hours < 48) return t("hours", { h: hours });
  const days = Math.round((hours / 24) * 10) / 10;
  return t("days", { d: days });
}
