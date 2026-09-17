"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { CopyCheck, Trash2, X, AlertTriangle, ExternalLink } from "lucide-react";
import { fetcher } from "@/lib/swr-config";
import { useMarketScope } from "@/context/market-scope";
import { Sheet } from "@/components/ui/Sheet";
import { Button } from "@/components/ui/Button";
import { DuplicateGroupCard } from "./DuplicateGroupCard";
import {
  deriveGroupSelection,
  type DuplicateGroup,
} from "@/lib/duplicate-orders/groups";
import type { Role } from "@/types";

interface Props {
  role: Role;
  locale: string;
  userMarketId: string;
  initialMarketId: string;
  currencyCode: string;
}

interface GroupsResponse {
  data: {
    groups: DuplicateGroup[];
    window_hours: number;
    autoselect_window_hours: number;
  };
}

interface BulkResult {
  succeeded: { order_id: string }[];
  failed: { order_id: string; reason: string; error: string }[];
}

type Filter = "all" | "high";

/**
 * The duplicate review screen.
 *
 * Ordra has detected duplicates for a long time — a badge, a popover, a guard
 * at dispatch. What it never had was a place to ACT on them in bulk, so every
 * duplicate was opened and deleted by hand. In the production data, 694 of the
 * 868 already-deleted orders sat on a repeat phone: two thirds of that manual
 * work was deleting what the system had already flagged.
 *
 * Nothing here deletes on its own. High-confidence groups arrive pre-ticked so
 * the common case is one click, and everything else waits for a human.
 */
