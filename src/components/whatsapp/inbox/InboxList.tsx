"use client";

import { useTranslations } from "next-intl";
import { Check, Clock, MessageSquareQuote, Search, User } from "lucide-react";
import type { InboxConversation } from "@/hooks/useOrphanConversations";
import { formatPhone, isWaiting, minutesSince, windowClosed, type InboxTab } from "./inbox-utils";

/**
 * The list column (prototype `inbox()`, `L`): the search, « À confier · Non
 * lus · Toutes » with their counts, then one row per conversation — who, the
 * last message, what is known about it (handed over, kept, window closed), and
 * how long the customer has been waiting.
 */
export function InboxList({
  rows,
  tab,
  onTab,
  counts,
  query,
  onQuery,
  selectedId,
  onSelect,
  kept,
  isLoading,
}: {
  rows: InboxConversation[];
  tab: InboxTab;
  onTab: (t: InboxTab) => void;
  counts: Record<InboxTab, number>;
  query: string;
  onQuery: (q: string) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
  kept: Set<string>;
  isLoading: boolean;
}) {
  const t = useTranslations("whatsappAdmin.inbox");
  const tCommon = useTranslations("whatsappAdmin.common");
  const dur = (min: number) => (min < 60 ? t("dur.m", { n: min }) : min < 48 * 60 ? t("dur.h", { n: Math.round(min / 60) }) : t("dur.d", { n: Math.round(min / 1440) }));
  const ago = (min: number) =>
    min < 1 ? tCommon("ago.now") : min < 60 ? tCommon("ago.m", { n: min }) : min < 48 * 60 ? tCommon("ago.h", { n: Math.round(min / 60) }) : tCommon("ago.d", { n: Math.round(min / 1440) });

  return (
    <section className="card col">
      <div className="lhead">
        <label className="search">
          <Search className="ic" strokeWidth={1.9} aria-hidden />
          <input value={query} onChange={(e) => onQuery(e.target.value)} placeholder={t("search")} aria-label={t("search")} dir="auto" />
        </label>
        <div className="ltabs" role="tablist">
          {(["orphans", "unread", "all"] as const).map((k) => (
            <button key={k} type="button" role="tab" aria-selected={tab === k} className={`vw ${tab === k ? "on" : ""}`} onClick={() => onTab(k)}>
              {t(`tabs.${k}`)}
              <span className="n num">{counts[k]}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="list" data-testid="inbox-list">
        {isLoading && rows.length === 0 && <p className="empty">{tCommon("loading")}</p>}
        {!isLoading && rows.length === 0 && <p className="empty">{query.trim() ? t("empty.search") : t(`empty.${tab}`)}</p>}
        {rows.map((c) => {
          const name = c.profile_name?.trim() || null;
          const waiting = isWaiting(c);
          const since = minutesSince(waiting ? c.last_inbound_at : c.last_message_at);
          const anchored = Boolean(c.current_order_id || c.current_lead_id);
          return (
            <button key={c.id} type="button" data-testid="cv" className={`cv ${c.id === selectedId ? "on" : ""}`} aria-current={c.id === selectedId || undefined} onClick={() => onSelect(c.id)}>
              <span className="cav">{name ? name[0].toUpperCase() : <User className="ic" strokeWidth={1.9} aria-hidden />}</span>
              <span style={{ minWidth: 0 }}>
                <span className="nm">
                  <span data-testid="cv-name" dir={name ? "auto" : "ltr"}>
                    {name ?? formatPhone(c.phone_e164)}
                  </span>
                </span>
                <span className="pv" dir="auto">
                  {c.last_message_preview ?? "—"}
                </span>
                {(anchored || kept.has(c.id) || windowClosed(c)) && (
                  <span className="hint">
                    {anchored && (
                      <span className="tag good">
                        <Check className="ic" strokeWidth={2.2} aria-hidden />
                        {t("tagAttached")}
                      </span>
                    )}
                    {kept.has(c.id) && (
                      <span className="tag good">
                        <MessageSquareQuote className="ic" strokeWidth={2} aria-hidden />
                        {t("tagKept")}
                      </span>
                    )}
                    {windowClosed(c) && (
                      <span className="tag">
                        <Clock className="ic" strokeWidth={2} aria-hidden />
                        {t("tagWindowClosed")}
                      </span>
                    )}
                  </span>
                )}
              </span>
              <span className="end">
                {since !== null && <span className={c.unread_count > 0 ? "wait" : undefined}>{waiting ? t("waits", { t: dur(since) }) : ago(since)}</span>}
                {c.unread_count > 0 && <span className="ub num">{c.unread_count}</span>}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
