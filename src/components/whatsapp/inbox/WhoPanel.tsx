"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Link2, Loader2, MessageSquareQuote, Package, Plus, Search } from "lucide-react";
import type { ThreadConversation, ThreadPayload } from "@/lib/whatsapp/thread";
import { createFeedback } from "@/hooks/useFeedback";
import { localDigits } from "./inbox-utils";

interface OrderHit {
  id: string;
  external_id: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  status: string;
  created_at?: string;
}
interface LeadHit {
  id: string;
  customer_name: string | null;
  customer_phone: string | null;
  customer_city: string | null;
  campaign_name?: string | null;
}
interface SearchPayload {
  orders: OrderHit[];
  leads: LeadHit[];
}

async function claimSearch(marketId: string, q: string): Promise<SearchPayload | null> {
  const res = await fetch(`/api/whatsapp/claim-search?market_id=${marketId}&q=${encodeURIComponent(q)}`);
  const body = (await res.json().catch(() => ({}))) as { data?: SearchPayload };
  return body.data ?? null;
}

const refOf = (o: OrderHit) => (o.external_id ? `#${o.external_id}` : `#${o.id.slice(0, 8)}`);

/**
 * « Qui est-ce ? » — the right column (prototype `inbox()`, `W`). It looks the
 * number up among the market's live orders (GET /api/whatsapp/claim-search,
 * by the number's digits) and proposes the order: « Confier à la commande »
 * is the existing claim, after which the agent who follows the order has the
 * thread. No order: « Créer un prospect » (POST /api/leads, then the claim).
 * Another order is a search away. At the bottom, « Garder dans Voix du
 * client » keeps the customer's last message as a suggestion.
 */
