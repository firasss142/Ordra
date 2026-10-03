"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import FocusTrap from "focus-trap-react";
import { AlertTriangle, Info, PhoneIncoming, Quote, Search, User, X } from "lucide-react";
import { createFeedback, useFeedbackContext, useFeedbackLookup, useFeedbackTopics } from "@/hooks/useFeedback";
import { FEEDBACK_BODY_MAX, FEEDBACK_CATEGORIES, type FeedbackCategory, type FeedbackMoment } from "@/lib/feedback/taxonomy";
import { isEditableTarget } from "@/lib/dom";
import type { FeedbackLookupCustomer, FeedbackLookupOrder } from "@/types/feedback";
import { CategoryCards, Kbd, MomentChip, MomentRow, ProductThumb, TopicChips } from "./atoms";

export interface SavedFeedback {
  id: string;
  category: FeedbackCategory;
  moment: FeedbackMoment;
}

export interface CaptureDialogProps {
  /** The order on screen (the panel, the selected parcel) — null opens the callback search. */
  orderId: string | null;
  /** A super_admin's scope market; null for everyone else. */
  market: string | null;
  onClose: () => void;
  onSaved: (saved: SavedFeedback) => void;
}

const PHONE_QUERY = "(max-width: 1023px)";
function useIsPhone(): boolean {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(PHONE_QUERY);
    setPhone(mq.matches);
    const on = (e: MediaQueryListEvent) => setPhone(e.matches);
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return phone;
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
  return <>{text.slice(0, a)}<mark className="rounded-[3px] bg-[#FEF9C3] text-inherit">{text.slice(a, b)}</mark>{text.slice(b)}</>;
}

/**
 * « Ce que dit le client » — the capture window, prototype voix-du-client-agent-v2.
 *
 *   ① linked: opened with an order on screen; the order, its customer and product are the
 *     context, the moment is derived from its status (« auto »), and the customer's earlier
 *     entries show in red when one is still open.
 *   ② the customer calls back: no order open; search by the number on the agent's phone,
 *     each order listed with its moment — picking one sets it.
 *
 * Keys: 1–3 category · Ctrl/⌘+Enter save · Esc close. Owned here in the capture phase, so
 * the queue and the panel underneath never see them.
 */
