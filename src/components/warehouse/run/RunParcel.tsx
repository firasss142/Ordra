"use client";

import { useTranslations } from "next-intl";
import { linesOf, isMixed, type RunRow } from "@/lib/warehouse/scan-buckets";
import { ageTone, benchAge } from "@/lib/warehouse/desk";
import { Ic, Tag, Thumb, fnum } from "@/components/warehouse/desk/ui";

/**
 * The parcel in hand, before anything irreversible happens.
 *
 * There is no printer and no barcode on the box: nothing mechanical can prove
 * the parcel in hand is the parcel on screen. The photo and the product lines
 * are the only witnesses, so they are shown at a size you can match against a
 * box at arm's length, and the scanner stays shut until the agent says yes.
 *
 * EVERY LINE IS LISTED. A parcel holding three products used to render as one —
 * the denormalised product on `orders` — so a picker packed one item and the
 * sticker went on anyway. The count is stated as a sentence too, because "3
 * produits" is the fact that makes someone look twice at a box.
 */
export function RunParcel({
  row,
  currency,
  next,
  onConfirm,
  onSkip,
}: {
  row: RunRow;
  currency: string;
  /** The parcel after this one, named so the hand can already reach for it. */
  next?: RunRow | null;
  onConfirm: () => void;
  onSkip: () => void;
}) {
  const t = useTranslations("warehouse.run");
  const td = useTranslations("warehouse.desk");
  const tb = useTranslations("warehouse.bench");

  const lines = linesOf(row);
  const mixed = isMixed(row);
  const hours = Math.max(0, (Date.now() - new Date(row.uploaded_at ?? row.created_at).getTime()) / 3_600_000);
  const tone = ageTone(hours);
  const a = benchAge(hours);
  const stock = row.current_stock ?? 0;
  const low = stock <= (row.low_stock_threshold ?? 0);
  // Fewer on the shelf than the parcel takes: the server will refuse the scan,
  // so say it before the sticker is peeled, not after.
  const short = stock < row.quantity;
  // No Darb reference: the sticker cannot be bound, Darb has nothing to attach it to.
  const noRef = row.has_carrier_ref === false;
  const hero = lines.find((l) => l.image_url)?.image_url ?? row.product_image_url ?? null;

  return (
    <>
      <div data-testid="wh-run-parcel" className="card run-card parcel">
        <div className="pc-photo">
          <Thumb seed={row.product_id ?? row.product_name} image={hero} icon={mixed ? "boxes" : "box"} size="lg" />
        </div>
        <div className="pc-who">
          <span className="eb2">{t("parcelTitle")}</span>
          <h2><bdi>{row.customer_name}</bdi></h2>
          <span className="l2">
            {row.customer_city ? <><bdi>{row.customer_city}</bdi> · </> : null}
            <span className="num" dir="ltr">{fnum(Number(row.total_price))} {currency}</span>
          </span>
          {noRef ? (
            <span className="pc-tags">
              <Tag hue="h-red" icon="alert">{t("noRef")}</Tag>
            </span>
          ) : null}
          <span className="pc-tags">
            <span data-testid="wh-run-age" data-late={tone ? "true" : "false"}>
              <Tag hue={tone === "vlate" ? "h-red" : tone ? "h-amber" : "h-neutral"} icon="clock">
                {a.unit === "h" ? td("hours", { n: a.n }) : td("days", { n: a.n })}
              </Tag>
            </span>
            <span data-low={low ? "true" : "false"}>
              {short ? (
                <Tag hue="h-red" icon="alert">{tb("inStock", { n: stock })} · {t("short")}</Tag>
              ) : (
                <Tag hue={low ? "h-amber" : "h-neutral"} icon="boxes">
                  {tb("inStock", { n: stock })}
                  {low ? ` · ${tb("lowStock")}` : ""}
                </Tag>
              )}
            </span>
          </span>
        </div>

        {/* The contents, one row per product. Never a single summarised line. */}
        <div className="pc-lines">
          <span className="eb2">{t("linesTitle", { n: lines.length })}</span>
          <ul>
            {lines.map((l, i) => (
              <li key={`${l.product_id ?? l.product_name}-${i}`} data-testid="wh-run-line">
                <Thumb seed={l.product_id ?? l.product_name} image={l.image_url} />
                <span className="nm" style={{ whiteSpace: "normal" }}>
                  <bdi>{l.product_name}</bdi>
                  {l.variant_label ? <span style={{ color: "var(--ink-3)", fontWeight: 600 }}> · {l.variant_label}</span> : null}
                </span>
                <b className="qty num">{t("lineQty", { n: l.quantity })}</b>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="run-acts">
        <button type="button" className="btn2 xl" onClick={onSkip}>
          <Ic n="right" className="flip" />
          {t("skip")}
        </button>
        <button type="button" className="btn xl" onClick={onConfirm} autoFocus>
          <Ic n="check" />
          {t("confirm")}
        </button>
      </div>

      {next ? (
        <div className="run-next">
          <span>{t("upNext")}</span>
          <Thumb seed={next.product_id ?? next.product_name} image={next.product_image_url} />
          <b><bdi>{next.customer_name}</bdi></b>
          <span className="l2" style={{ margin: 0 }}><bdi>{next.product_name}</bdi>{next.quantity > 1 ? ` ×${next.quantity}` : ""}</span>
        </div>
      ) : null}
    </>
  );
}
