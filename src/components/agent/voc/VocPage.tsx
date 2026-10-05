"use client";

import "@/components/agent/agent.css";
import "@/components/agent/agent-app.css";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useFeedbackTopics, useMyFeedback } from "@/hooks/useFeedback";
import { FEEDBACK_CATEGORIES, FEEDBACK_MOMENTS, type FeedbackCategory, type FeedbackMoment } from "@/lib/feedback/taxonomy";
import { isEditableTarget } from "@/lib/dom";
import { marketParts } from "@/components/orders/commandes/ui";
import { useFeedbackCapture } from "@/components/feedback/FeedbackCaptureProvider";
import { APill, Ic, Thumb, useAgentPhone } from "@/components/agent/shared";
import type { FeedbackTopic, MyFeedbackRow } from "@/types/feedback";
import { VCAT, VST } from "./vocab";

/**
 * « Voix du client » — the agent's own entries (prototypes/agent-shell-v2.html, `vocPage` /
 * `vocPhone`): category tabs with counts, the moments as a multi-select, a search in their
 * words, and the read-only status of the complaints they raised. « Nouveau » (or F, owned by
 * FeedbackCaptureProvider) opens the capture. On a phone each entry is a card (plan decision 9).
 */
export function VocPage({ marketId }: { marketId: string | null }) {
  const t = useTranslations("agentVoc");
  const locale = useLocale();
  const phone = useAgentPhone();
  const { rows, error } = useMyFeedback();
  const topics = useFeedbackTopics(null);
  const { openCapture } = useFeedbackCapture();
  const [cat, setCat] = useState<FeedbackCategory | "all">("all");
  const [moms, setMoms] = useState<ReadonlySet<FeedbackMoment>>(new Set());
  const [q, setQ] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && !isEditableTarget(e.target) && !document.querySelector('[role="dialog"][aria-modal="true"]')) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const all = useMemo(() => rows ?? [], [rows]);
  const topicLabel = useCallback(
    (id: string | null) => topicName(topics, id, locale),
    [topics, locale],
  );

  const shown = useMemo(() => {
    const raw = q.trim();
    const low = raw.toLowerCase();
    return all.filter((r) =>
      (cat === "all" || r.category === cat)
      && (!moms.size || moms.has(r.moment))
      && (!raw || r.body.includes(raw) || (topicLabel(r.topic_id) ?? "").toLowerCase().includes(low)
        || (r.product?.name ?? "").toLowerCase().includes(low)),
    );
  }, [all, cat, moms, q, topicLabel]);

  const when = useCallback((iso: string) => {
    const now = new Date();
    const { day, time } = marketParts(iso, marketId);
    if (day === marketParts(now.toISOString(), marketId).day) return t("when.today", { time });
    if (day === marketParts(new Date(now.getTime() - 86_400_000).toISOString(), marketId).day) return t("when.yday", { time });
    const short = new Intl.DateTimeFormat(locale === "ar" ? "ar-LY-u-nu-latn" : "fr-FR", { day: "numeric", month: "short", timeZone: "UTC" })
      .format(new Date(`${day}T12:00:00Z`));
    return t("when.other", { day: short, time });
  }, [marketId, locale, t]);

  const toggleMom = (m: FeedbackMoment) =>
    setMoms((cur) => {
      const next = new Set(cur);
      if (next.has(m)) next.delete(m); else next.add(m);
      return next;
    });

  const count = (k: FeedbackCategory | "all") => all.filter((r) => k === "all" || r.category === k).length;

  const filters = (
    <div className="seg-row">
      <div className="seg" role="tablist">
        {(["all", ...FEEDBACK_CATEGORIES] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={cat === k} className={cat === k ? "on" : ""} onClick={() => setCat(k)}>
            {k !== "all" && <i className={`dotk h-${VCAT[k].hue}`} />}
            {k === "all" ? t("all") : t(`cat.${k}`)}
            <em>{count(k)}</em>
          </button>
        ))}
      </div>
      <div className="moms">
        {FEEDBACK_MOMENTS.map((m) => (
          <button key={m} type="button" aria-pressed={moms.has(m)} className={`rc${moms.has(m) ? " on" : ""}`} onClick={() => toggleMom(m)}>
            {t(`moment.${m}`)}
          </button>
        ))}
      </div>
    </div>
  );

  const search = (
    <div className="tools">
      <label className="srch">
        <Ic n="search" />
        <input ref={searchRef} id="vq" type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("search")} autoComplete="off" />
        <span className="kbd2">/</span>
      </label>
    </div>
  );

  const catPill = (r: MyFeedbackRow) => <APill hue={VCAT[r.category].hue} icon={VCAT[r.category].icon} text={t(`cat.${r.category}`)} />;
  const statusPill = (r: MyFeedbackRow) => (r.status ? <span className={`pl h-${VST[r.status]}`}>{t(`status.${r.status}`)}</span> : null);
  const product = (r: MyFeedbackRow) =>
    r.product ? (
      <span className="vp"><Thumb src={r.product.image_url} seed={r.product.id} /><span dir="auto">{r.product.name}</span></span>
    ) : <span className="q">—</span>;
  const quote = (r: MyFeedbackRow) => <b dir="auto" data-testid="voc-words">« {r.body} »</b>;
  const empty = (
    <div className="empty"><Ic n="quote" /><b>{all.length ? t("noMatch") : t("empty")}</b></div>
  );

  if (phone) {
    return (
      <>
        <button type="button" className="btn" style={{ height: 46 }} onClick={() => openCapture(null)}>
          <Ic n="plus" />{t("phoneNew")}
        </button>
        <div className="hscroll">{filters}</div>
        {search}
        {error ? <div className="err">{t("error")}</div> : null}
        <div className="cards">
          {rows && !shown.length ? empty : null}
          {shown.map((r) => (
            <div key={r.id} className="vcard" data-testid="voc-card">
              <div className="pc1">{catPill(r)}<span className="tm">{when(r.created_at)}</span></div>
              {quote(r)}
              <small>{[topicLabel(r.topic_id), t(`moment.${r.moment}`)].filter(Boolean).join(" · ")}</small>
              <div className="pc1">{product(r)}{statusPill(r)}</div>
            </div>
          ))}
        </div>
      </>
    );
  }

  return (
    <>
      <header className="ph">
        <div>
          <h1>{t("title")}</h1>
          <div className="sub"><span>{t("sub")}</span></div>
        </div>
        <div className="acts">
          <button type="button" className="btn" onClick={() => openCapture(null)}>
            <Ic n="plus" />{t("new")}
            <span className="kbd2" style={{ background: "rgba(255,255,255,.18)", color: "#fff", borderColor: "transparent" }}>F</span>
          </button>
        </div>
      </header>
      {filters}
      {search}
      {error ? <div className="err">{t("error")}</div> : null}
      <section className="list" role="table" aria-label={t("title")}>
        <div className="lh vr" role="row">
          {(["date", "category", "words", "product", "moment", "status"] as const).map((c) => (
            <span key={c} role="columnheader">{t(`cols.${c}`)}</span>
          ))}
        </div>
        <div className="rows">
          {!rows && !error ? [0, 1, 2, 3].map((i) => <div key={i} className="sk-row" />) : null}
          {rows && !shown.length ? empty : null}
          {shown.map((r) => (
            <div key={r.id} className="row vr" role="row" data-testid="voc-row">
              <span className="tm" role="cell">{when(r.created_at)}</span>
              <span role="cell">{catPill(r)}</span>
              <span className="vw" role="cell">
                {quote(r)}
                <small>
                  {[topicLabel(r.topic_id), r.customer_name].filter(Boolean).map((s, i) => (
                    <span key={i}>{i ? " · " : ""}<span dir="auto">{s}</span></span>
                  ))}
                  {r.order_ref ? <> · <span className="num">#{r.order_ref}</span></> : null}
                  {!topicLabel(r.topic_id) && !r.customer_name && !r.order_ref ? "—" : null}
                </small>
              </span>
              <span role="cell">{product(r)}</span>
              <span className="q" role="cell" style={{ fontSize: 12.5, fontWeight: 600 }}>{t(`moment.${r.moment}`)}</span>
              <span role="cell">{statusPill(r) ?? <span className="q">—</span>}</span>
            </div>
          ))}
        </div>
        <div className="lfoot">{t("count", { shown: shown.length, total: all.length })}</div>
      </section>
    </>
  );
}

function topicName(topics: FeedbackTopic[], id: string | null, locale: string): string | null {
  const topic = id ? topics.find((x) => x.id === id) : null;
  if (!topic) return null;
  return locale === "ar" ? topic.label_ar : topic.label_fr;
}