export function CaptureDialog({ orderId, market, onClose, onSaved }: CaptureDialogProps) {
  const t = useTranslations("feedback.capture");
  const ts = useTranslations("orders.statuses");
  const locale = useLocale();
  const phone = useIsPhone();
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
  const firstCardRef = useRef<HTMLDivElement>(null);

  const ready = category !== null && text.trim().length > 0 && !saving;

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
      onSaved({ id: res.id, category, moment });
    } catch {
      setError(true);
      setSaving(false);
    }
  }, [category, text, saving, mode, orderId, picked, topic, market, context, onSaved]);

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
      else firstCardRef.current?.querySelector("button")?.focus();
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

  const dateFmt = (iso: string) =>
    new Intl.DateTimeFormat(locale.startsWith("ar") ? "ar-LY" : "fr-FR", { day: "numeric", month: "short" }).format(new Date(iso));
  const when = (o: FeedbackLookupOrder) =>
    o.status_at && o.status === "delivered" ? t("deliveredOn", { date: dateFmt(o.status_at) })
      : o.status_at && o.status === "returned" ? t("returnedOn", { date: dateFmt(o.status_at) })
        : ts(o.status as never);

  const L3 = ({ children, end }: { children: React.ReactNode; end?: React.ReactNode }) => (
    <div className="mb-2 mt-3.5 flex items-center gap-2 text-[12.5px] font-bold text-[#6B7280]">
      {children}
      {end && <span className="ms-auto font-medium">{end}</span>}
    </div>
  );

  const contextBlock = context && (
    <>
      <div className="flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5">
        <ProductThumb url={context.order.product?.image_url} />
        <div className="min-w-0 flex-1">
          <b className="block text-[15px] font-bold [unicode-bidi:plaintext]">{context.order.customer_name}</b>
          <span className="mt-px flex flex-wrap gap-2.5 text-[13px] text-[#6B7280]">
            <span dir="ltr" className="tabular-nums">{context.order.customer_phone}</span>
            <span>{t("orderN", { ref: context.order.ref })}</span>
            {context.order.product && <span className="[unicode-bidi:plaintext]">{context.order.product.name}</span>}
          </span>
        </div>
        <button type="button" onClick={() => { setMode("blank"); setFocusSearch(true); }} className="whitespace-nowrap text-[13px] font-semibold text-[#15803D]">
          {t("change")}
        </button>
      </div>
      <MomentRow moment={context.order.moment} status={context.order.status} />
      {context.history.count > 0 && (
        <div className={`mt-2 flex items-start gap-2.5 rounded-[10px] border px-3 py-2.5 text-[13px] ${context.history.open > 0 ? "border-[#FECACA] bg-[#FFF4F4] text-[#7F1D1D]" : "border-[#E5E7EB] bg-[#F9FAFB] text-[#374151]"}`}>
          <AlertTriangle size={16} className={`mt-px shrink-0 ${context.history.open > 0 ? "text-[#DC2626]" : "text-[#6B7280]"}`} aria-hidden />
          <div>
            <b className="font-bold">{t("history", { n: context.history.count, open: context.history.open })}</b>
            {context.history.quote && <span className="mt-[3px] block text-[14px] text-[#111827] [unicode-bidi:plaintext]">{context.history.quote}</span>}
          </div>
        </div>
      )}
    </>
  );

  const blankBlock = picked ? (
    <>
      <div className="flex min-h-[52px] items-center gap-2.5 rounded-xl border-[1.5px] border-[#15803D] bg-[#F0FDF4] py-1.5 pe-1.5 ps-3 text-[14px]">
        <ProductThumb url={picked.product?.image_url} size={36} />
        <span className="min-w-0 flex-1">
          <b className="font-bold [unicode-bidi:plaintext]">{picked.customer_name}</b>{" "}
          <span dir="ltr" className="tabular-nums">{picked.customer_phone}</span>
          <br />
          <span className="text-[13px] text-[#6B7280]">
            {t("orderN", { ref: picked.ref })}
            {picked.product && <> · <span className="[unicode-bidi:plaintext]">{picked.product.name}</span></>} · {when(picked)}
          </span>
        </span>
        <button type="button" aria-label={t("change")} onClick={() => { setPicked(null); setFocusSearch(true); }} className="grid h-8 w-8 place-items-center rounded-lg text-[#6B7280]">
          <X size={16} aria-hidden />
        </button>
      </div>
      <MomentRow moment={picked.moment} status={picked.status} />
    </>
  ) : (
    <>
      <div className="mb-1 flex items-center gap-2.5 rounded-xl border border-[#BFDBFE] bg-[#EFF6FF] px-3 py-2.5 text-[13px] text-[#1E3A8A]">
        <PhoneIncoming size={18} className="text-[#2563EB]" aria-hidden />
        <div><b className="text-[14px]">{t("ringTitle")}</b><div>{t("ringSub")}</div></div>
      </div>
      <L3>{t("custLabel")}</L3>
      <div className="relative">
        <div className="flex h-11 items-center gap-2 rounded-[10px] border border-[#D1D5DB] bg-white px-3 text-[#6B7280] focus-within:border-[#15803D] focus-within:shadow-[0_0_0_3px_#DCFCE7]">
          <Search size={18} aria-hidden />
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
            placeholder={t("custPlaceholder")}
            autoComplete="off"
            className="h-full min-w-0 flex-1 border-0 bg-transparent text-[14.5px] text-[#111827] outline-none"
          />
        </div>
        {focusSearch && query.trim().length >= 3 && !result && searching && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-10 rounded-xl border border-[#E5E7EB] bg-white px-3 py-2 text-[12.5px] text-[#6B7280] shadow-[0_12px_32px_rgba(17,24,39,0.14)]">
            {t("searching")}
          </div>
        )}
        {focusSearch && query.trim().length >= 3 && result && (
          <div className="absolute inset-x-0 top-[calc(100%+6px)] z-10 max-h-[300px] overflow-y-auto rounded-xl border border-[#E5E7EB] bg-white shadow-[0_12px_32px_rgba(17,24,39,0.14)]">
            {options.length === 0 && <div className="px-3 pb-1 pt-2 text-[11.5px] font-bold text-[#9CA3AF]">{t("noResult")}</div>}
            {result.customers.length > 0 && <div className="px-3 pb-1 pt-2 text-[11.5px] font-bold text-[#9CA3AF]">{t("groupCustomers")}</div>}
            {result.customers.map((c, i) => (
              <button key={c.id} type="button" data-hot={hot === i || undefined} onClick={() => pickCustomer(c)}
                className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-[#F9FAFB] data-[hot]:bg-[#F9FAFB]">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-[#F3F4F6] text-[#6B7280]"><User size={16} aria-hidden /></span>
                <span className="min-w-0">
                  <b className="block text-[14px] font-semibold [unicode-bidi:plaintext]">{c.name}</b>
                  <small className="text-[12px] text-[#6B7280]"><span dir="ltr" className="tabular-nums"><Highlight text={c.phone} q={query} /></span>{c.city ? ` · ${c.city}` : ""}</small>
                </span>
                <span className="ms-auto text-[12px] text-[#6B7280]">{t("nOrders", { n: c.orders })}</span>
              </button>
            ))}
            {result.orders.length > 0 && <div className="px-3 pb-1 pt-2 text-[11.5px] font-bold text-[#9CA3AF]">{t("groupOrders")}</div>}
            {result.orders.map((o, j) => {
              const i = result.customers.length + j;
              return (
                <button key={o.id} type="button" data-hot={hot === i || undefined} onClick={() => pickOrder(o)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-start hover:bg-[#F9FAFB] data-[hot]:bg-[#F9FAFB]">
                  <ProductThumb url={o.product?.image_url} size={32} />
                  <span className="min-w-0">
                    <b className="block text-[14px] font-semibold"><span dir="ltr" className="tabular-nums">#{o.ref}</span> · <span className="[unicode-bidi:plaintext]">{o.customer_name}</span></b>
                    {o.product && <small className="text-[12px] text-[#6B7280] [unicode-bidi:plaintext]">{o.product.name}</small>}
                  </span>
                  <span className="ms-auto flex flex-col items-end gap-[3px]">
                    <MomentChip moment={o.moment} small />
                    <small className="text-[12px] text-[#6B7280]">{when(o)}</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <MomentRow moment={null} status={null} />
    </>
  );

  return (
    <FocusTrap focusTrapOptions={{ allowOutsideClick: true, escapeDeactivates: false, fallbackFocus: () => document.body }}>
      <div
        className="fixed inset-0 z-[80] flex items-end justify-center bg-[rgba(17,24,39,0.34)] lg:items-start lg:pt-14"
        onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[18px] bg-white text-start shadow-[0_24px_60px_rgba(17,24,39,0.24)] lg:max-h-[calc(100vh-84px)] lg:w-[680px] lg:rounded-2xl"
        >
          <div className="mx-auto mt-2 h-1 w-10 rounded-full bg-[#D1D5DB] lg:hidden" aria-hidden />
          <div className="flex items-center gap-3 px-[18px] pb-2.5 pt-4">
            <span className="grid h-10 w-10 place-items-center rounded-[10px] bg-[#F5F3FF] text-[#6D28D9]"><Quote size={18} aria-hidden /></span>
            <div>
              <h3 id={titleId} className="m-0 text-[18px] font-bold">{t("title")}</h3>
              <p className="m-0 mt-px text-[13px] text-[#6B7280]">{mode === "context" ? t("subContext") : t("subBlank")}</p>
            </div>
            <span className="ms-auto flex items-center gap-2">
              <span className="max-lg:hidden"><Kbd>Esc</Kbd></span>
              <button type="button" onClick={onClose} aria-label={t("close")} className="grid h-9 w-9 place-items-center rounded-lg border border-[#D1D5DB] text-[#374151]">
                <X size={18} aria-hidden />
              </button>
            </span>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-[18px] pb-4">
            {mode === "context" ? contextBlock : blankBlock}

            <L3 end={phone ? undefined : t("catHint")}>{t("catLabel")}</L3>
            <div ref={firstCardRef}>
              <CategoryCards value={category} onChange={pickCategory} showKeys={!phone} stack={phone} />
            </div>

            {category && (
              <>
                <L3>{t("topicLabel")} <small className="font-medium text-[#9CA3AF]">· {t("optional")}</small></L3>
                <TopicChips category={category} topics={topics} value={topic} onChange={(id) => { setTopic(id); textRef.current?.focus(); }} />
              </>
            )}

            <L3>{t("textLabel")}</L3>
            <textarea
              ref={textRef}
              value={text}
              maxLength={FEEDBACK_BODY_MAX}
              onChange={(e) => setText(e.target.value)}
              placeholder={t("textPlaceholder")}
              className="min-h-[96px] w-full resize-y rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[15px] leading-[1.6] outline-none [unicode-bidi:plaintext] focus:border-[#15803D] focus:shadow-[0_0_0_3px_#DCFCE7]"
            />
            <div className="mt-[5px] flex justify-between text-[12px] text-[#9CA3AF]">
              <span>{t("textHint")}</span>
              <span dir="ltr" className="tabular-nums">{t("chars", { n: text.length })}</span>
            </div>
            {category === "reclamation" && (
              <div className="mt-2.5 flex items-start gap-[9px] rounded-[10px] border border-[#FECACA] bg-[#FFF4F4] px-3 py-2.5 text-[13px] text-[#7F1D1D]">
                <Info size={16} className="mt-px shrink-0 text-[#DC2626]" aria-hidden />
                <span>{t("lifecycle")}</span>
              </div>
            )}
            {error && <p role="alert" className="mt-2.5 text-[13px] font-semibold text-[#B91C1C]">{t("error")}</p>}
          </div>

          <div className="flex items-center gap-2.5 border-t border-[#E5E7EB] px-[18px] py-3 max-lg:pb-[max(12px,env(safe-area-inset-bottom))]">
            <span className="flex flex-wrap items-center gap-3 text-[12px] text-[#6B7280] max-lg:hidden">
              <span className="inline-flex items-center gap-[5px]"><Kbd>Ctrl</Kbd>+<Kbd>↵</Kbd> {t("keySave")}</span>
              <span className="inline-flex items-center gap-[5px]"><Kbd>1–3</Kbd> {t("keyCategory")}</span>
              <span className="inline-flex items-center gap-[5px]"><Kbd>Esc</Kbd> {t("keyClose")}</span>
            </span>
            <span className="ms-auto flex gap-2 max-lg:w-full">
              <button type="button" onClick={onClose} className="inline-flex h-10 items-center justify-center rounded-lg border border-[#D1D5DB] bg-white px-3.5 text-[14px] font-semibold hover:bg-[#F9FAFB] max-lg:hidden">
                {t("cancel")}
              </button>
              <button type="button" onClick={() => void save()} disabled={!ready}
                className="inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-[#15803D] px-4 text-[14px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-45 max-lg:h-12 max-lg:flex-1 max-lg:text-[16px]">
                {saving ? t("saving") : t("save")}
              </button>
            </span>
          </div>
        </div>
      </div>
    </FocusTrap>
  );
}
