"use client";

import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";
import "@/components/agent/voc/voc.css";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { createFeedback, useFeedbackContext, useFeedbackLookup, useFeedbackTopics } from "@/hooks/useFeedback";
import { FEEDBACK_BODY_MAX, FEEDBACK_CATEGORIES, type FeedbackCategory, type FeedbackMoment } from "@/lib/feedback/taxonomy";
import { isEditableTarget } from "@/lib/dom";
import { Ic, Thumb, useAgentPhone } from "@/components/agent/shared";
import { VCAT } from "@/components/agent/voc/vocab";
import type { FeedbackLookupCustomer, FeedbackLookupOrder } from "@/types/feedback";

export interface SavedFeedback {
  id: string;
  category: FeedbackCategory;
  moment: FeedbackMoment;
  /** The topic's label, when one was picked — the toast says it. */
  topic?: string | null;
}

export interface CaptureDialogProps {
  /** The order on screen (the panel, the selected parcel) — null opens the callback search. */
  orderId: string | null;
  /** A super_admin's scope market; null for everyone else. */
  market: string | null;
  onClose: () => void;
  onSaved: (saved: SavedFeedback) => void;
}

const digits = (s: string) => s.replace(/\D/g, "");

/** Highlights the typed digits inside a formatted phone number. */
function Highlight({ text, q }: { text: string; q: string }) {
  const d = digits(q);
  if (d.length < 3) return <>{text}</>;
  const i = digits(text).indexOf(d);
  if (i < 0) return <>{text}</>;
  let seen = 0, a = -1, b = -1;
  for (let k = 0; k < text.length; k++) {
    if (/\d/.test(text[k])) {
      if (seen === i) a = k;
      seen++;
      if (seen === i + d.length) { b = k + 1; break; }
    }
  }
  if (a < 0 || b < 0) return <>{text}</>;
  return <>{text.slice(0, a)}<mark>{text.slice(a, b)}</mark>{text.slice(b)}</>;
}

/**
 * « Ce que dit le client » — the capture (prototypes/agent-shell-v2.html, `captureHTML`):
 * a wide dialog on a desktop, a bottom sheet on a phone.
 *
 *   ① linked: opened with an order on screen; its customer and product are the context, the
 *     moment is derived from its status (« auto »), and the customer's earlier entries show.
 *   ② « Appel entrant »: no order open; search by the number on the agent's phone, each order
 *     listed with its moment — picking one sets it.
 *
 * Keys: 1–3 category · Ctrl/⌘+Enter save · Esc close. Owned here in the capture phase, so
 * the queue and the panel underneath never see them.
 */
