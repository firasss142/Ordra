"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertCircle, ArrowRight, Check, ChevronDown, Info, MessageSquareQuote, Plus, Store } from "lucide-react";
import { spanDays } from "@/lib/feedback/date-range";
import type { FeedbackOverviewResponse, FeedbackReason } from "@/types/feedback";
import { catStyle, pct, Thumb, topicLabel, Trend } from "./parts";

interface Props {
  overview: FeedbackOverviewResponse;
  periodLabel: string;
  /** The reason open under the list; the first one until the manager picks another. */
  openId: string | null;
  onOpen: (topicId: string | null) => void;
  onOpenComplaint: () => void;
  onCheck: () => void;
  onSeeAll: (topicId: string) => void;
  onSaveAnswer: (topicId: string, text: string) => Promise<void>;
}

const b = (chunks: React.ReactNode) => <b className="num">{chunks}</b>;

/**
 * « Raisons » — prototype voix-du-client-et-messages-v2, `reasonsView2()`. One sentence and a
 * to-do line, then one ranked list per section; a reason opens on click to show what customers
 * said, the products it is mostly about and « Notre réponse ».
 */
export function ReasonsView({ overview, periodLabel, openId, onOpen, onOpenComplaint, onCheck, onSeeAll, onSaveAnswer }: Props) {
  const t = useTranslations("feedback.voice");
  const locale = useLocale();
  const ar = locale.startsWith("ar");
  const name = (id: string) => topicLabel(overview.topics, id, locale) ?? id;
  const obj = overview.kpis.find((k) => k.category === "objection")?.count ?? 0;
  const sug = overview.kpis.find((k) => k.category === "suggestion")?.count ?? 0;
  const top = overview.reasons[0];
  const topName = top ? name(top.topicId) : "";
  const reasonInSentence = ar ? topName : topName.charAt(0).toLocaleLowerCase(locale) + topName.slice(1);
  const days = spanDays(overview.from, overview.to);

  return (
    <>
      <section className="card pad">
        <p className="lede2">
          {overview.total === 0
            ? t("ledeEmpty")
            : top
              ? t.rich("lede", { total: overview.total, obj, reason: reasonInSentence, b })
              : t.rich("ledeNoReason", { total: overview.total, obj, b })}
        </p>
        <div className="todo2">
          {overview.complaints.open > 0 && (
            <button type="button" className="red" onClick={onOpenComplaint}>
              <AlertCircle className="ic" aria-hidden />
              <span>{t.rich("todoOpen", { n: overview.complaints.open, b })}</span>
              <ArrowRight className="ic sm" aria-hidden />
            </button>
          )}
          <button type="button" onClick={onCheck}>
            <Info className="ic" aria-hidden />
            <span>{t.rich("todoCheck", { n: overview.toCheck, b })}</span>
            <ArrowRight className="ic sm" aria-hidden />
          </button>
          <span className="meta" style={{ marginInlineStart: "auto" }}>
            {overview.hasPrev ? t("compared", { period: periodLabel, days }) : t("notCompared", { period: periodLabel })}
          </span>
        </div>
      </section>

      <div className="h2"><h2>{t("hLose")}</h2><p>{t("hLoseSub", { n: obj })}</p></div>
      <ReasonList items={overview.reasons} gone={overview.gone} total={obj} days={days} name={name}
        openId={openId} onOpen={onOpen} onSeeAll={onSeeAll} onSaveAnswer={onSaveAnswer} />

      <div className="h2"><h2>{t("hWant")}</h2><p>{t("hWantSub", { n: sug })}</p></div>
      <ReasonList items={overview.wants} gone={overview.wantsGone} total={sug} days={days} name={name}
        openId={openId} onOpen={onOpen} onSeeAll={onSeeAll} onSaveAnswer={onSaveAnswer} />
    </>
  );
}

