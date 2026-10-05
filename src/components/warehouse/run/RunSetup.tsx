"use client";

import { useLocale, useTranslations } from "next-intl";
import { zoneLabels, DARB_ZONE_ORDER } from "@/lib/carriers/darb-zones";
import type { Bucket, RunMode } from "@/lib/warehouse/scan-buckets";
import { Ic, Pager, Thumb, usePaged } from "@/components/warehouse/desk/ui";

/**
 * The one decision of a run: what stays in your hand.
 *
 * The bench asked this question again on every parcel — which colour, which
 * card, take, scan, back to the list. Asked once, it becomes a physical fact:
 * the roll is on the table, or you are standing at the rack. Everything after
 * this screen is the same gesture repeated.
 *
 * Aurore since 2026-10-05: two choice cards, then the batches as one list —
 * the swatch first, because the eye finds the roll before it reads the name.
 */

/** Yellow and lime read as blank on a light ground without an edge. */
const FAINT = new Set(["#f9fc01", "#8fff00"]);

type Translate = (key: string, values?: Record<string, string | number>) => string;

function ageLabel(iso: string | null, tAge: Translate): string | null {
  if (!iso) return null;
  const hours = Math.max(0, (Date.now() - new Date(iso).getTime()) / 3_600_000);
  return hours >= 48 ? tAge("days", { n: Math.floor(hours / 24) }) : tAge("hours", { n: Math.round(hours) });
}

export function RunSetup({
  market,
  mode,
  buckets,
  onMode,
  onPick,
}: {
  market: "ly" | "tn";
  mode: RunMode;
  buckets: Bucket[];
  onMode: (mode: RunMode) => void;
  onPick: (bucket: Bucket) => void;
}) {
  const t = useTranslations("warehouse.run");
  const tAge = useTranslations("warehouse.age") as unknown as Translate;
  const locale = useLocale();
  const isLy = market === "ly";
  const [paged, setPage] = usePaged(buckets, mode);
  const parcels = buckets.reduce((n, b) => n + b.rows.length, 0);

  return (
    <>
      <div className="card run-hero">
        <span className="hold j-out"><Ic n="scan" /></span>
        <div>
          <h2>{t("setupTitle")}</h2>
          <p>{isLy ? t("setupHint") : t("setupHintTn")}</p>
        </div>
      </div>

      <div className="run-modes">
        <ModeCard icon="box" label={t("modeProduct")} why={t("modeProductWhy")} on={mode === "product"} onClick={() => onMode("product")} />
        <ModeCard
          icon={isLy ? "roll" : "pin"}
          label={isLy ? t("modeZone") : t("modeZoneTn")}
          why={isLy ? t("modeZoneWhy") : t("modeZoneWhyTn")}
          on={mode === "zone"}
          onClick={() => onMode("zone")}
        />
      </div>

      <div className="list run-buckets">
        <div className="dec-h">
          <b>{t("pickBucket")}</b>
          <span className="l2" style={{ margin: 0 }}>{t("setupCount", { batches: buckets.length, parcels })}</span>
        </div>
        <div className="rows">
          {paged.rows.map((b) => {
            const age = ageLabel(b.oldestAt, tAge);
            const labels = b.hex ? zoneLabels(b.hex, locale) : { colour: null, name: null };
            const label =
              b.kind === "mixed"
                ? t("mixed")
                : b.kind === "zone_unknown"
                  ? isLy ? t("unknownZone") : t("unknownZoneTn")
                  : b.kind === "zone"
                    ? (labels.colour ?? b.label)
                    : b.label;
            const sub = b.kind === "mixed" ? t("mixedWhy") : b.kind === "zone" ? (labels.name ?? b.sublabel) : b.sublabel;
            return (
              <button
                key={b.key}
                type="button"
                className="row bk"
                data-testid="wh-run-bucket"
                data-roll={b.hex ?? ""}
                data-kind={b.kind}
                onClick={() => onPick(b)}
              >
                <Swatch bucket={b} />
                <span className="bk-t">
                  <span className="nm"><bdi>{label}</bdi></span>
                  <span className="l2">
                    {sub ? <bdi>{sub}</bdi> : null}
                    {sub && age ? " · " : null}
                    {age ? t("oldest", { age }) : null}
                  </span>
                </span>
                {/* The branch code, on white — never on the hue. */}
                {b.branchGroup ? <span className="plate" dir="ltr">{b.branchGroup}</span> : <span />}
                <span className="bk-n">
                  <b className="num">{b.rows.length}</b>
                  <small>{t("bucketUnits", { n: b.units })}</small>
                </span>
                <span className="bk-go"><Ic n="right" className="flip" /></span>
              </button>
            );
          })}
        </div>
        <Pager paged={paged} onPage={setPage} />
      </div>
    </>
  );
}

function Swatch({ bucket }: { bucket: Bucket }) {
  if (bucket.kind === "zone" && bucket.hex) {
    return (
      <span
        aria-hidden="true"
        data-hex={bucket.hex}
        className={`sw ${FAINT.has(bucket.hex) || !DARB_ZONE_ORDER.includes(bucket.hex) ? "edge" : ""}`}
        style={{ "--c": bucket.hex } as React.CSSProperties}
      />
    );
  }
  if (bucket.kind === "product") return <Thumb seed={bucket.key} image={bucket.imageUrl} />;
  return (
    <span className="thumb dash" aria-hidden="true">
      <Ic n={bucket.kind === "mixed" ? "boxes" : "alert"} />
    </span>
  );
}

function ModeCard({
  icon,
  label,
  why,
  on,
  onClick,
}: {
  icon: "box" | "roll" | "pin";
  label: string;
  why: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick} className={`run-mode j-out ${on ? "on" : ""}`}>
      <span className="hold"><Ic n={icon} /></span>
      <span className="rm-t">
        <b>{label}</b>
        <small>{why}</small>
      </span>
      <span className="rm-ck" aria-hidden="true">{on ? <Ic n="check" /> : null}</span>
    </button>
  );
}
