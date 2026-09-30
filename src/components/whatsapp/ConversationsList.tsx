"use client";

import { useTranslations } from "next-intl";
import { User } from "lucide-react";
import type { InboxConversation } from "@/hooks/useOrphanConversations";

/**
 * The inbox list — prototype whatsapp-manager-v1.html?screen=messages. Two
 * tabs, each with its count in a grey pill (« À rattacher 3 · Toutes 27 »),
 * then one row per conversation: who (profile name, or the number), the last
 * message, how long ago, and the unread count.
 */
export function ConversationsList({
  conversations,
  selectedId,
  onSelect,
  scope,
  onScope,
  counts,
  isLoading,
}: {
  conversations: InboxConversation[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  scope: "orphans" | "all";
  onScope: (s: "orphans" | "all") => void;
  /** Both tabs' sizes (GET /api/whatsapp/conversations → counts); null while unknown. */
  counts: { orphans: number; all: number } | null;
  isLoading: boolean;
}) {
  const t = useTranslations("whatsappAdmin.inbox");
  const tCommon = useTranslations("whatsappAdmin.common");
  const ago = (iso: string | null) => {
    if (!iso) return "";
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
    if (m < 1) return tCommon("ago.now");
    if (m < 60) return tCommon("ago.m", { n: m });
    const h = Math.round(m / 60);
    if (h < 48) return tCommon("ago.h", { n: h });
    return tCommon("ago.d", { n: Math.round(h / 24) });
  };
  const phone = (e164: string) => e164.replace(/^(216|218)/, "+$1 ");

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border border-line-subtle bg-surface-card">
      <div role="tablist" className="flex gap-0.5 border-b border-line">
        {(["orphans", "all"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={scope === s}
            onClick={() => onScope(s)}
            className={`-mb-px flex items-center whitespace-nowrap border-b-2 px-3.5 py-[9px] text-[14px] ${
              scope === s ? "border-brand font-semibold text-ink-primary" : "border-transparent font-medium text-ink-secondary hover:text-ink-primary"
            }`}
          >
            {t(`tabs.${s}`)}
            {counts && (
              <b className="ms-1.5 rounded-pill bg-status-neutralBg px-[7px] py-px text-[11.5px] font-semibold tabular-nums text-ink-secondary">{counts[s]}</b>
            )}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {isLoading && <p className="px-4 py-8 text-center text-[13px] text-ink-secondary">{tCommon("loading")}</p>}
        {!isLoading && conversations.length === 0 && <p className="px-4 py-10 text-center text-[13px] text-ink-secondary">{t(`empty.${scope}`)}</p>}
        {conversations.map((c) => {
          const name = c.profile_name?.trim() || null;
          return (
            <button
              key={c.id}
              type="button"
              aria-selected={c.id === selectedId}
              onClick={() => onSelect(c.id)}
              className={`grid w-full grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-3 border-b border-line-subtle px-3.5 py-3 text-start last:border-0 ${
                c.id === selectedId ? "bg-brand-bg" : "hover:bg-surface-hover"
              }`}
            >
              <span className="grid h-10 w-10 place-items-center rounded-full bg-status-neutralBg text-[14px] font-bold text-ink-secondary">
                {name ? name[0].toUpperCase() : <User size={16} aria-hidden="true" />}
              </span>
              <span className="min-w-0">
                <span className="flex items-baseline gap-2">
                  <span className="truncate text-[14px] font-semibold text-ink-primary" dir="auto">
                    {name ?? (
                      <span dir="ltr" className="tabular-nums">
                        {phone(c.phone_e164)}
                      </span>
                    )}
                  </span>
                  {name && (
                    <span dir="ltr" className="shrink-0 text-[12.5px] tabular-nums text-ink-secondary">
                      {phone(c.phone_e164)}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-[13px] text-ink-secondary [unicode-bidi:plaintext]" dir="auto">
                  {c.last_message_preview ?? "—"}
                </span>
              </span>
              <span className="flex flex-col items-end gap-[5px] text-[12px] text-ink-secondary">
                <span>{ago(c.last_message_at)}</span>
                {c.unread_count > 0 && (
                  <b className="grid h-5 min-w-[20px] place-items-center rounded-pill bg-brand px-1.5 text-[11.5px] tabular-nums text-white">{c.unread_count}</b>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
