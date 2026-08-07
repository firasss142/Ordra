"use client";

import { useTranslations } from "next-intl";
import { Inbox } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OrderCard } from "./OrderCard";
import type { QueueOrder } from "@/types/queue";
import type { BucketKey } from "./QueueHeader";
import type { ParsedQuery } from "@/lib/queue/search";
import { QUEUE_ROW_GRID, QUEUE_ROW_SPACING } from "./row-grid";

interface QueueStats {
  assigned_count: number;
  actioned_count: number;
  confirmation_rate: number;
}

interface QueueListProps {
  orders: QueueOrder[];
  onOpenDetail: (orderId: string) => void;
  onCallTerminated: (orderId: string) => void;
  onRefresh?: () => void;
  stats?: QueueStats;
  focusedOrderId?: string | null;
  selectedOrderIds?: Set<string>;
  onToggleSelect?: (id: string) => void;
  selectedBucket: BucketKey;
  maxAttempts?: number;
  /** Active search query — drives highlighting and the search empty-state. */
  highlightQuery?: ParsedQuery;
  isSearching?: boolean;
  /** Raw search text, for the "no results for «…»" message. */
  searchText?: string;
  onClearSearch?: () => void;
}

function StatCell({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[20px] font-semibold tabular-nums text-ink-primary leading-none">
        {value}
      </span>
      <span className="text-[11px] uppercase tracking-wider text-ink-secondary">
        {label}
      </span>
    </div>
  );
}

export function QueueList({
  orders,
  onOpenDetail,
  onCallTerminated,
  onRefresh,
  stats,
  focusedOrderId,
  selectedOrderIds,
  onToggleSelect,
  selectedBucket,
  maxAttempts = 3,
  highlightQuery,
  isSearching = false,
  searchText = "",
  onClearSearch,
}: QueueListProps) {
  const t = useTranslations("queue");
  const tSearch = useTranslations("queue.search");

  if (orders.length === 0 && isSearching) {
    return (
      <div role="status" className="flex flex-col items-center justify-center gap-3 px-6 py-20">
        <div
          aria-hidden="true"
          className="flex items-center justify-center w-16 h-16 rounded-full bg-surface-selected text-ink-muted"
        >
          <Inbox size={28} strokeWidth={1.75} />
        </div>
        <div className="text-[16px] font-semibold text-ink-primary">
          {tSearch("noResultsTitle")}
        </div>
        <div className="text-[13px] text-ink-secondary text-center max-w-[360px]">
          {tSearch("noResultsSubtitle", { query: searchText })}
        </div>
        {onClearSearch && (
          <Button size="sm" onClick={onClearSearch} className="mt-2">
            {tSearch("clear")}
          </Button>
        )}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div role="status" className="flex flex-col items-center justify-center gap-3 px-6 py-20">
        <div
          aria-hidden="true"
          className="flex items-center justify-center w-16 h-16 rounded-full bg-surface-selected text-ink-muted"
        >
          <Inbox size={28} strokeWidth={1.75} />
        </div>
        <div className="text-[16px] font-semibold text-ink-primary">
          {t("emptyStateTitle")}
        </div>
        <div className="text-[13px] text-ink-secondary text-center max-w-[360px]">
          {t("emptyStateSubtitle")}
        </div>
        {onRefresh && (
          <Button size="sm" onClick={onRefresh} className="mt-2">
            {t("refreshQueue")}
          </Button>
        )}
        {stats && (
          <Card className="mt-6 w-full max-w-[480px]">
            <div className="px-5 py-4 flex items-center gap-8">
              <div className="text-[11px] uppercase tracking-wider text-ink-secondary">
                {t("todayStats")}
              </div>
              <div className="flex items-center gap-8 ms-auto">
                <StatCell value={String(stats.assigned_count)} label={t("stats.assigned")} />
                <StatCell value={String(stats.actioned_count)} label={t("stats.actioned")} />
                <StatCell
                  value={`${stats.confirmation_rate.toFixed(1)}%`}
                  label={t("stats.confirmationRate")}
                />
              </div>
            </div>
          </Card>
        )}
      </div>
    );
  }

  const hasSelection = (selectedOrderIds?.size ?? 0) > 0;

  return (
    <div
      data-has-selection={hasSelection || undefined}
      className={["px-4 pt-3 sm:px-5", hasSelection ? "pb-24" : "pb-10"].join(" ")}
    >
      {/* Rows sit in one banded shell rather than as separate floating cards:
          twelve boxes stacked with a gap read as a form, a single ruled list
          reads as a list. No overflow-hidden — the row's hover notes have to be
          able to escape the shell. */}
      <div className="rounded-xl border border-agent-outline-variant bg-agent-surface">
        {/* Two adjacent time columns are a guessing game unlabelled. This costs
            34px once instead of ambiguity on every row. */}
        <div
          role="row"
          aria-hidden="true"
          className={[
            "grid items-center rounded-t-xl border-b border-agent-outline-variant",
            "bg-agent-surface-low py-2",
            QUEUE_ROW_GRID,
            QUEUE_ROW_SPACING,
            "text-[10px] font-bold tracking-[0.08em] text-agent-ink-3",
          ].join(" ")}
        >
          <span />
          <span />
          <span>{t("columns.customer")}</span>
          <span className="hidden lg:block">{t("columns.age")}</span>
          <span className="hidden lg:block">{t("columns.lastAction")}</span>
          <span className="hidden lg:block">{t("columns.status")}</span>
          <span className="text-end">{t("columns.amount")}</span>
          <span />
        </div>

        {orders.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            onOpenDetail={onOpenDetail}
            onCallTerminated={onCallTerminated}
            focused={focusedOrderId === order.id}
            isSelected={selectedOrderIds?.has(order.id) ?? false}
            onToggleSelect={onToggleSelect}
            selectedBucket={selectedBucket}
            maxAttempts={maxAttempts}
            highlightQuery={highlightQuery}
            onMutate={onRefresh}
          />
        ))}
      </div>
    </div>
  );
}
