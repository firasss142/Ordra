"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Copy, ScanLine, X } from "lucide-react";
import type { CSSProperties } from "react";
import { Sheet } from "@/components/ui/Sheet";
import { useScorecardParcels } from "@/hooks/useCarrierScorecard";
import { cityLabel } from "@/lib/carriers/scorecard/city-names";
import { fmtDate, fmtDays, fmtInt, fmtPct } from "@/lib/carriers/scorecard/format";
import { carrierTitle, returnsView, share } from "@/lib/carriers/scorecard/view-model";
import type { ScorecardCarrier, ScorecardDormant, ScorecardParcel } from "@/lib/carriers/scorecard/types";
import { carrierShort } from "./labels";
import { btnSmPri, Num } from "./ui";
import type { DrawerKind } from "./CarrierView";

const STATUS_KEYS = new Set(["pending", "booked", "processing", "on-branch", "delayed", "resent", "released", "cancelled", "returning",
  "returned", "uploaded", "scanned", "at_carrier", "dispatched", "deposit", "unverified", "in_transit", "out_for_delivery", "delivery_delayed"]);

function isCard(c: ScorecardCarrier | ScorecardDormant): c is ScorecardCarrier {
  return "period" in c;
}

/** The parcels behind a number, oldest first; « Toutes les villes » reads the scorecard itself. */
export function ParcelDrawer({
  kind, marketId, carrier, color, locale, returnsBenchHref, onClose, onCopy,
}: {
  kind: DrawerKind;
  marketId: string;
  carrier: ScorecardCarrier | ScorecardDormant;
  color: string;
  locale: string;
  returnsBenchHref: string;
  onClose: () => void;
  onCopy: (refs: string[]) => void;
}) {
  const t = useTranslations("carrierScorecard");
  const card = isCard(carrier) ? carrier : null;
  const name = card ? carrierTitle(card, locale) : carrier.name;
  const { parcels, isLoading, error } = useScorecardParcels(marketId, carrier.id, kind === "cities" ? null : kind);

  const count = kind === "late" ? card?.open.late ?? parcels.length
    : kind === "returns" ? (card ? returnsView(card.returns).unscanned : parcels.length)
    : kind === "dormant" ? ("open" in carrier && typeof carrier.open === "number" ? carrier.open : parcels.length)
    : 0;
  const title = kind === "cities" ? t("drawer.cities", { carrier: name }) : t(`drawer.${kind}`, { n: fmtInt(locale, count), carrier: name });
  const statusOf = (p: ScorecardParcel) => {
    const k = p.darb_status && STATUS_KEYS.has(p.darb_status) ? p.darb_status : STATUS_KEYS.has(p.order_status) ? p.order_status : null;
    return k ? t(`drawer.status.${k}`) : p.order_status;
  };
  /** Whole days elapsed, as the prototype writes them: « 8 j ». */
  const days = (n: number | null) => (n == null ? "—" : t("late.days", { n: fmtInt(locale, Math.floor(n)) }));
  const th = "whitespace-nowrap border-b border-tr-line-2 px-[8px] pb-[8px] pt-[10px] text-start text-[11.5px] font-semibold text-tr-ink-3";
  const td = "border-b border-tr-line-2 px-[8px] py-[10px] align-middle";
  const ref = (p: ScorecardParcel) => (
    <span className="font-mono text-[12.5px] font-semibold"><Num>{p.tracking_number ?? t("drawer.noRef")}</Num></span>
  );

  let head: React.ReactNode = null;
  let rows: React.ReactNode = null;
  if (kind === "cities" && card) {
    head = (
      <tr>
        <th className={th}>{t("drawer.cols.city")}</th>
        <th className={`${th} text-end`}>{t("drawer.cols.colis")}</th>
        <th className={`${th} text-end`}>{t("drawer.cols.rate")}</th>
        <th className={`${th} text-end`}>{t("drawer.cols.days")}</th>
      </tr>
    );
    rows = card.cities.map((c) => {
      const fin = c.delivered + c.failed;
      return (
        <tr key={c.city}>
          <td className={td}>{cityLabel(c.city, locale)}</td>
          <td className={`${td} text-end`}><Num>{fmtInt(locale, fin)}</Num></td>
          <td className={`${td} text-end font-semibold`}><Num>{fmtPct(locale, share(c.delivered, fin))}</Num></td>
          <td className={`${td} text-end`}><Num>{c.median_days == null ? "—" : t("late.days", { n: fmtDays(locale, c.median_days) })}</Num></td>
        </tr>
      );
    });
  } else if (kind === "returns") {
    head = (
      <tr>
        <th className={th}>{t("drawer.cols.ref")}</th>
        <th className={th}>{t("drawer.cols.city")}</th>
        <th className={th}>{t("drawer.cols.back")}</th>
        <th className={`${th} text-end`}>{t("drawer.cols.wait")}</th>
      </tr>
    );
    rows = parcels.map((p) => (
      <tr key={p.order_id}>
        <td className={td}>{ref(p)}</td>
        <td className={td}>{p.city ? cityLabel(p.city, locale) : "—"}</td>
        <td className={td}>{p.since ? fmtDate(locale, p.since) : "—"}</td>
        <td className={`${td} text-end`}><Num>{days(p.days)}</Num></td>
      </tr>
    ));
  } else {
    head = (
      <tr>
        <th className={th}>{t("drawer.cols.ref")}</th>
        <th className={th}>{t("drawer.cols.city")}</th>
        <th className={`${th} text-end`}>{t("drawer.cols.since")}</th>
        <th className={th}>{t("drawer.cols.last")}</th>
      </tr>
    );
    rows = parcels.map((p) => (
      <tr key={p.order_id}>
        <td className={td}>
          {ref(p)}
          {p.stuck ? <span className="ms-[6px] inline-flex h-[20px] items-center rounded-full bg-tr-bad-bg px-[7px] text-[11px] font-[650] text-tr-bad-ink">{t("drawer.stuckTag")}</span> : null}
        </td>
        <td className={td}>{p.city ? cityLabel(p.city, locale) : "—"}</td>
        <td className={`${td} text-end`}><Num>{days(p.days)}</Num></td>
        <td className={`${td} text-tr-ink-3`}>
          {p.picked ? statusOf(p) : t("drawer.status.pending")}
          {p.remark ? <span className="block text-[12px] text-tr-ink-3" dir="auto">{p.remark}</span> : null}
        </td>
      </tr>
    ));
  }

  const loadingState = kind !== "cities" && (isLoading || error || parcels.length === 0);
  return (
    <Sheet open onClose={onClose} width="w-full sm:w-[540px]" ariaLabelledBy="scorecard-drawer-title">
      <div className="flex items-center gap-[12px] border-b border-tr-line-2 px-[20px] py-[16px]" style={{ "--c": color } as CSSProperties}>
        <span aria-hidden className="h-[12px] w-[12px] flex-none rounded-[4px] bg-[var(--c)]" />
        <h2 id="scorecard-drawer-title" className="text-[16px] font-[650] text-tr-ink-1">{title}</h2>
        <button type="button" onClick={onClose} aria-label={t("drawer.close")}
          className="ms-auto grid h-[32px] w-[32px] place-items-center rounded-[8px] text-tr-ink-2 hover:bg-tr-well">
          <X size={18} aria-hidden />
        </button>
      </div>
      <div className="flex-1 overflow-auto px-[20px] pb-[20px] pt-[6px]">
        {loadingState ? (
          <p className="py-[24px] text-center text-[13px] text-tr-ink-3">
            {isLoading ? t("drawer.loading") : error ? t("drawer.error") : t("drawer.empty")}
          </p>
        ) : (
          <table className="w-full border-collapse text-[13px] text-tr-ink-1">
            <thead>{head}</thead>
            <tbody>{rows}</tbody>
          </table>
        )}
      </div>
      {kind === "late" && parcels.length ? (
        <div className="flex gap-[8px] border-t border-tr-line-2 px-[20px] py-[14px]">
          <button type="button" className={btnSmPri}
            onClick={() => onCopy(parcels.map((p) => p.tracking_number).filter((r): r is string => !!r))}>
            <Copy size={15} aria-hidden />{t("late.copyFor", { carrier: card ? carrierShort(card, locale, t) : name })}
          </button>
        </div>
      ) : null}
      {kind === "returns" ? (
        <div className="flex gap-[8px] border-t border-tr-line-2 px-[20px] py-[14px]">
          <Link href={returnsBenchHref} className={btnSmPri}><ScanLine size={15} aria-hidden />{t("ret.openBench")}</Link>
        </div>
      ) : null}
    </Sheet>
  );
}