export function CaptureDialog({ orderId, market, onClose, onSaved }: CaptureDialogProps) {
  const t = useTranslations("agentVoc");
  const ts = useTranslations("orders.statuses");
  const locale = useLocale();
  const phone = useAgentPhone();
  const titleId = useId();

  const [mode, setMode] = useState<"context" | "blank">(orderId ? "context" : "blank");
  const [query, setQuery] = useState("");
  const [focusSearch, setFocusSearch] = useState(!orderId);
  const [hot, setHot] = useState(0);
  const [picked, setPicked] = useState<FeedbackLookupOrder | null>(null);
  const [category, setCategory] = useState<FeedbackCategory | null>(null);
  const [topic, setTopic] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);

  const topics = useFeedbackTopics(market);
  const { context } = useFeedbackContext(mode === "context" ? orderId : null);
  const { result, isLoading: searching } = useFeedbackLookup(mode === "blank" && !picked ? query : "", market);

  const textRef = useRef<HTMLTextAreaElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const catsRef = useRef<HTMLDivElement>(null);

  const ready = category !== null && text.trim().length > 0 && !saving;
  const topicName = useCallback((id: string | null) => {
    const x = id ? topics.find((tp) => tp.id === id) : null;
    return x ? (locale === "ar" ? x.label_ar : x.label_fr) : null;
  }, [topics, locale]);

  const pickCategory = useCallback((c: FeedbackCategory | null) => {
    setCategory(c);
    setTopic(null);
    requestAnimationFrame(() => textRef.current?.focus());
  }, []);

  const save = useCallback(async () => {
    if (!category || !text.trim() || saving) return;
    setSaving(true);
    setError(false);
    const linkedOrder = mode === "context" ? orderId : picked?.id ?? null;
    try {
      const res = await createFeedback({
        category,
        body: text.trim(),
        topic_id: topic,
        order_id: linkedOrder,
        market_id: market,
      });
      const moment = (res.moment as FeedbackMoment | undefined)
        ?? (mode === "context" ? context?.order.moment : picked?.moment) ?? "call";
      onSaved({ id: res.id, category, moment, topic: topicName(topic) });
    } catch {
      setError(true);
      setSaving(false);
    }
  }, [category, text, saving, mode, orderId, picked, topic, market, context, onSaved, topicName]);

  // Keyboard, in the capture phase: these keys belong to the window while it is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        e.stopPropagation();
        void save();
        return;
      }
      if (!isEditableTarget(e.target) && /^Digit[1-3]$/.test(e.code) && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        const c = FEEDBACK_CATEGORIES[Number(e.code.slice(5)) - 1];
        pickCategory(category === c ? null : c);
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose, save, pickCategory, category]);

  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (mode === "blank" && !picked) searchRef.current?.focus();
      else catsRef.current?.querySelector("button")?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, [mode, picked]);

  const options = useMemo(() => {
    if (!result) return [] as ({ kind: "customer"; c: FeedbackLookupCustomer } | { kind: "order"; o: FeedbackLookupOrder })[];
    return [
      ...result.customers.map((c) => ({ kind: "customer" as const, c })),
      ...result.orders.map((o) => ({ kind: "order" as const, o })),
    ];
  }, [result]);

  const pickOrder = (o: FeedbackLookupOrder) => {
    setPicked(o);
    setFocusSearch(false);
  };
  const pickCustomer = (c: FeedbackLookupCustomer) => {
    const o = result?.orders.find((x) => x.id === c.latest_order_id) ?? result?.orders.find((x) => x.customer_id === c.id);
    if (o) pickOrder(o);
  };
  const toSearch = () => {
    setMode("blank");
    setPicked(null);
    setFocusSearch(true);
  };

  const dateFmt = (iso: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short" }).format(new Date(iso));
  const when = (o: FeedbackLookupOrder) =>
    o.status_at && o.status === "delivered" ? t("capture.deliveredOn", { date: dateFmt(o.status_at) })
      : o.status_at && o.status === "returned" ? t("capture.returnedOn", { date: dateFmt(o.status_at) })
        : statusWord(ts, o.status);

  /** `.vmeta` — « Moment : En attente · en route  [auto]  déduit du statut « … » ». */
  const momentRow = (moment: FeedbackMoment | null, status: string | null, extra?: ReactNode) =>
    moment ? (
      <div className="vmeta" data-testid="moment-row">
        <span>{t("capture.moment")} : <b>{t(`moment.${moment}`)}</b></span>
        <span className="tg h-neutral">{t("capture.auto")}</span>
        {status ? <span className="q">{t("capture.fromStatus", { status: statusWord(ts, status) })}</span> : null}
        {extra}
      </div>
    ) : (
      <div className="vmeta"><span>{t("capture.moment")} · <span className="q">{t("capture.noMoment")}</span></span></div>
    );

  const orderCard = (o: { name: string; phone: string; ref: string; product: { id: string; name: string; image_url: string | null } | null; seed: string }, tail?: string) => (
    <div className="sh-o">
      <Thumb src={o.product?.image_url} seed={o.product?.id ?? o.seed} />
      <div>
        <b dir="auto">{o.name}</b>
        <small>
          <span dir="ltr" className="num">{o.phone}</span>
          {" · "}{t("capture.orderN", { ref: o.ref })}
          {o.product ? <> · <span dir="auto">{o.product.name}</span></> : null}
          {tail ? ` · ${tail}` : null}
        </small>
      </div>
      <button type="button" className="lnk" onClick={toSearch}>{t("capture.change")}</button>
    </div>
  );

  const contextBlock = context ? (
    <>
      {orderCard({ name: context.order.customer_name, phone: context.order.customer_phone, ref: context.order.ref, product: context.order.product, seed: context.order.id })}
      {momentRow(context.order.moment, context.order.status, context.history.count > 0 ? (
        <span className={`tg h-${context.history.open > 0 ? "red" : "amber"}`}>
          <Ic n="alert" />
          {t("capture.history", { n: context.history.count })}
          {context.history.open > 0 ? ` · ${t("capture.historyOpen", { open: context.history.open })}` : null}
        </span>
      ) : null)}
      {context.history.quote ? <p className="vquote">« <span dir="auto">{context.history.quote}</span> »</p> : null}
    </>
  ) : null;

  const blankBlock = picked ? (
    <>
      {orderCard({ name: picked.customer_name, phone: picked.customer_phone, ref: picked.ref, product: picked.product, seed: picked.id }, when(picked))}
      {momentRow(picked.moment, picked.status)}
    </>
  ) : (
    <>
      <div className="incall">
        <b>{t("capture.ringTitle")}</b>
        <small>{t("capture.ringSub")}</small>
        <div className="vlook-w">
          <label className="srch" style={{ boxShadow: "none" }}>
            <Ic n="search" />
            <input
              ref={searchRef}
              value={query}
              onChange={(e) => { setQuery(e.target.value); setHot(0); setFocusSearch(true); }}
              onFocus={() => setFocusSearch(true)}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHot((h) => Math.min(h + 1, options.length - 1)); }
                else if (e.key === "ArrowUp") { e.preventDefault(); setHot((h) => Math.max(h - 1, 0)); }
                else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey && options[hot]) {
                  e.preventDefault();
                  const opt = options[hot];
                  if (opt.kind === "order") pickOrder(opt.o); else pickCustomer(opt.c);
                }
              }}
              placeholder={t("capture.lookup")}
              autoComplete="off"
            />
          </label>
          {focusSearch && query.trim().length >= 3 && (result || searching) ? (
            <div className="vlook">
              {!result ? <span className="q">{t("capture.searching")}</span> : null}
              {result && !options.length ? <span className="q">{t("capture.noResult")}</span> : null}
              {result?.customers.length ? <h6>{t("capture.groupCustomers")}</h6> : null}
              {result?.customers.map((c, i) => (
                <button key={c.id} type="button" className="vlo" data-hot={hot === i || undefined} onClick={() => pickCustomer(c)}>
                  <span className="thumb h-neutral" style={{ width: 32, height: 32, background: "var(--pb)", color: "var(--pi)" }}><Ic n="user" /></span>
                  <span>
                    <b dir="auto">{c.name}</b>
                    <small><span dir="ltr" className="num"><Highlight text={c.phone} q={query} /></span>{c.city ? ` · ${c.city}` : ""}</small>
                  </span>
                  <span className="e">{t("capture.nOrders", { n: c.orders })}</span>
                </button>
              ))}
              {result?.orders.length ? <h6>{t("capture.groupOrders")}</h6> : null}
              {result?.orders.map((o, j) => (
                <button key={o.id} type="button" className="vlo" data-hot={hot === (result.customers.length + j) || undefined} onClick={() => pickOrder(o)}>
                  <Thumb src={o.product?.image_url} seed={o.product?.id ?? o.id} />
                  <span>
                    <b><span className="num">#{o.ref}</span> · <span dir="auto">{o.customer_name}</span></b>
                    {o.product ? <small dir="auto">{o.product.name}</small> : null}
                  </span>
                  <span className="e"><span>{t(`moment.${o.moment}`)}</span><span>{when(o)}</span></span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {momentRow(null, null)}
    </>
  );

  const topicsOf = category ? topics.filter((x) => x.category === category) : [];

  const body = (
    <>
      {phone ? <div className="grab" /> : null}
      <div className="tray-h">
        <span className="hold h-blue"><Ic n="quote" /></span>
        <span className="tt"><b id={titleId}>{t("capture.title")}</b><small>{t("capture.sub")}</small></span>
        <button type="button" className="xbtn" onClick={onClose} aria-label={t("capture.close")}><Ic n="x" /></button>
      </div>
      {mode === "context" ? contextBlock : blankBlock}
      <div className="vcats" ref={catsRef}>
        {FEEDBACK_CATEGORIES.map((c, i) => (
          <button key={c} type="button" aria-pressed={category === c} className={`vcat h-${VCAT[c].hue}${category === c ? " on" : ""}`} onClick={() => pickCategory(category === c ? null : c)}>
            <span className="hold"><Ic n={VCAT[c].icon} /></span>
            <span><b>{t(`cat.${c}`)}</b><small>{t(`hint.${c}`)}</small></span>
            {phone ? null : <kbd>{i + 1}</kbd>}
          </button>
        ))}
      </div>
      <div className="fld">
        <label>{t("capture.subject")}</label>
        {category ? (
          <div className="vtopics">
            {topicsOf.map((x) => (
              <button key={x.id} type="button" aria-pressed={topic === x.id} className={`rc h-${VCAT[category].hue}${topic === x.id ? " on" : ""}`}
                onClick={() => { setTopic(topic === x.id ? null : x.id); textRef.current?.focus(); }}>
                {locale === "ar" ? x.label_ar : x.label_fr}
              </button>
            ))}
          </div>
        ) : <small className="q" style={{ fontSize: 12.5 }}>{t("capture.subjectFirst")}</small>}
      </div>
      <div className="fld">
        <label htmlFor={`${titleId}-w`}>{t("capture.words")}</label>
        <textarea
          id={`${titleId}-w`}
          ref={textRef}
          className="inp"
          dir="auto"
          style={{ height: 84 }}
          value={text}
          maxLength={FEEDBACK_BODY_MAX}
          onChange={(e) => setText(e.target.value)}
          placeholder={t("capture.wordsPh")}
        />
        <small className="q" style={{ fontSize: 11.5, textAlign: "end" }}><span dir="ltr" className="num">{t("capture.chars", { n: text.length })}</span></small>
      </div>
      {category === "reclamation" ? <div className="note h-red"><Ic n="info" /><span>{t("capture.lifecycle")}</span></div> : null}
      {error ? <div className="err" role="alert">{t("capture.error")}</div> : null}
      <div className="trayf">
        <button type="button" className="fa" onClick={onClose}>{t("capture.cancel")}</button>
        <button type="button" className="fa pri wide" disabled={!ready} onClick={() => void save()}>
          <Ic n="check" />
          <span>{saving ? t("capture.saving") : t("capture.save")}</span>
          {phone ? null : <kbd>Ctrl ↵</kbd>}
        </button>
      </div>
    </>
  );

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false, fallbackFocus: () => document.body }}>
      {phone ? (
        <div>
          <div className="shscrim" onClick={onClose} />
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby={titleId}>{body}</div>
        </div>
      ) : (
        <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="mbox wide" role="dialog" aria-modal="true" aria-labelledby={titleId}>{body}</div>
        </div>
      )}
    </FocusTrap>
  );
}

function statusWord(ts: (k: never) => string, status: string): string {
  const label = ts(status as never);
  return label && !label.includes("statuses") ? label : status;
}