export function WhoPanel({
  conversation,
  thread,
  marketId,
  isSuperAdmin,
  kept,
  attachedRef,
  onClaimed,
  onKept,
  onOpenOrder,
  onOpenLead,
}: {
  conversation: ThreadConversation;
  thread: ThreadPayload | null;
  marketId: string;
  isSuperAdmin: boolean;
  kept: boolean;
  /** « #50001 » once handed over to an order from this page, "" to a prospect; null otherwise. */
  attachedRef: string | null;
  onClaimed: (ref: string) => void;
  onKept: () => void;
  onOpenOrder: (orderId: string) => void;
  onOpenLead: (leadId: string) => void;
}) {
  const t = useTranslations("whatsappAdmin.inbox.who");
  const tStatus = useTranslations("orders.statuses");
  const locale = useLocale();
  const anchoredOrder = conversation.current_order_id;
  const anchoredLead = conversation.current_lead_id;
  const anchored = Boolean(anchoredOrder || anchoredLead);

  const [match, setMatch] = useState<OrderHit | null>(null);
  const [looked, setLooked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [keeping, setKeeping] = useState(false);

  // The order placed with this number, if any.
  useEffect(() => {
    let cancelled = false;
    setLooked(false);
    setMatch(null);
    const digits = localDigits(conversation.phone_e164);
    void claimSearch(marketId, digits)
      .then((data) => {
        if (cancelled) return;
        setMatch(data?.orders?.[0] ?? null);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLooked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversation.phone_e164, marketId]);

  const claim = useCallback(
    async (target: { order_id: string } | { lead_id: string }, ref: string) => {
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/whatsapp/conversations/${conversation.id}/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(target),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body?.error === "already_anchored" ? t("alreadyAnchored") : (body?.message ?? t("claimRefused")));
          return;
        }
        onClaimed(ref);
      } finally {
        setBusy(false);
      }
    },
    [conversation.id, onClaimed, t],
  );

  const createAndClaim = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ market_id: marketId, customer_name: conversation.profile_name ?? conversation.phone_e164, customer_phone: conversation.phone_e164, source: "whatsapp" }),
      });
      const body = await res.json().catch(() => ({}));
      const leadId: string | undefined = body?.data?.id ?? body?.id;
      if (!res.ok || !leadId) {
        setError(body?.error ?? t("leadRefused"));
        setBusy(false);
        return;
      }
      await claim({ lead_id: leadId }, "");
    } catch {
      setError(t("leadRefused"));
      setBusy(false);
    }
  }, [marketId, conversation, claim, t]);

  const lastInbound = [...(thread?.messages ?? [])].reverse().find((m) => m.direction === "in" && (m.body ?? m.media_caption ?? "").trim());
  const keepText = (lastInbound?.body ?? lastInbound?.media_caption ?? "").trim();
  const keep = useCallback(async () => {
    if (!keepText) return;
    setKeeping(true);
    setError(null);
    try {
      await createFeedback({
        category: "suggestion",
        body: keepText,
        topic_id: null,
        order_id: anchoredOrder ?? match?.id ?? null,
        source: "whatsapp",
        ...(isSuperAdmin ? { market_id: marketId } : {}),
      });
      onKept();
    } catch {
      setError(t("keepRefused"));
    } finally {
      setKeeping(false);
    }
  }, [keepText, anchoredOrder, match, isSuperAdmin, marketId, onKept, t]);

  const dateFmt = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", { day: "numeric", month: "short" });

  return (
    <section className="card col who-col" data-testid="inbox-who">
      <div className="who-p">
        <h3>{t("title")}</h3>

        {anchored ? (
          <div className="done-box">
            <Check className="ic" strokeWidth={2.2} aria-hidden />
            <span>
              {attachedRef ? t("attached", { ref: attachedRef }) : attachedRef === "" ? t("attachedLead") : anchoredOrder ? t("anchoredOrder") : t("anchoredLead")}
              {anchoredOrder && (
                <button type="button" className="lnk" onClick={() => onOpenOrder(anchoredOrder)}>
                  {t("openOrder")}
                </button>
              )}
              {!anchoredOrder && anchoredLead && (
                <button type="button" className="lnk" onClick={() => onOpenLead(anchoredLead)}>
                  {t("openLead")}
                </button>
              )}
            </span>
          </div>
        ) : !looked ? (
          <p className="hintp">{t("looking")}</p>
        ) : match ? (
          <>
            <p className="hintp">{t("ordered")}</p>
            <div className="match">
              <div className="mt">
                <span className="mthumb">
                  <Package className="ic" strokeWidth={1.9} aria-hidden />
                </span>
                <div style={{ minWidth: 0 }}>
                  <b dir="ltr">{refOf(match)}</b>
                  <small>{[match.customer_name ?? t("noName"), match.customer_city].filter(Boolean).join(" · ")}</small>
                </div>
              </div>
              <div className="ms">
                <span className="ospill">{tStatus(match.status)}</span>
                {match.created_at && <span>· {dateFmt.format(new Date(match.created_at))}</span>}
              </div>
              <button type="button" className="btn pri" disabled={busy} onClick={() => void claim({ order_id: match.id }, refOf(match))}>
                {busy ? <Loader2 className="ic animate-spin" strokeWidth={1.9} aria-hidden /> : <Link2 className="ic" strokeWidth={1.9} aria-hidden />}
                {t("attachTo", { ref: refOf(match) })}
              </button>
              <p className="hintp" style={{ marginTop: 8 }}>
                {t("attachHint")}
              </p>
            </div>
          </>
        ) : (
          <>
            <p className="hintp">{t("never")}</p>
            <button type="button" className="btn sec wide" disabled={busy} onClick={() => void createAndClaim()}>
              {busy ? <Loader2 className="ic animate-spin" strokeWidth={1.9} aria-hidden /> : <Plus className="ic" strokeWidth={1.9} aria-hidden />}
              {t("createLead")}
            </button>
            <p className="hintp">{t("leadHint")}</p>
          </>
        )}

        {!anchored && <OtherSearch marketId={marketId} busy={busy} onPick={(target, ref) => void claim(target, ref)} />}

        {error && (
          <p role="alert" className="err">
            {error}
          </p>
        )}

        <div className="sep">
          {kept ? (
            <div className="done-box">
              <MessageSquareQuote className="ic" strokeWidth={2} aria-hidden />
              <span>{t("kept")}</span>
            </div>
          ) : (
            <>
              <button type="button" className="btn sec wide" disabled={!keepText || keeping} onClick={() => void keep()}>
                {keeping ? <Loader2 className="ic animate-spin" strokeWidth={1.9} aria-hidden /> : <MessageSquareQuote className="ic" strokeWidth={1.9} aria-hidden />}
                {t("keep")}
              </button>
              <p className="hintp" style={{ marginTop: 8 }}>
                {t("keepHint")}
              </p>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/** « Chercher une autre commande… » — orders and prospects by name, number or reference. */
function OtherSearch({ marketId, busy, onPick }: { marketId: string; busy: boolean; onPick: (target: { order_id: string } | { lead_id: string }, ref: string) => void }) {
  const t = useTranslations("whatsappAdmin.inbox.who");
  const tStatus = useTranslations("orders.statuses");
  const [q, setQ] = useState("");
  const [data, setData] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setData(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      setLoading(true);
      void claimSearch(marketId, query)
        .then((d) => {
          if (!cancelled) setData(d);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, marketId]);

  const hits = data ? [...(data.orders ?? []).map((o) => ({ kind: "order" as const, o })), ...(data.leads ?? []).map((l) => ({ kind: "lead" as const, l }))] : [];
  return (
    <>
      <label className="search" style={{ marginTop: 2 }}>
        <Search className="ic" strokeWidth={1.9} aria-hidden />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("other")} aria-label={t("other")} dir="auto" />
      </label>
      {loading && hits.length === 0 && <p className="hintp">{t("searching")}</p>}
      {!loading && data && hits.length === 0 && <p className="hintp">{t("none")}</p>}
      {hits.length > 0 && (
        <div className="results">
          {hits.map((h) =>
            h.kind === "order" ? (
              <button key={`o-${h.o.id}`} type="button" disabled={busy} onClick={() => onPick({ order_id: h.o.id }, refOf(h.o))}>
                <span className="tag">{t("order")}</span>
                <span style={{ minWidth: 0 }}>
                  <b>{[refOf(h.o), h.o.customer_name ?? t("noName"), h.o.customer_city].filter(Boolean).join(" · ")}</b>
                  <small>{[tStatus(h.o.status), h.o.customer_phone].filter(Boolean).join(" · ")}</small>
                </span>
              </button>
            ) : (
              <button key={`l-${h.l.id}`} type="button" disabled={busy} onClick={() => onPick({ lead_id: h.l.id }, "")}>
                <span className="tag">{t("lead")}</span>
                <span style={{ minWidth: 0 }}>
                  <b>{[h.l.customer_name ?? t("noName"), h.l.customer_city].filter(Boolean).join(" · ")}</b>
                  <small>{h.l.campaign_name ?? h.l.customer_phone ?? ""}</small>
                </span>
              </button>
            ),
          )}
        </div>
      )}
    </>
  );
}
