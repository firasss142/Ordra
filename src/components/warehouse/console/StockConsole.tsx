"use client";

import { useCallback } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import type { Role } from "@/types";
import { canViewReceptions } from "@/lib/receptions/permissions";
import { WAREHOUSE_HISTORY_KINDS, type WarehouseHistoryKind } from "@/lib/warehouse/list-filters";
import { ReceptionsConsole } from "@/components/warehouse/receptions/ReceptionsConsole";
import { WarehouseStockClient } from "./WarehouseStockClient";
import { JournalConsole } from "./JournalConsole";

/**
 * Entrepôt › Stock — what we hold, every movement that got it there, and what
 * is coming in. One question — « Combien avons-nous, où, et qu'est-ce qui
 * entre ? » — at three depths.
 *
 * The desk draws `C.stock` / `C.receptions` / `C.journal` of
 * prototypes/entrepot-day-loop-manager-v3.html: the title « Stock », then the
 * soft tabs Niveaux | Réceptions | Mouvements. The phone draws `R.stock` of
 * the agent prototype: no tabs at all — but the address still opens
 * Réceptions (« Recevoir » on Aujourd'hui links there) and one product's
 * movements (« Tous les mouvements » on its page).
 *
 * The tab, the product and the family live in the ADDRESS
 * (`?tab=levels|receptions|journal&product=<id>&kind=<family>`), next to the
 * building the desk's top bar writes (`?warehouse_id=`), which a tab change
 * keeps.
 *
 * Wears the Recevoir hue (`job-receive`): receiving and stock are one job seen
 * from two sides — what comes in and what is held.
 */
type Tab = "levels" | "receptions" | "journal";
const TABS: Tab[] = ["levels", "receptions", "journal"];
const TAB_LABEL: Record<Tab, string> = { levels: "tabLevels", receptions: "tabReceptions", journal: "tabJournal" };

function asKind(v: string | null): WarehouseHistoryKind {
  return v && (WAREHOUSE_HISTORY_KINDS as string[]).includes(v) ? (v as WarehouseHistoryKind) : "all";
}

export function StockConsole({
  locale,
  role,
  variant,
  siteId,
  eyebrow = null,
}: {
  locale: string;
  role: Role;
  variant: "agent" | "desk";
  /** The building in view: the agent's own, or the desk's `?warehouse_id=`. */
  siteId: string | null;
  /** The phone's « <building> · <date> ». */
  eyebrow?: string | null;
}) {
  const t = useTranslations("warehouse.stock");
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const showReceptions = canViewReceptions(role);

  const requested = search.get("tab");
  const tab: Tab =
    requested === "journal" ? "journal" : requested === "receptions" && showReceptions ? "receptions" : "levels";
  const product = search.get("product");
  const kind = asKind(search.get("kind"));

  /** Rewrites the address, keeping what the page does not own (the building). */
  const go = useCallback(
    (next: { tab: Tab; product?: string | null; kind?: WarehouseHistoryKind }) => {
      const params = new URLSearchParams(search.toString());
      for (const k of ["tab", "product", "kind"]) params.delete(k);
      if (next.tab !== "levels") params.set("tab", next.tab);
      if (next.tab === "journal" && next.product) params.set("product", next.product);
      if (next.tab === "journal" && next.kind && next.kind !== "all") params.set("kind", next.kind);
      const qs = params.toString();
      router.replace(`${pathname}${qs ? `?${qs}` : ""}`, { scroll: false });
    },
    [router, pathname, search],
  );

  const journal = (
    <JournalConsole
      locale={locale}
      productId={product}
      kind={kind}
      onKindChange={(k) => go({ tab: "journal", product, kind: k })}
      onClearProduct={() => go({ tab: "journal", product: null, kind })}
    />
  );

  /* ── The phone: no tabs. ─────────────────────────────────────────── */
  if (variant === "agent") {
    if (tab === "levels") return <WarehouseStockClient locale={locale} variant="agent" siteId={siteId} eyebrow={eyebrow} />;
    // Réceptions and Mouvements are reached by address only: a way back and
    // a title, then the content as it is.
    const back = tab === "journal" && product ? `/${locale}/warehouse/stock/${product}` : `/${locale}/warehouse/stock`;
    return (
      <div className="job-receive pb-[24px] text-[14px] leading-[1.5] text-wh-ink-1">
        <div className="mb-[4px] flex items-center gap-[12px] px-[16px] pt-[18px]">
          <Link
            href={back}
            aria-label={t("back")}
            className="grid h-[40px] w-[40px] shrink-0 place-items-center rounded-full border border-line bg-wh-surface text-wh-ink-1 no-underline"
          >
            <ArrowLeft size={18} strokeWidth={2} className="rtl:-scale-x-100" aria-hidden="true" />
          </Link>
          <h1 className="min-w-0 flex-1 text-[28px] font-bold leading-[1.2] tracking-[-0.02em]">{t(TAB_LABEL[tab])}</h1>
        </div>
        {tab === "receptions" ? <ReceptionsConsole locale={locale} role={role} /> : <div className="px-[16px] pt-[14px]">{journal}</div>}
      </div>
    );
  }

  /* ── The desk: title, soft tabs, content. ────────────────────────── */
  return (
    <div className="job-receive px-[28px] pb-[40px] pt-[12px] text-[14px] leading-[1.5] text-wh-ink-1">
      <div className="mb-[20px] flex items-end gap-[16px]">
        <h1 className="min-w-0 flex-1 text-[24px] font-bold tracking-[-0.02em]">{t("title")}</h1>
      </div>
      <div
        role="tablist"
        aria-label={t("consoleTabs")}
        className="mb-[18px] inline-flex gap-[3px] rounded-[12px] bg-line-subtle p-[3px]"
      >
        {TABS.filter((k) => k !== "receptions" || showReceptions).map((k) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={tab === k}
            onClick={() => go({ tab: k })}
            className={`rounded-[8px] px-[16px] py-[7px] text-[13.5px] font-semibold ${
              tab === k ? "bg-wh-surface text-wh-ink-1" : "text-wh-ink-2 hover:text-wh-ink-1"
            }`}
          >
            {t(TAB_LABEL[k])}
          </button>
        ))}
      </div>
      {tab === "levels" ? (
        <WarehouseStockClient locale={locale} variant="desk" siteId={siteId} />
      ) : tab === "receptions" ? (
        /* ReceptionsConsole is approved as it stands and brings its own page
           padding; under the tabs it sits on this page's grid instead. */
        <div className="[&>div]:!max-w-none [&>div]:!px-0 [&>div]:!pt-0">
          <ReceptionsConsole locale={locale} role={role} />
        </div>
      ) : (
        journal
      )}
    </div>
  );
}
