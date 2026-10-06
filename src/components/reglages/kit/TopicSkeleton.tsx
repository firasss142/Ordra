"use client";

import { useTranslations } from "next-intl";
import { Skeleton } from "@/components/ui/Skeleton";

/** Loading shape of a topic: two cards of rows. Never a bare « Chargement… ». */
export function TopicSkeleton({ cards = 2, rows = 3 }: { cards?: number; rows?: number }) {
  const t = useTranslations("reglages");
  return (
    <div aria-busy="true" aria-live="polite">
      {Array.from({ length: cards }).map((_, c) => (
        <div key={c} className="rg-card">
          <div className="border-b border-line-subtle px-[18px] py-[16px]">
            <Skeleton className="h-[18px] w-[220px]" />
            <Skeleton className="mt-[8px] h-[13px] w-[360px] max-w-full" />
          </div>
          {Array.from({ length: rows }).map((__, r) => (
            <div key={r} className="flex items-center gap-[20px] border-b border-line-subtle px-[16px] py-[16px] last:border-b-0">
              <div className="flex-1">
                <Skeleton className="h-[14px] w-[200px]" />
                <Skeleton className="mt-[8px] h-[12px] w-[420px] max-w-full" />
              </div>
              <Skeleton className="h-[36px] w-[140px]" />
            </div>
          ))}
        </div>
      ))}
      <span className="sr-only">{t("common.loading")}</span>
    </div>
  );
}
