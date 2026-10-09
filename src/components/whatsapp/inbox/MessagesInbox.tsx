"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { fetcher } from "@/lib/swr-config";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import type { InboxConversation } from "@/hooks/useOrphanConversations";
import { useWhatsAppTemplates } from "@/hooks/useWhatsAppTemplates";
import { InboxList } from "./InboxList";
import { InboxThread } from "./InboxThread";
import { WhoPanel } from "./WhoPanel";
import { inboxRows, type InboxTab } from "./inbox-utils";

/**
 * The connected inbox (prototype `inbox()`): 340 px list · the thread · the
 * 300 px « Qui est-ce ? » panel. Every conversation of the market is loaded
 * once; the tabs, the counts of « Non lus » and the search are cut from it.
 * Opening a conversation marks it read.
 */
export function MessagesInbox({
  marketId,
  marketCode,
  locale,
  isSuperAdmin,
  conversations,
  counts,
  isLoading,
  onChanged,
}: {
  marketId: string;
  marketCode: "ly" | "tn";
  locale: string;
  isSuperAdmin: boolean;
  conversations: InboxConversation[];
  /** Server counts (exact) for « À confier » and « Toutes ». */
  counts: { orphans: number; all: number } | null;
  isLoading: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("whatsappAdmin.inbox");
  const router = useRouter();
  const [tab, setTab] = useState<InboxTab>("orphans");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [kept, setKept] = useState<Set<string>>(() => new Set());
  const [attached, setAttached] = useState<Record<string, string>>({});

  const rows = useMemo(() => inboxRows(conversations, tab, query), [conversations, tab, query]);
  const tabCounts = useMemo(
    () => ({
      orphans: counts?.orphans ?? inboxRows(conversations, "orphans", "").length,
      unread: conversations.filter((c) => c.unread_count > 0).length,
      all: counts?.all ?? conversations.length,
    }),
    [conversations, counts],
  );

  // The prototype opens on the first conversation of the list.
  const currentId = selectedId ?? rows[0]?.id ?? null;
  const row = conversations.find((c) => c.id === currentId) ?? null;

  const { data, mutate } = useSWR<{ data: ThreadPayload }>(currentId ? `/api/whatsapp/conversations/${currentId}` : null, fetcher, { revalidateOnFocus: false });
  const thread = data?.data && data.data.conversation?.id === currentId ? data.data : null;
  const { templates } = useWhatsAppTemplates(marketId);

  // Reading clears the unread count and the owner's bell row.
  const unread = row?.unread_count ?? 0;
  useEffect(() => {
    if (!currentId || unread === 0) return;
    void fetch(`/api/whatsapp/conversations/${currentId}/read`, { method: "POST" }).then(() => {
      void mutate();
      onChanged();
    });
  }, [currentId, unread, mutate, onChanged]);

  const refresh = useCallback(() => {
    void mutate();
    onChanged();
  }, [mutate, onChanged]);

  return (
    <div className="inbox">
      <InboxList
        rows={rows}
        tab={tab}
        onTab={setTab}
        counts={tabCounts}
        query={query}
        onQuery={setQuery}
        selectedId={currentId}
        onSelect={setSelectedId}
        kept={kept}
        isLoading={isLoading}
      />
      {currentId && row ? (
        <>
          <InboxThread
            conversationId={currentId}
            fallbackName={row.profile_name?.trim() || null}
            fallbackPhone={row.phone_e164}
            thread={thread}
            templates={templates}
            marketCode={marketCode}
            onThreadChanged={refresh}
          />
          <WhoPanel
            key={currentId}
            conversation={thread?.conversation ?? row}
            thread={thread}
            marketId={marketId}
            isSuperAdmin={isSuperAdmin}
            kept={kept.has(currentId)}
            attachedRef={attached[currentId] ?? null}
            onClaimed={(ref) => {
              // Stay on it: once handed over it leaves « À confier ».
              setSelectedId(currentId);
              setAttached((a) => ({ ...a, [currentId]: ref }));
              refresh();
            }}
            onKept={() => setKept((s) => new Set(s).add(currentId))}
            onOpenOrder={(id) => router.push(`/${locale}/orders?open=${id}`)}
            onOpenLead={(id) => router.push(`/${locale}/leads/${id}`)}
          />
        </>
      ) : (
        <section className="card col" style={{ gridColumn: "span 2", display: "grid", placeItems: "center" }}>
          <p className="empty">{t("pick")}</p>
        </section>
      )}
    </div>
  );
}