export function DuplicatesPageClient({
  role,
  locale,
  userMarketId,
  initialMarketId,
  currencyCode,
}: Props) {
  const t = useTranslations("duplicateOrder.review");
  const { marketId: scopedMarketId } = useMarketScope();
  const marketId = scopedMarketId || initialMarketId || userMarketId;

  // Agents see the screen to spot a duplicate before they call; deleting is a
  // manager's call. The API enforces this independently — see the bulk route.
  const readOnly = role !== "super_admin" && role !== "market_manager";

  const key = marketId ? `/api/orders/duplicates?market_id=${marketId}` : null;
  const { data, error, isLoading, mutate } = useSWR<GroupsResponse>(key, fetcher, {
    revalidateOnFocus: false,
  });

  const groups = useMemo(() => data?.data.groups ?? [], [data]);
  const autoselectHours = data?.data.autoselect_window_hours ?? 1;
  const windowHours = data?.data.window_hours ?? 24;

  const [filter, setFilter] = useState<Filter>("all");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<BulkResult | null>(null);

  // Seed the selection from the confidence tier whenever a fresh list lands.
  // Managers can untick; the point is that the safe default is already made.
  useEffect(() => {
    if (readOnly || groups.length === 0) return;
    const next = new Set<string>();
    for (const g of groups) {
      for (const id of deriveGroupSelection(g.members, g.confidence)) next.add(id);
    }
    setSelected(next);
  }, [groups, readOnly]);

  const visible = useMemo(
    () => (filter === "high" ? groups.filter((g) => g.confidence === "high") : groups),
    [groups, filter],
  );

  const toggle = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  /** Each selected duplicate is paired with the anchor it belongs to — the
   *  server re-derives the relationship, but it needs to know which group. */
  const pairs = useMemo(() => {
    const out: { anchor_id: string; sibling_id: string }[] = [];
    for (const g of groups) {
      const anchor = g.members.find((m) => m.is_anchor);
      if (!anchor) continue;
      for (const m of g.members) {
        if (m.id !== anchor.id && selected.has(m.id)) {
          out.push({ anchor_id: anchor.id, sibling_id: m.id });
        }
      }
    }
    return out;
  }, [groups, selected]);

  const runDelete = useCallback(async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/orders/bulk-delete-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pairs }),
      });
      const json = await res.json();
      setConfirming(false);
      if (res.ok) {
        setResult(json.data as BulkResult);
        setSelected(new Set());
        await mutate();
      } else {
        setResult({
          succeeded: [],
          failed: pairs.map((p) => ({
            order_id: p.sibling_id,
            reason: json?.code === "locked" ? "order_locked" : "internal_error",
            error: json?.error ?? "",
          })),
        });
      }
    } finally {
      setBusy(false);
    }
  }, [pairs, mutate]);

  const reasonLabel = (reason: string) => {
    switch (reason) {
      case "not_a_duplicate_sibling":
        return t("reasonNotSibling");
      case "status_not_deletable":
        return t("reasonStatus");
      case "not_permitted":
      case "anchor_not_visible":
      case "cross_market_sibling":
        return t("reasonForbidden");
      case "order_locked":
        return t("reasonLocked");
      default:
        return t("reasonInternal");
    }
  };

  return (
    <div className="mx-auto max-w-[1200px] px-6 pb-24 pt-5">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-[20px] font-semibold text-oms-ink-1">
          <CopyCheck size={18} strokeWidth={2.25} aria-hidden="true" />
          {t("title")}
        </h1>
        <p className="mt-1 text-[13px] text-oms-ink-2">{t("subtitle")}</p>
        <p className="mt-0.5 text-[12px] tabular-nums text-oms-ink-3">
          {t("scopeNote", { hours: windowHours })}
        </p>
        {readOnly && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-oms-sunken px-2.5 py-1 text-[12px] font-medium text-oms-ink-2">
            {t("readOnly")}
          </p>
        )}
      </header>

      {/* Confidence filter. Two states only: everything, or just what is safe
          enough to have been pre-ticked. */}
      <div
        role="group"
        aria-label={t("title")}
        className="mb-4 inline-flex items-center gap-1 rounded-lg border border-oms-border bg-oms-surface p-1"
      >
        {(["all", "high"] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={[
              "rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors",
              filter === f
                ? "bg-brand-bg text-brand"
                : "text-oms-ink-2 hover:text-oms-ink-1",
            ].join(" ")}
          >
            {f === "all" ? t("confidenceAll") : t("confidenceHigh")}
          </button>
        ))}
      </div>

      {filter === "high" && (
        <p className="mb-3 text-[12px] text-oms-ink-3">
          {t("confidenceHighHint", { hours: autoselectHours })}
        </p>
      )}

      {error && (
        <p className="rounded-lg bg-oms-bad-bg px-3 py-2 text-[13px] text-oms-bad">
          {t("loadError")}
        </p>
      )}

      {!error && isLoading && (
        <div className="space-y-3">
          {[0, 1].map((i) => (
            <div key={i} className="h-40 animate-pulse rounded-xl bg-oms-sunken" />
          ))}
        </div>
      )}

      {!error && !isLoading && visible.length === 0 && (
        <div className="rounded-xl border border-oms-border bg-oms-surface px-5 py-10 text-center">
          <p className="text-[14px] font-medium text-oms-ink-1">{t("empty")}</p>
          <p className="mt-1 text-[12px] text-oms-ink-3">{t("emptyHint")}</p>
        </div>
      )}

      <div className="space-y-3">
        {visible.map((g) => (
          <DuplicateGroupCard
            key={g.key}
            group={g}
            selected={selected}
            onToggle={toggle}
            currencyCode={currencyCode}
            locale={locale}
            readOnly={readOnly}
          />
        ))}
      </div>

      {/* Bulk bar. Mounted only when something is selected — this screen has no
          dense table behind it, so the archive page's inline form fits better
          than the fixed pill. */}
      {!readOnly && selected.size > 0 && (
        <div
          role="toolbar"
          aria-label={t("selected", { count: selected.size })}
          className="fixed inset-x-0 bottom-6 z-40 mx-auto flex w-fit items-center gap-3 rounded-[16px] bg-ink-primary px-4 py-2.5 text-white shadow-lg"
        >
          <span className="text-[14px] font-semibold tabular-nums">
            {t("selected", { count: selected.size })}
          </span>
          <span aria-hidden className="block h-6 w-px bg-white/20" />
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="inline-flex h-[34px] items-center gap-2 rounded-[10px] px-3 text-[13px] font-medium text-[#FDA29B] transition-colors hover:bg-[#B42318]/35 hover:text-white"
          >
            <Trash2 size={14} strokeWidth={2} aria-hidden="true" />
            {t("deleteSelected")}
          </button>
          <button
            type="button"
            aria-label={t("clearSelection")}
            onClick={() => setSelected(new Set())}
            className="grid h-[30px] w-[30px] place-items-center rounded-[8px] text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X size={15} strokeWidth={2} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Confirm. Soft delete is reversible, and the copy says so — but it is
          still a deletion, so it never happens on a single click. */}
      <Sheet
        open={confirming}
        onClose={() => setConfirming(false)}
        placement="center"
        ariaLabel={t("confirmTitle")}
      >
        <div className="p-5">
          <h2 className="text-[16px] font-semibold text-oms-ink-1">{t("confirmTitle")}</h2>
          <p className="mt-2 text-[13px] text-oms-ink-2">
            {t("confirmBody", { count: pairs.length })}
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              {t("cancel")}
            </Button>
            <Button variant="destructive" onClick={runDelete} disabled={busy}>
              {busy ? t("deleting") : t("confirmCta")}
            </Button>
          </div>
        </div>
      </Sheet>

      {/* What actually happened — the screen owes an answer, not a silent list
          that quietly got shorter. */}
      <Sheet
        open={result !== null}
        onClose={() => setResult(null)}
        placement="center"
        ariaLabel={t("summaryTitle")}
      >
        <div className="p-5">
          <h2 className="text-[16px] font-semibold text-oms-ink-1">{t("summaryTitle")}</h2>
          <p className="mt-2 text-[13px] tabular-nums text-oms-ink-2">
            {t("summaryDeleted", { count: result?.succeeded.length ?? 0 })}
          </p>
          {(result?.failed.length ?? 0) > 0 && (
            <>
              <p className="mt-1 inline-flex items-center gap-1.5 text-[13px] font-medium tabular-nums text-oms-age-warm">
                <AlertTriangle size={13} strokeWidth={2.25} aria-hidden="true" />
                {t("summaryFailed", { count: result?.failed.length ?? 0 })}
              </p>
              <ul className="mt-2 space-y-1">
                {result?.failed.map((f) => (
                  <li key={f.order_id} className="text-[12px] text-oms-ink-2">
                    <span className="tabular-nums">{f.order_id}</span>
                    <span className="mx-1 text-oms-ink-3">·</span>
                    {reasonLabel(f.reason)}
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="mt-5 flex items-center justify-between gap-2">
            <a
              href={`/${locale}/orders?status=deleted&include_deleted=1`}
              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-brand hover:underline"
            >
              <ExternalLink size={13} strokeWidth={2} aria-hidden="true" />
              {t("viewDeleted")}
            </a>
            <Button variant="secondary" onClick={() => setResult(null)}>
              {t("close")}
            </Button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
