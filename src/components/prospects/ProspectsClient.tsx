"use client";

/**
 * Data side of « Prospects »: the worklist, the day's tally, and the optimistic
 * write with its undo window. Everything visual is ProspectsView.
 *
 * Unlike delivery actions, a prospect outcome is a plain UPDATE on `leads`, so
 * an undo could be written as a second update. It still waits out the window
 * instead: `lead_history` is the prospect's audit trail, and an undo that
 * appended a reversal would leave it saying "called, then un-called".
 */
import { useCallback, useEffect, useRef, useState } from "react";
import useSWR from "swr";
import { useRouter } from "next/navigation";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { marketIdToCode, marketTimezone } from "@/lib/markets";
import { applyOutcome, type Bucket } from "@/lib/prospects/worklist";
import type { ProspectRow, ProspectsResponse } from "@/lib/prospects/types";
import type { OutcomeDraft } from "./OutcomeSheet";
import { ProspectsView } from "./ProspectsView";
import type { Role } from "@/types";

/** How long "Annuler" stays real before the write leaves. */
const UNDO_WINDOW_MS = 5_000;

interface Pending {
  row: ProspectRow;
  draft: OutcomeDraft;
  before: ProspectRow;
}

export function ProspectsClient({
  role, viewerId, marketId, locale,
}: { role: Role; viewerId: string; marketId: string | null; locale: string }) {
  const router = useRouter();
  const scope = useMarketScope();
  const market = role === "super_admin" ? scope.marketId : marketId;

  const params = new URLSearchParams({
    ...(role === "super_admin" && market ? { market_id: market } : {}),
    locale,
  }).toString();
  const key = market ? `/api/prospects/worklist?${params}` : null;

  const { data, error, mutate } = useSWR<ProspectsResponse>(key, fetcher, {
    refreshInterval: 60_000,
    revalidateOnFocus: true,
    keepPreviousData: true,
  });

  const [notice, setNotice] = useState<{ bucket: Bucket } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const pendingRef = useRef<Pending | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A minute's resolution is enough: every duration on the page is relative.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const replaceRow = useCallback((id: string, next: ProspectRow) => {
    if (!key) return;
    void mutate(
      (cur) => (cur ? { ...cur, rows: cur.rows.map((r) => (r.id === id ? next : r)) } : cur),
      { revalidate: false },
    );
  }, [key, mutate]);

  const send = useCallback(async (p: Pending) => {
    try {
      const res = await fetch(`/api/prospects/${p.row.id}/outcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(p.draft),
        keepalive: true,
      });
      if (!res.ok) throw new Error(String(res.status));
    } catch {
      replaceRow(p.row.id, p.before);
      setNotice(null);
    } finally {
      void mutate();
    }
  }, [mutate, replaceRow]);

  const flush = useCallback(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const p = pendingRef.current;
    pendingRef.current = null;
    setPending(null);
    if (p) void send(p);
  }, [send]);

  const queue = useCallback((row: ProspectRow, draft: OutcomeDraft) => {
    flush(); // a second outcome sends the first at once
    const outcome =
      draft.kind === "callback"
        ? { kind: "callback" as const, at: draft.at }
        : draft.kind === "lost"
          ? { kind: "lost" as const, reason: draft.reason }
          : { kind: "no_answer" as const };
    const next = applyOutcome(row, outcome, Date.now());

    const p: Pending = { row, draft, before: row };
    replaceRow(row.id, next);
    pendingRef.current = p;
    setPending(p);
    setNotice({ bucket: next.bucket });
    timer.current = setTimeout(() => {
      timer.current = null;
      pendingRef.current = null;
      setPending(null);
      void send(p);
    }, UNDO_WINDOW_MS);
  }, [flush, replaceRow, send]);

  const undo = useCallback(() => {
    const p = pendingRef.current;
    if (!p) return;
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    pendingRef.current = null;
    setPending(null);
    setNotice(null);
    replaceRow(p.row.id, p.before); // the POST never happened
  }, [replaceRow]);

  // Leaving the page, or hiding the tab, sends whatever is still waiting.
  useEffect(() => {
    const onLeave = () => flush();
    window.addEventListener("pagehide", onLeave);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flush();
    });
    return () => {
      window.removeEventListener("pagehide", onLeave);
      flush();
    };
  }, [flush]);

  const rows = data?.rows ?? null;
  const stats = {
    calls: rows?.filter((r) => r.bucket === "retry" || r.bucket === "callback").length ?? 0,
    converted: rows?.filter((r) => r.bucket === "converted").length ?? 0,
  };

  return (
    <ProspectsView
      rows={rows}
      error={Boolean(error)}
      isLoading={!data && !error}
      onRetry={() => void mutate()}
      role={role}
      marketCode={market ? (marketIdToCode(market) ?? "tn") : null}
      tz={market ? marketTimezone(market) : "Africa/Tripoli"}
      locale={locale}
      now={now}
      hotWindowMinutes={data?.hot_window_minutes ?? 60}
      stats={stats}
      pending={pending ? { id: pending.row.id } : null}
      notice={notice}
      onQueue={queue}
      onUndo={undo}
      onDismissNotice={() => setNotice(null)}
      onConvert={(row) => router.push(`/${locale}/leads/${row.id}`)}
      onNewLead={() => router.push(`/${locale}/leads?new=1`)}
    />
  );
}
