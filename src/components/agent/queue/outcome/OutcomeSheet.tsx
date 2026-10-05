"use client";

/**
 * The phone's « Résultat de l'appel » (prototype `callSheet`, `.shscrim` + `.sheet`): the grab,
 * the title, « Tentative n/3 », the order echo, the four endings with their one line — and,
 * once one is picked, the same steps the desktop opens inside the order (`.m` wrapper).
 */

import { useEffect } from "react";
import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Ic, Thumb } from "@/components/agent/shared";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { CALLING_STATUSES } from "@/lib/orders/row-signals";
import { OutcomeTray } from "./OutcomeTray";
import type { OutcomeFlow } from "./useOutcomeFlow";

const DarbAssabilDispatchModal = dynamic(
  () => import("@/components/queue/DarbAssabilDispatchModal").then((m) => m.DarbAssabilDispatchModal),
  { ssr: false },
);

export interface SheetEcho {
  name: string;
  phone: string;
  productName: string;
  imageUrl: string | null;
  quantity: number;
  total: number;
}

/** The carrier's own form (Darb asks service, area, options) — a dialog, as before. */
export function DarbStep({ flow }: { flow: OutcomeFlow }) {
  const s = flow.send;
  const card = s.carriers.selectedCard;
  if (!s.darbOpen || !card) return null;
  const o = s.carriers.order;
  return (
    <DarbAssabilDispatchModal
      orderId={flow.order.id}
      carrierId={card.id}
      customerAddress={o?.customer_address ?? null}
      customerCity={o?.customer_city ?? null}
      totalPrice={o?.total_price ?? null}
      darbDestinationId={o?.darb_destination_id ?? null}
      onClose={s.closeDarb}
      onSuccess={s.onDarbSuccess}
    />
  );
}

export function OutcomeSheet({ flow, echo, onClose }: { flow: OutcomeFlow; echo: SheetEcho; onClose: () => void }) {
  const t = useTranslations("agentOutcome");
  const step = flow.tray;
  const calling = CALLING_STATUSES.has(flow.order.status);
  const n = flow.order.attempts;
  const max = flow.maxAttempts;
  const busy = flow.busy !== null;

  // Escape steps back out of a step first, then closes the sheet (prototype keydown).
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || flow.send.darbOpen) return;
      e.stopPropagation();
      if (flow.tray) flow.dismiss();
      else onClose();
    };
    document.addEventListener("keydown", h, true);
    return () => document.removeEventListener("keydown", h, true);
  }, [flow, onClose]);

  const title =
    step === "reject" ? t("sheet.reject") : step === "callback" ? t("sheet.callback") : step === "send" ? t("sheet.send") : step === "schedule" ? t("sheet.schedule") : t("sheet.result");
  const ccy = formatDisplayCurrencyCode(flow.order.currency, flow.order.marketId);

  const options: Array<[key: "noAnswer" | "confirm" | "reject" | "callback", hue: string, icon: string, title: string, hint: string]> = [
    ...(n < max ? [["noAnswer", "amber", "phoneoff", t("sheet.noAnswer"), t("sheet.noAnswerHint")] as ["noAnswer", string, string, string, string]] : []),
    ["confirm", "green", "check", t("sheet.confirmed"), t("sheet.confirmedHint")],
    ["reject", "red", "thumbdown", t("sheet.rejected"), n >= max ? t("sheet.rejectedHintMax") : t("reject.sub")],
    ["callback", "violet", "clock", t("sheet.callback"), t("sheet.callbackHint")],
  ];

  return (
    <>
      <div className="shscrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="grab" />
        <div className="sh-h">
          <b>{title}</b>
          {!step && calling ? <span className={`pl h-${n >= max ? "red" : "amber"}`}>{Number.isFinite(max) ? t("top.attempt", { n, max }) : t("top.attemptBare", { n })}</span> : null}
          <button type="button" className="xbtn" onClick={onClose} aria-label={t("sheet.close")}>
            <Ic n="x" />
          </button>
        </div>
        <div className="sh-o">
          <Thumb src={echo.imageUrl} seed={echo.productName} />
          <div>
            <b dir="auto">{echo.name}</b>
            <small>
              <span className="num">{echo.phone}</span> · {echo.productName} · {echo.total} {ccy}
            </small>
          </div>
        </div>
        {step ? (
          <div className="m">
            <OutcomeTray flow={flow} />
          </div>
        ) : (
          <>
            {n >= max ? (
              <div className="note h-amber">
                <Ic n="alert" />
                <span>{t("notes.maxAttempts")}</span>
              </div>
            ) : null}
            {flow.error ? (
              <div className="note h-red" role="alert">
                <Ic n="alert" />
                <span>{flow.error}</span>
              </div>
            ) : null}
            <div className="ocl">
              {options.map(([k, hue, icon, title2, hint]) => (
                <button key={k} type="button" className={`ocr h-${hue}`} disabled={busy} onClick={() => void flow.act(k)}>
                  <span className="hold">
                    <Ic n={icon} />
                  </span>
                  <span>
                    <b>{title2}</b>
                    <small>{(k === "noAnswer" && flow.busy === "noAnswer") || (k === "confirm" && flow.busy === "confirm") ? t("sheet.saving") : hint}</small>
                  </span>
                  {k === "reject" ? <span className="req">{t("sheet.required")}</span> : null}
                </button>
              ))}
            </div>
            <p className="q foot">{t("sheet.foot")}</p>
          </>
        )}
      </div>
      <DarbStep flow={flow} />
    </>
  );
}