function ReasonList({ items, gone, total, days, name, openId, onOpen, onSeeAll, onSaveAnswer }: {
  items: FeedbackReason[];
  gone: FeedbackReason[];
  total: number;
  days: number;
  name: (id: string) => string;
  openId: string | null;
  onOpen: (topicId: string | null) => void;
  onSeeAll: (topicId: string) => void;
  onSaveAnswer: (topicId: string, text: string) => Promise<void>;
}) {
  const t = useTranslations("feedback.voice");
  const locale = useLocale();
  const max = items[0]?.count ?? 1;
  return (
    <section className="card rlist">
      {items.length === 0 && <div className="rempty">{t("noReasons")}</div>}
      {items.map((r, i) => {
        const on = openId === r.topicId;
        return (
          <ReasonRow key={r.topicId} r={r} rank={i + 1} on={on} max={max} total={total} label={name(r.topicId)} locale={locale}
            onToggle={() => onOpen(on ? null : r.topicId)} onSeeAll={() => onSeeAll(r.topicId)}
            onSaveAnswer={(text) => onSaveAnswer(r.topicId, text)} />
        );
      })}
      {gone.length > 0 && (
        <div className="rgone">{t("gone", { days, list: gone.map((g) => name(g.topicId)).join(" · ") })}</div>
      )}
    </section>
  );
}

function ReasonRow({ r, rank, on, max, total, label, locale, onToggle, onSeeAll, onSaveAnswer }: {
  r: FeedbackReason;
  rank: number;
  on: boolean;
  max: number;
  total: number;
  label: string;
  locale: string;
  onToggle: () => void;
  onSeeAll: () => void;
  onSaveAnswer: (text: string) => Promise<void>;
}) {
  const t = useTranslations("feedback.voice");
  return (
    <>
      <button type="button" className="rrow" aria-expanded={on} onClick={onToggle} style={catStyle(r.category)}>
        <span className="rank num">{rank}</span>
        <span className="rn">
          <b>{label}</b>
          {r.response && !on && <small><Check className="ic" aria-hidden />{t("ourAnswer")}</small>}
        </span>
        <span className="bt" title={pct(r.count, total, locale)}><i style={{ width: `${(r.count * 100) / max}%` }} /></span>
        <span className="bn num">{r.count}</span>
        <span className="bd"><Trend n={r.count} prev={r.prev} category={r.category} /></span>
        <ChevronDown className="ic chv" aria-hidden />
      </button>
      {on && (
        <div className="rdet" style={catStyle(r.category)}>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}><MessageSquareQuote className="ic" aria-hidden />{t("said")}</div>
            <div className="quotes">
              {r.quotes.map((q) => (
                <div key={q.id} className="q">
                  <p>{q.body}</p>
                  <small>{t("saidTo", { who: q.source === "courier" ? t("courier") : q.author ?? t("someone"), moment: t(`momentLong.${q.moment}`) })}</small>
                </div>
              ))}
            </div>
            <button type="button" className="seeall" onClick={onSeeAll}>
              {t("seeAll", { n: r.count })} <ArrowRight className="ic" aria-hidden />
            </button>
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}><Store className="ic" aria-hidden />{t("mostlyOn")}</div>
            <div className="prods">
              {r.products.map((p) => (
                <div key={p.id} className="pr sm"><Thumb id={p.id} url={p.imageUrl} small /><span>{p.label}</span><b className="num">{p.count}</b></div>
              ))}
            </div>
            <Answer response={r.response} onSave={onSaveAnswer} />
          </div>
        </div>
      )}
    </>
  );
}

/** « Notre réponse » — read, write, edit. */
function Answer({ response, onSave }: { response: string | null; onSave: (text: string) => Promise<void> }) {
  const t = useTranslations("feedback.voice");
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(response ?? "");
  const [busy, setBusy] = useState(false);

  if (editing) {
    return (
      <form className="ans-form" onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try { await onSave(text); setEditing(false); } finally { setBusy(false); }
      }}>
        <textarea value={text} maxLength={500} autoFocus placeholder={t("answerPlaceholder")} aria-label={t("ourAnswer")}
          onChange={(e) => setText(e.target.value)} />
        <div className="row">
          <button type="button" className="btn ghost" onClick={() => { setText(response ?? ""); setEditing(false); }}>{t("cancel")}</button>
          <button type="submit" className="btn pri" disabled={busy}>{t("save")}</button>
        </div>
      </form>
    );
  }
  if (response) {
    return (
      <div className="ans">
        <div className="eyebrow"><Check className="ic" aria-hidden />{t("ourAnswer")}</div>
        <p>{response}</p>
        <button type="button" className="edit" onClick={() => { setText(response); setEditing(true); }}>{t("editAnswer")}</button>
      </div>
    );
  }
  return (
    <button type="button" className="ans-add" onClick={() => setEditing(true)}>
      <Plus className="ic" aria-hidden />{t("writeAnswer")}
    </button>
  );
}
