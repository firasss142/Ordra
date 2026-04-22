import type { StatusConfig } from "@/types/status-config";
import type { Locale } from "@/types";

/**
 * Resolves the localized label for a DB-driven status config.
 * Falls back to key if the requested locale label is missing.
 */
export function getStatusLabel(
  config: Pick<StatusConfig, "key" | "label_fr" | "label_ar">,
  locale: Locale
): string {
  if (locale === "ar") return config.label_ar || config.key;
  return config.label_fr || config.key;
}

/**
 * Map a status config to one of the KanbanBoard's functional accent tokens.
 * Prefers semantic meaning (initial/terminal/key hints) over raw hex so the
 * kanban stays consistent with the design system.
 */
export type AccentToken = "neutral" | "action" | "success" | "warning" | "critical";

export function accentForStatus(
  config: Pick<StatusConfig, "key" | "is_initial" | "is_terminal">
): AccentToken {
  if (config.is_terminal) {
    const k = config.key.toLowerCase();
    if (/\b(won|qualified|resolved|delivered)\b/.test(k)) return "success";
    if (/\b(lost|rejected|cancelled|failed)\b/.test(k)) return "critical";
    return "neutral";
  }
  const k = config.key.toLowerCase();
  if (/\b(callback|scheduled|escalated|blocked|pending)\b/.test(k)) return "warning";
  if (config.is_initial) return "neutral";
  return "action";
}
