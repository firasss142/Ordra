"use client";

import { AlertTriangle, Check, CheckCheck, Clock } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * ✓ sent · ✓✓ delivered · ✓✓ blue read · ⚠ failed. The tone is the only
 * colour on the thread, and it says one thing: did it reach the customer.
 */
export function StatusGlyph({ status, code }: { status: string; code?: number | null }) {
  const t = useTranslations("whatsapp.status");
  const label = t(status as Parameters<typeof t>[0]);
  if (status === "failed") {
    return (
      <span data-status="failed" title={label} className="inline-flex items-center gap-1 text-[12px] font-bold text-[#B91C1C]" aria-label={label}>
        <AlertTriangle size={13} strokeWidth={2.4} aria-hidden="true" />
        {label}
        {code ? <span className="tabular-nums">· Meta {code}</span> : null}
      </span>
    );
  }
  if (status === "queued") {
    return (
      <span data-status="queued" title={label} aria-label={label} className="inline-flex text-[#9CA3AF]">
        <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span data-status="sent" title={label} aria-label={label} className="inline-flex text-[#9CA3AF]">
        <Check size={13} strokeWidth={2.6} aria-hidden="true" />
      </span>
    );
  }
  return (
    <span data-status={status} title={label} aria-label={label} className={`inline-flex ${status === "read" ? "text-[#2C6ECB]" : "text-[#9CA3AF]"}`}>
      <CheckCheck size={14} strokeWidth={2.6} aria-hidden="true" />
    </span>
  );
}
