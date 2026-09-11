"use client";

import { useLocale, useTranslations } from "next-intl";
import { Boxes, Package, Palette, MapPin } from "lucide-react";
import { zoneLabels, DARB_ZONE_ORDER } from "@/lib/carriers/darb-zones";
import type { Bucket, RunMode } from "@/lib/warehouse/scan-buckets";

/**
 * The one decision of a run: what stays in your hand.
 *
 * The bench asked this question again on every parcel — which colour, which
 * card, take, scan, back to the list. Asked once, it becomes a physical fact:
 * the roll is on the table, or you are standing at the rack. Everything after
 * this screen is the same gesture repeated.
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

  /*
   * A column, even on a wide screen.
   *
   * This is a list of decisions read top to bottom, not a dashboard: stretched
   * to 1400px the two mode cards become billboards and every batch row puts its
   * count a screen away from its name. The desk gets the same column the phone
   * gets, centred.
   */
  return (
    <div className="mx-auto w-full max-w-[640px] px-4 pb-8 pt-3">
      <h1 className="text-[22px] font-bold leading-tight tracking-[-0.01em] text-wm-ink">{t("setupTitle")}</h1>
      <p className="mt-1 text-[14px] leading-relaxed text-wm-ink-2">
        {isLy ? t("setupHint") : t("setupHintTn")}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2.5">
        <ModeCard
          icon={Package}
          label={t("modeProduct")}
          why={t("modeProductWhy")}
          on={mode === "product"}
          onClick={() => onMode("product")}
        />
        <ModeCard
          icon={isLy ? Palette : MapPin}
          label={isLy ? t("modeZone") : t("modeZoneTn")}
          why={isLy ? t("modeZoneWhy") : t("modeZoneWhyTn")}
          on={mode === "zone"}
          onClick={() => onMode("zone")}
        />
      </div>

      <p className="mb-2 mt-5 text-[13px] font-semibold text-wm-ink-2">{t("pickBucket")}</p>
      <div className="flex flex-col gap-2">
        {buckets.map((b) => {
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
          const sub =
            b.kind === "mixed"
              ? t("mixedWhy")
              : b.kind === "zone"
                ? (labels.name ?? b.sublabel)
                : b.sublabel;

          return (
            <button
              key={b.key}
              type="button"
              data-testid="wh-run-bucket"
              data-roll={b.hex ?? ""}
              data-kind={b.kind}
              onClick={() => onPick(b)}
              className="flex min-h-[64px] w-full items-center gap-3 rounded-[14px] border border-wm-card-edge bg-wm-card px-3 py-2.5 text-start active:bg-wm-accent-soft"
            >
              <Swatch bucket={b} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[16px] font-bold leading-tight text-wm-ink">
                  <bdi>{label}</bdi>
                </span>
                <span className="block truncate text-[13px] text-wm-ink-2">
                  {sub ? <bdi>{sub}</bdi> : null}
                  {sub && age ? " · " : null}
                  {age ? t("oldest", { age }) : null}
                </span>
              </span>
              <span className="flex shrink-0 flex-col items-end">
                <b className="text-[20px] font-bold leading-none tabular-nums text-wm-accent">{b.rows.length}</b>
                <span className="mt-0.5 text-[11.5px] text-wm-ink-3">{t("bucketUnits", { n: b.units })}</span>
              </span>
              {/* The branch code, on white — never on the hue. */}
              {b.branchGroup ? (
                <span
                  dir="ltr"
                  className="shrink-0 rounded-[6px] border border-wm-card-edge bg-white px-1.5 text-[12px] font-bold tracking-[0.04em] text-wm-ink"
                >
                  {b.branchGroup}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Swatch({ bucket }: { bucket: Bucket }) {
  if (bucket.kind === "zone" && bucket.hex) {
    return (
      <span
        aria-hidden="true"
        data-hex={bucket.hex}
        className={`h-[38px] w-[14px] shrink-0 rounded-[4px] ${
          FAINT.has(bucket.hex) || !DARB_ZONE_ORDER.includes(bucket.hex) ? "ring-1 ring-inset ring-wm-ink" : ""
        }`}
        style={{ background: bucket.hex }}
      />
    );
  }
  if (bucket.kind === "product" && bucket.imageUrl) {
    return (
      <span
        aria-hidden="true"
        className="grid h-11 w-11 shrink-0 place-items-center overflow-hidden rounded-[8px] border border-wm-card-edge bg-wm-ground"
      >
        {/* Raw <img>: the project configures no images.remotePatterns. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={bucket.imageUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid h-11 w-11 shrink-0 place-items-center rounded-[8px] border-2 border-dashed border-wm-ink-3 text-wm-ink-3"
    >
      {bucket.kind === "mixed" ? <Boxes size={18} /> : <Package size={18} />}
    </span>
  );
}

function ModeCard({
  icon: Icon, label, why, on, onClick,
}: {
  icon: typeof Package;
  label: string;
  why: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-[96px] flex-col items-start gap-1.5 rounded-[14px] border p-3 text-start ${
        on ? "border-wm-accent bg-wm-accent-soft" : "border-wm-card-edge bg-wm-card"
      }`}
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-[10px] ${
          on ? "bg-wm-accent text-white" : "bg-wm-ground text-wm-ink-2"
        }`}
      >
        <Icon size={18} strokeWidth={2} aria-hidden="true" />
      </span>
      <span className="text-[15px] font-bold leading-tight text-wm-ink">{label}</span>
      <span className="text-[12px] leading-snug text-wm-ink-2">{why}</span>
    </button>
  );
}
