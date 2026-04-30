"use client";

import { useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/Button";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface LogRow {
  id: string;
  product_id: string;
  order_id: string | null;
  change: number;
  reason: string;
  note: string | null;
  actor_id: string | null;
  created_at: string;
}

interface StockHistoryPanelProps {
  productId: string;
  locale?: string;
}

const PAGE_SIZE = 20;

export function StockHistoryPanel({
  productId,
  locale = "fr",
}: StockHistoryPanelProps) {
  const [page, setPage] = useState(1);
  const tHistory = useTranslations("productPnl.stockHistory");
  const tProducts = useTranslations("products");

  const { data, isLoading } = useSWR<{
    data: LogRow[];
    pagination: { page: number; limit: number; total: number };
  }>(
    `/api/products/${productId}/stock?page=${page}&limit=${PAGE_SIZE}`,
    fetcher,
  );

  const rows = data?.data ?? [];
  const total = data?.pagination?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const dateLocale = locale === "ar" ? "ar" : "fr-FR";

  return (
    <section className="rounded-card border border-line-subtle bg-surface-card p-5">
      <h2 className="mb-4 text-[13px] font-medium uppercase tracking-[0.05em] text-ink-secondary">
        {tHistory("title")}
      </h2>

      {isLoading ? (
        <div className="py-6 text-center text-[13px] text-ink-secondary">
          {tHistory("loading")}
        </div>
      ) : rows.length === 0 ? (
        <div className="py-6 text-center text-[13px] text-ink-secondary">
          {tHistory("empty")}
        </div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-line-subtle">
            <table className="w-full border-collapse">
              <thead>
                <tr>
                  <th className="border-b border-line-subtle px-3 py-2 text-start text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-secondary whitespace-nowrap">
                    {tHistory("colDate")}
                  </th>
                  <th className="border-b border-line-subtle px-3 py-2 text-end text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-secondary whitespace-nowrap">
                    {tHistory("colMovement")}
                  </th>
                  <th className="border-b border-line-subtle px-3 py-2 text-start text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-secondary whitespace-nowrap">
                    {tHistory("colReason")}
                  </th>
                  <th className="border-b border-line-subtle px-3 py-2 text-start text-[12px] font-semibold uppercase tracking-[0.05em] text-ink-secondary whitespace-nowrap">
                    {tHistory("colNote")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="hover:bg-surface-hover">
                    <td className="border-b border-line-subtle px-3 py-2 text-[13px] text-ink-secondary">
                      {new Date(row.created_at).toLocaleString(dateLocale, {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </td>
                    <td
                      className={`border-b border-line-subtle px-3 py-2 text-end text-[13px] font-semibold tabular-nums ${
                        row.change > 0
                          ? "text-status-success"
                          : "text-status-critical"
                      }`}
                    >
                      {row.change > 0 ? `+${row.change}` : row.change}
                    </td>
                    <td className="border-b border-line-subtle px-3 py-2 text-[13px] text-ink-primary">
                      {tProducts(
                        `stockReasons.${row.reason}` as Parameters<typeof tProducts>[0],
                      ) ?? row.reason}
                    </td>
                    <td className="border-b border-line-subtle px-3 py-2 text-[13px] text-ink-secondary">
                      {row.note ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 ? (
            <div className="mt-3 flex items-center justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                {tHistory("prev")}
              </Button>
              <span className="text-[13px] tabular-nums text-ink-secondary">
                {tHistory("pageOf", { page, total: totalPages })}
              </span>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                {tHistory("next")}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
