"use client";

/**
 * `leadDetail` — one prospect: who, the « Prochaine action » and why now, the call-result tray
 * when it is open, then the customer, the origin, the product and the campaign script.
 * `phone` drops the top band (the phone's `.mback` carries the name and WhatsApp instead).
 */
import { useEffect, useRef, useState } from "react";
import { Ic, Thumb } from "@/components/agent/shared";
import { historyOf } from "@/lib/prospects/presentation";
import type { ProspectRow } from "@/lib/prospects/types";
import { leadSit, nextWhy, sourceMeta } from "./crm-model";
import type { CrmWords } from "./words";

const HIST_HUE = { new: "neutral", loyal: "green", risk: "red", mixed: "amber" } as const;

export function LeadDetail({ row, w, now, phone, tray, onCall, onTray, onConvert, onOrder, onCloseLead }: {
  row: ProspectRow;
  w: CrmWords;
  now: number;
  phone?: boolean;
  /** The call-result tray, rendered in place of the footer while it is open (desktop only). */
  tray: React.ReactNode;
  onCall: (row: ProspectRow) => void;
  onTray: () => void;
  onConvert: (row: ProspectRow) => void;
  onOrder: (row: ProspectRow) => void;
  /** « Clore » — the tray, opened on « Pas intéressé ». */
  onCloseLead: () => void;
}) {
  const { t } = w;
  const [menu, setMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const sit = leadSit(row, now);
  const src = sourceMeta(row.source);
  const srcLabel = t(`src.${row.source}`);
  const hist = historyOf(row);
  const histText =
    hist.key === "new" ? t("hist.new")
      : hist.key === "loyal" ? t("hist.loyal", { n: hist.delivered })
        : hist.key === "risk" ? t("hist.risk", { n: hist.returned })
          : t("hist.mixed", { d: hist.delivered, r: hist.returned });
  const city = row.customer_city ?? "—";
  const won = row.bucket === "converted";

  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false); };
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [menu]);

  return (
    <>
      {phone ? null : (
        <div className="dr-top">
          <span className={`pl h-${src.hue}`}><Ic n={src.icon} />{srcLabel}</span>
          <span className="dr-age">{t("detail.created", { when: w.when(row.created_at) })}</span>
          <span className="sp" />
          <div className="fbw" ref={menuRef}>
            <button type="button" className="xbtn" aria-label={t("detail.more")} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
              <Ic n="more" />
            </button>
            {menu ? (
              <div className="menu end" role="menu">
                <button type="button" role="menuitem" className="mi act" onClick={() => { setMenu(false); onCloseLead(); }}>
                  <Ic n="check" /><span className="ml">{t("detail.close")}</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      )}

      <div className="dr-body">
        <div className="pc" style={{ gridTemplateColumns: "minmax(0,1fr)" }}>
          <div className="pc-n"><h2 dir="auto">{row.customer_name}</h2></div>
          <div className="pc-ph"><span className="num">{w.phone(row.customer_phone)}</span><span className="q">· {city}</span></div>
        </div>

        <div className={`nextc h-${sit.hue}`}>
          <small>{t("detail.nextEyebrow")}</small>
          <b>{t(`next.${row.bucket}`)}</b>
          <span>{w.whyText(nextWhy(row, now))}</span>
        </div>

        {tray && !phone ? <div className="m2">{tray}</div> : null}

        {row.notes ? (
          <div className="blk2">
            <h6>{t("detail.message")}</h6>
            <div className="bub in" dir="auto" style={{ maxWidth: "100%" }}>
              {row.notes}
              <small>{w.when(row.created_at)} · {srcLabel}</small>
            </div>
          </div>
        ) : null}

        <div className="blk2">
          <h6>{t("detail.client")}</h6>
          <dl className="facts sm">
            <dt>{t("detail.phone")}</dt>
            <dd><span className="num">{w.phone(row.customer_phone)}</span><span className="tg h-green">{t("detail.recommended")}</span></dd>
            <dt>{t("detail.city")}</dt>
            <dd dir="auto">{row.last_known_address ?? row.customer_address ?? city}</dd>
            <dt>{t("detail.history")}</dt>
            <dd><span className={`rel h-${HIST_HUE[hist.key]}`}>{histText}</span></dd>
          </dl>
        </div>

        <div className="blk2">
          <h6>{t("detail.origin")}</h6>
          <dl className="facts sm">
            <dt>{t("detail.source")}</dt><dd>{srcLabel}</dd>
            {row.assigned_name ? <><dt>{t("detail.agent")}</dt><dd>{row.assigned_name}</dd></> : null}
            <dt>{t("detail.createdAt")}</dt><dd>{w.when(row.created_at)}</dd>
            {row.campaign_name ? <><dt>{t("detail.campaign")}</dt><dd dir="auto">{row.campaign_name}</dd></> : null}
            {row.campaign_offer ? <><dt>{t("detail.offer")}</dt><dd dir="auto">{row.campaign_offer}</dd></> : null}
            {row.source_order_ref ? <><dt>{t("detail.order")}</dt><dd><span className="num">#{row.source_order_ref}</span></dd></> : null}
            {row.return_reason ? <><dt>{t("detail.returnWhy")}</dt><dd dir="auto">{row.return_reason}</dd></> : null}
            {row.converted_order_ref ? <><dt>{t("detail.order")}</dt><dd><span className="num">#{row.converted_order_ref}</span></dd></> : null}
          </dl>
        </div>

        {row.product_name ? (
          <div className="blk2">
            <h6>{t("detail.product")}</h6>
            <div className="line" style={{ border: 0, padding: "4px 0" }}>
              <Thumb src={row.product_image_url} seed={row.product_id ?? row.product_name} />
              <div>
                <b dir="auto">{row.product_name}</b>
                <small>
                  {row.product_price !== null ? `${w.fnum(row.product_price)} ${w.ccy}` : null}
                  {row.campaign_offer ? ` · ${row.campaign_offer}` : null}
                  {row.product_note ? ` · ${row.product_note}` : null}
                </small>
              </div>
              <span />
            </div>
          </div>
        ) : null}

        {row.campaign_script ? (
          <details className="blk2" open={row.bucket === "campaign"}>
            <summary><h6 style={{ display: "inline" }}>{t("detail.script")}</h6></summary>
            <p className="script" dir="auto">{row.campaign_script}</p>
          </details>
        ) : null}
      </div>

      {tray && !phone ? null : (
        <div className={`dr-foot lfoot2${phone ? " mfoot" : ""}`}>
          {won ? (
            <button type="button" className="fa pri wide" onClick={() => onOrder(row)}>
              <Ic n="ext" className="flip" /><span>{t("detail.viewOrder")}</span>
            </button>
          ) : (
            <>
              <a className="fa pri wide" href={`tel:${row.customer_phone}`} onClick={() => onCall(row)}>
                <Ic n="phone" /><span>{t("detail.call")} <span className="num">{w.phone(row.customer_phone)}</span></span>
              </a>
              <button type="button" className="fa" onClick={() => onConvert(row)}>
                <Ic n="bag" /><span>{t("detail.convert")}</span>
              </button>
              <button type="button" className="fa" onClick={onTray}>
                <Ic n="check" /><span>{t("detail.outcome")}</span>
              </button>
            </>
          )}
        </div>
      )}
    </>
  );
}
