"use client";

import { useTranslations } from "next-intl";
import { StatusIcon } from "@/components/shared/StatusIcon";
import { presentStatus, type StatusHue } from "@/lib/orders/status-presentation";
import type { OrderStatus } from "@/types/order-status";
import type { TimelineStage } from "@/app/api/orders/[id]/timeline/route";

const PIPELINE: OrderStatus[] = ["dispatched", "deposit", "in_transit", "delivered"];
const ALT_TERMINAL: OrderStatus[] = ["to_be_returned", "returned"];

/**
 * Where the parcel has got to, and how long each leg took.
 *
 * This was four flat boxes of hardcoded hex (`#1A1A1A`, `#E3E5E7`, `#F6F6F7`)
 * written before the token system, laid out with inline `style` and reading as a
 * row of unrelated cards. It is now a connected rail: the track is one line, a
 * node per stage sits on it, and a reached node is filled in that stage's own
 * hue from the shared presentation map — so the timeline and the status pill on
 * the same screen agree about what colour `delivered` is.
 *
 * The return path swaps the tail rather than appending to it. An order that came
 * back did not also get delivered, and showing both would imply it did.
 *
 * Logical properties throughout: this renders inside the Arabic panel too.
 */
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
    <ol role="list" aria-label={t("label")} className="flex w-full items-start gap-0">
      {displayPipeline.map((status, idx) => {
        const stage = reached.get(status);
        const face = presentStatus(status);
        const isActive = idx === activeIdx;
        const isReached = idx <= activeIdx;
        const dur =
          stage?.duration_hours != null ? formatDuration(stage.duration_hours, t) : null;

        return (
          <li
            key={status}
            aria-current={isActive ? "step" : undefined}
            className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
          >
            {/* Track + node. The two track halves are separate elements so the
                line can be "done" on one side of a node and pending on the
                other, which is what makes progress readable at a glance. */}
            <div className="flex w-full items-center">
              <span
                aria-hidden="true"
                className={`h-[2px] flex-1 rounded-pill ${
                  idx === 0
                    ? "bg-transparent"
                    : isReached
                      ? TRACK_ON[face.hue]
                      : "bg-oms-border"
                }`}
              />
              <span
                aria-hidden="true"
                className={[
                  "grid h-7 w-7 shrink-0 place-items-center rounded-full border transition-colors",
                  isReached
                    ? `${NODE_ON[face.hue]} border-transparent text-white`
                    : "border-oms-border bg-oms-surface-sunken text-oms-ink-3",
                  isActive ? `ring-2 ring-offset-2 ring-offset-oms-surface ${RING[face.hue]}` : "",
                ].join(" ")}
              >
                <StatusIcon name={face.icon} size={14} />
              </span>
              <span
                aria-hidden="true"
                className={`h-[2px] flex-1 rounded-pill ${
                  idx === displayPipeline.length - 1
                    ? "bg-transparent"
                    : idx < activeIdx
                      ? TRACK_ON[face.hue]
                      : "bg-oms-border"
                }`}
              />
            </div>

            <span
              className={`px-1 text-center text-[11px] leading-tight ${
                isActive ? "font-semibold text-oms-ink-1" : "font-medium text-oms-ink-2"
              }`}
            >
              {tStatus(status)}
            </span>
            <span className="text-[10.5px] tabular-nums text-oms-ink-3">
              {dur ?? (isReached ? "—" : t("pending"))}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

const NODE_ON: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-edge",
  amber: "bg-hue-amber-edge",
  violet: "bg-hue-violet-edge",
  teal: "bg-hue-teal-edge",
  green: "bg-hue-green-edge",
  red: "bg-hue-red-edge",
};

const TRACK_ON: Record<StatusHue, string> = {
  neutral: "bg-hue-neutral-edge-mid",
  amber: "bg-hue-amber-edge-mid",
  violet: "bg-hue-violet-edge-mid",
  teal: "bg-hue-teal-edge-mid",
  green: "bg-hue-green-edge-mid",
  red: "bg-hue-red-edge-mid",
};

const RING: Record<StatusHue, string> = {
  neutral: "ring-hue-neutral-edge",
  amber: "ring-hue-amber-edge",
  violet: "ring-hue-violet-edge",
  teal: "ring-hue-teal-edge",
  green: "ring-hue-green-edge",
  red: "ring-hue-red-edge",
};

function formatDuration(
  hours: number,
  t: ReturnType<typeof useTranslations<"inDelivery.timeline">>,
): string {
  if (hours < 1) return t("under1h");
  if (hours < 48) return t("hours", { h: hours });
  const days = Math.round((hours / 24) * 10) / 10;
  return t("days", { d: days });
}
