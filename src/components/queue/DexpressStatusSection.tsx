"use client";

import { useTranslations } from "next-intl";
import { useDexpressStatus } from "@/hooks/useDexpressStatus";
import { Button } from "@/components/ui/Button";
import type { Role } from "@/types";

interface DexpressStatusSectionProps {
  orderId: string;
  enabled: boolean;
  role?: Role;
}

const SHOWS_SLUG: ReadonlySet<Role> = new Set<Role>([
  "market_manager",
  "super_admin",
]);

export function DexpressStatusSection({
  orderId,
  enabled,
  role,
}: DexpressStatusSectionProps) {
  const t = useTranslations("dexpressStatus");
  const { snapshot, isLoading, error, refresh } = useDexpressStatus(
    orderId,
    enabled,
  );

  if (!enabled) return null;

  // Loading
  if (isLoading || (!snapshot && !error)) {
    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-secondary mb-1.5">
          {t("sectionTitle")}
        </div>
        <div
          role="status"
          aria-busy="true"
          aria-label={t("loading")}
          className="h-5 w-40 rounded bg-surface-hover animate-pulse"
        />
      </div>
    );
  }

  // Error
  if (error) {
    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-secondary mb-1.5">
          {t("sectionTitle")}
        </div>
        <div
          role="alert"
          className="flex items-center gap-3 text-[13px] text-status-critical"
        >
          <span>{t("loadError")}</span>
          <Button variant="secondary" size="sm" onClick={() => refresh()}>
            {t("retry")}
          </Button>
        </div>
      </div>
    );
  }

  // not_found — distinct from a load error: no retry, just an informational note.
  if (snapshot && snapshot.kind === "not_found") {
    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-secondary mb-1.5">
          {t("sectionTitle")}
        </div>
        <div className="text-[13px] text-ink-secondary">{t("notFound")}</div>
      </div>
    );
  }

  // kind: "ok" — the common path.
  if (snapshot && snapshot.kind === "ok") {
    const showsSlug = role !== undefined && SHOWS_SLUG.has(role);
    const showsUnrecognizedChip = showsSlug && snapshot.slug === null;

    return (
      <div className="px-5 py-3 border-b border-line-subtle bg-surface-card">
        <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-secondary mb-1.5">
          {t("sectionTitle")}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {showsSlug && snapshot.slug && (
            <span className="font-mono text-[12px] text-ink-secondary tabular-nums">
              {snapshot.slug}
            </span>
          )}
          <span
            className="text-[14px] font-medium text-ink-primary"
            dir="rtl"
            lang="ar"
          >
            {snapshot.rawLabel}
          </span>
          {showsUnrecognizedChip && (
            <span className="inline-flex items-center rounded-full bg-status-warningBg px-2 py-0.5 text-[11px] text-status-warning">
              {t("unrecognized")}
            </span>
          )}
        </div>
      </div>
    );
  }

  return null;
}
