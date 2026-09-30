"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Plus, Search } from "lucide-react";

export interface ClaimTarget {
  kind: "order" | "lead";
  id: string;
  title: string;
  sub: string;
}

interface SearchPayload {
  orders: { id: string; external_id: string | null; customer_name: string | null; customer_phone: string | null; customer_city: string | null; status: string }[];
  leads: { id: string; customer_name: string | null; customer_phone: string | null; customer_city: string | null; status: string; campaign_name?: string | null }[];
}

/**
 * « Rattacher à » — prototype `messages`. Before anything is typed the list
 * already shows the market's most recent live orders and open prospects (a
 * fresh conversation usually belongs to a fresh order); typing a name, a
 * number or a reference narrows it. Five of each at most: this is matching
 * one thread, not browsing. An order says its status in words, a prospect
 * names its campaign.
 */
export function ClaimSearch({
  marketId,
  onPick,
  onCreateLead,
  busy,
  creatingLead,
}: {
  marketId: string;
  onPick: (target: ClaimTarget) => void;
  onCreateLead: () => void;
  busy: boolean;
  creatingLead: boolean;
}) {
  const t = useTranslations("whatsappAdmin.inbox.attach");
  const tStatus = useTranslations("orders.statuses");
  const [q, setQ] = useState("");
  const [payload, setPayload] = useState<SearchPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);

  useEffect(() => {
    const query = q.trim();
    // Under two characters the server answers with the recent list, so an
    // empty box and a single letter both show it.
    const effective = query.length >= 2 ? query : "";
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/whatsapp/claim-search?market_id=${marketId}&q=${encodeURIComponent(effective)}`);
        const body = (await res.json().catch(() => ({}))) as { data?: SearchPayload };
        if (cancelled || !body.data) return;
        setPayload(body.data);
        setSearched(effective !== "");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    const timer = setTimeout(run, effective ? 250 : 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [q, marketId]);

  // Worded at render time, so the fetch never depends on the translator.
  const results: ClaimTarget[] = payload
    ? [
        ...(payload.orders ?? []).map((o) => ({
          kind: "order" as const,
          id: o.id,
          title: [o.external_id ? `#${o.external_id}` : null, o.customer_name ?? t("noName"), o.customer_city].filter(Boolean).join(" · "),
          sub: [t("order"), tStatus(o.status), o.customer_phone].filter(Boolean).join(" · "),
        })),
        ...(payload.leads ?? []).map((l) => ({
          kind: "lead" as const,
          id: l.id,
          title: [l.customer_name ?? t("noName"), l.customer_city].filter(Boolean).join(" · "),
          sub: [t("lead"), l.campaign_name ?? l.customer_phone].filter(Boolean).join(" · "),
        })),
      ]
    : [];

  return (
    <div className="border-t border-line-subtle px-3.5 py-3">
      <label htmlFor="wa-claim-search" className="mb-1 block text-[12px] font-medium text-ink-secondary">
        {t("label")}
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search size={14} className="pointer-events-none absolute start-2.5 top-2.5 text-ink-secondary" aria-hidden="true" />
          <input
            id="wa-claim-search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("placeholder")}
            dir="auto"
            className="h-9 w-full rounded-[6px] border border-line bg-surface-card pe-2.5 ps-8 text-[13px] text-ink-primary"
          />
        </div>
        <button
          type="button"
          onClick={onCreateLead}
          disabled={busy || creatingLead}
          className="inline-flex h-9 items-center gap-1.5 rounded-[6px] border border-line-strong bg-surface-card px-3 text-[13px] font-medium text-ink-primary hover:bg-surface-hover disabled:opacity-50"
        >
          {creatingLead ? <Loader2 size={14} className="animate-spin" aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {t("createLead")}
        </button>
      </div>
      {loading && results.length === 0 && <p className="m-0 mt-2 text-[12.5px] text-ink-secondary">{t("searching")}</p>}
      {!loading && searched && results.length === 0 && <p className="m-0 mt-2 text-[12.5px] text-ink-secondary">{t("none")}</p>}
      {results.length > 0 && (
        <ul className="m-0 mt-1.5 list-none divide-y divide-line-subtle overflow-hidden rounded-[8px] border border-line p-0">
          {results.map((r) => (
            <li key={`${r.kind}-${r.id}`}>
              <button
                type="button"
                disabled={busy}
                onClick={() => onPick(r)}
                className="grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2.5 bg-surface-card px-3 py-[9px] text-start text-[13px] hover:bg-surface-hover disabled:opacity-50"
              >
                <span className="rounded-pill bg-status-neutralBg px-2 py-0.5 text-[12px] font-semibold text-ink-primary">{r.kind === "order" ? t("order") : t("lead")}</span>
                <span className="min-w-0">
                  <span className="block truncate font-medium text-ink-primary [unicode-bidi:plaintext]">{r.title}</span>
                  <span className="block truncate text-[12px] text-ink-secondary">{r.sub}</span>
                </span>
                <span className="text-[12.5px] font-semibold text-status-action">{t("action")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
