"use client";

import { useTranslations } from "next-intl";
import { AlertTriangle, Info, Package } from "lucide-react";
import type { SheetCheck, SheetCheckSeverity } from "@/lib/products/sheet-checks";
import type { AgentBriefTone } from "@/types/product";

export interface ProductBriefBannerProps {
  /** The pinned must-know left on the product by a manager. */
  brief: string | null;
  tone: AgentBriefTone;
  /** Verification checks for this order; only non-info ones are surfaced here. */
  checks: SheetCheck[];
  onOpenSheet: () => void;
}

const ROW_TONE: Record<SheetCheckSeverity, string> = {
  critical: "bg-status-criticalBg border-status-critical/15 text-status-critical",
  warning: "bg-status-warningBg border-status-warning/15 text-status-warning",
  info: "bg-surface-page border-line-subtle text-ink-secondary",
};

interface Row {
  key: string;
  severity: SheetCheckSeverity;
  label: string;
  text: string;
}

/**
 * The zero-click layer of the product sheet: rendered inline on the order so
 * an agent reads it without opening anything. Everything else lives behind
 * the drawer.
 *
 * Renders nothing when there is no brief and no problem to report — an empty
 * strip would cost vertical space on every healthy order.
 */
export function ProductBriefBanner({
  brief,
  tone,
  checks,
  onOpenSheet,
}: ProductBriefBannerProps) {
  const t = useTranslations("productSheet");

  const trimmedBrief = brief?.trim() ? brief.trim() : null;

  const rows: Row[] = checks
    .filter((c) => c.severity !== "info")
    .map((c) => ({
      key: c.code,
      severity: c.severity,
      label: "",
      text: t(`checks.${c.code}`, c.values ?? {}),
    }));

  if (trimmedBrief) {
    rows.push({
      key: "brief",
      severity: tone,
      label: t("mustKnow"),
      text: trimmedBrief,
    });
  }

  if (rows.length === 0) return null;

  return (
    <div className="flex flex-col">
      {rows.map((row, idx) => {
        const isLast = idx === rows.length - 1;
        const Icon = row.severity === "info" ? Info : AlertTriangle;
        return (
          <div
            key={row.key}
            className={`flex items-start gap-2 px-4 py-2.5 border-y text-[12px] ${ROW_TONE[row.severity]}`}
          >
            <Icon size={13} strokeWidth={2} className="flex-shrink-0 mt-0.5" aria-hidden="true" />
            <div className="flex-1 min-w-0">
              {row.label && <span className="font-semibold">{row.label}</span>}
              <span className={row.label ? "ms-2" : "font-medium"}>{row.text}</span>
            </div>
            {/* One affordance per banner, on the last row, so problems-without-
                a-brief still lead somewhere. */}
            {isLast && (
              <button
                type="button"
                onClick={onOpenSheet}
                className="flex-shrink-0 inline-flex items-center gap-1 text-[11px] font-medium underline underline-offset-2 hover:no-underline"
              >
                <Package size={11} strokeWidth={2} aria-hidden="true" />
                {t("open")}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
