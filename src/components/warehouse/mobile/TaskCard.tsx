"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { WmCard } from "./primitives";

/**
 * One "Critical Task" (mockup 01) — a real bench queue.
 *
 * Anatomy copied from the mockup: a bold title, then a progress bar with its
 * percentage on the SAME line, then one caption line. No hero number — these
 * cards sit two-up, and a big figure does not fit beside a title in half a
 * phone's width.
 *
 * The mockup invents tasks with clock deadlines ("Deadline: 2:00 PM"). There
 * is no task model and no deadline anywhere in the OMS, so the caption
 * carries what is true instead: how many are waiting and how long the oldest
 * has waited.
 *
 * An empty queue is DIMMED, never hidden: a Critical Tasks section that
 * renders nothing reads as a broken screen rather than as "you are up to date".
 */
export function TaskCard({
  href,
  title,
  pending,
  done,
  foot,
}: {
  href: string;
  title: string;
  pending: number;
  done: number;
  /**
   * The caption line, composed by the caller. It is not built from `pending`
   * here because some queues name their own count ("3 produits jamais
   * comptés") and the prefix printed it twice.
   */
  foot: string | null;
}) {
  const t = useTranslations("warehouse.dash");
  const total = pending + done;
  // Guard the empty day: 0/0 is 0 %, not NaN.
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const idle = pending === 0;

  return (
    <Link href={href} className="block no-underline">
      <WmCard
        data-testid="wm-task-card"
        data-idle={idle ? "true" : "false"}
        className="p-3"
      >
        <h3 className="truncate text-[13px] font-bold text-wm-ink">{title}</h3>

        <div data-testid="wm-task-progress" className="mt-2.5 flex items-center gap-2">
          <div
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={title}
            className="h-[7px] flex-1 overflow-hidden rounded-pill bg-wm-track"
          >
            <i
              className="block h-full rounded-pill bg-wm-accent"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="shrink-0 text-[12px] font-semibold tabular-nums text-wm-ink-2">
            {pct}%
          </span>
        </div>

        <p data-testid="wm-task-foot" className="mt-2 truncate text-[11.5px] text-wm-ink-2">
          {idle ? t("taskIdle") : (foot ?? "")}
        </p>
      </WmCard>
    </Link>
  );
}
