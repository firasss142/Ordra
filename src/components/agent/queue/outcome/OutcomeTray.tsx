"use client";

/**
 * The step an ending opens (prototype `trayHTML`): « Pourquoi ? », « Programmer un rappel »,
 * « Choisir le transporteur », « Programmer la livraison ». Inside the order on a desktop
 * (it replaces the notes and the footer — plan decision 1), inside the sheet on a phone.
 */

import { useTranslations } from "next-intl";
import dynamic from "next/dynamic";
import { Ic } from "@/components/agent/shared";
import { formatDisplayCurrencyCode } from "@/lib/markets";
import { deliveryDelay, groupIcon, type Tray } from "./outcome-model";
import type { OutcomeFlow } from "./useOutcomeFlow";

const DexpressLocationPicker = dynamic(
  () => import("@/components/queue/DexpressLocationPicker").then((m) => m.DexpressLocationPicker),
  { ssr: false },
);

function Head({ hue, icon, title, sub, onClose, closeLabel }: { hue: string; icon: string; title: string; sub?: string; onClose: () => void; closeLabel: string }) {
  return (
    <div className="tray-h">
      <span className={`hold h-${hue}`}>
        <Ic n={icon} />
      </span>
      <span className="tt">
        <b>{title}</b>
        {sub ? <small>{sub}</small> : null}
      </span>
      <button type="button" className="xbtn" onClick={onClose} aria-label={closeLabel}>
        <Ic n="x" />
      </button>
    </div>
  );
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <div className="note h-red" role="alert">
      <Ic n="alert" />
      <span>{text}</span>
    </div>
  );
}

export function OutcomeTray({ flow }: { flow: OutcomeFlow }) {
  const t = useTranslations("agentOutcome");
  const tCov = useTranslations("dispatch.coverage");
  const step: Tray | null = flow.tray;
  if (!step) return null;
  const busy = flow.busy !== null;
  const closeLabel = t("reject.cancel");

  if (step === "reject") {
    const r = flow.reject;
    const G = r.groups.find((g) => g.key === r.group) ?? null;
    return (
      <div className="tray" data-tray="reject">
        <Head hue="red" icon="thumbdown" title={t("reject.title")} sub={flow.atMax ? t("reject.subMax") : t("reject.sub")} onClose={flow.dismiss} closeLabel={closeLabel} />
        <div className="rgs" role="radiogroup" aria-label={t("reject.title")}>
          {r.groups.map((g) => (
            <button key={g.key} type="button" role="radio" aria-checked={r.group === g.key} className={`rgc${r.group === g.key ? " on" : ""}`} onClick={() => r.chooseGroup(g.key)}>
              <span className="hold h-red">
                <Ic n={groupIcon(g.key)} />
              </span>
              <span>
                <b>{g.label}</b>
                {g.hint ? <small>{g.hint}</small> : null}
              </span>
            </button>
          ))}
        </div>
        {G && G.subs.length > 0 && !G.noteOnly ? (
          <div className="rg">
            <h6>{t("reject.precise")}</h6>
            <div className="rch h-red" role="radiogroup" aria-label={t("reject.precise")}>
              {G.subs.map((s) => (
                <button key={s.key} type="button" role="radio" aria-checked={r.sub === s.key} className={`rc${r.sub === s.key ? " on" : ""}`} onClick={() => r.setSub(s.key)}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {G?.noteOnly ? (
          <textarea className="inp" placeholder={t("reject.note")} aria-label={t("reject.note")} dir="auto" value={r.note} onChange={(e) => r.setNote(e.target.value)} autoFocus />
        ) : null}
        <button type="button" className="later" onClick={() => flow.openTray("callback")}>
          <Ic n="clock" />
          <span>
            <b>{t("reject.later")}</b>
            <small>{t("reject.laterHint")}</small>
          </span>
          <Ic n="right" className="flip" />
        </button>
        {r.offering ? (
          <label className="keepv">
            <input type="checkbox" checked={r.offer.state.on} onChange={(e) => r.offer.setOn(e.target.checked)} /> {t("reject.keep")}
          </label>
        ) : null}
        <ErrorLine text={flow.error} />
        <div className="trayf">
          <button type="button" className="fa" onClick={flow.dismiss}>
            {t("reject.cancel")}
          </button>
          <button type="button" className="fa pri wide red" disabled={!r.ready || busy} onClick={() => void r.submit()}>
            <Ic n="xcircle" />
            <span>{flow.busy === "reject" ? t("sheet.saving") : t("reject.submit")}</span>
          </button>
        </div>
      </div>
    );
  }

  if (step === "callback") {
    const c = flow.callback;
    const slotWords = (k: string, at: Date): [string, string] => {
      const time = flow.cbWhen(at);
      if (k === "in2h") return [t("callback.in2h"), /^\d/.test(time) ? t("when.today", { time }) : time];
      if (k === "tonight") return [t("callback.tonight"), time];
      return [t("callback.tomorrow"), time.replace(/^\D+/, "")];
    };
    return (
      <div className="tray" data-tray="callback">
        <Head hue="violet" icon="clock" title={t("callback.title")} sub={t("callback.sub")} onClose={flow.dismiss} closeLabel={closeLabel} />
        <div className="times" role="radiogroup" aria-label={t("callback.title")}>
          {c.slots.map((s) => {
            const [a, b] = slotWords(s.key, s.at);
            return (
              <button key={s.key} type="button" role="radio" aria-checked={c.pick === s.key} className={`tm2${c.pick === s.key ? " on" : ""}`} onClick={() => c.setPick(s.key)}>
                <b>{a}</b>
                <small>{b}</small>
              </button>
            );
          })}
          <label className={`tm2 dt${c.pick === "custom" ? " on" : ""}`}>
            <small>{t("callback.other")}</small>
            <input
              className="inp"
              type="datetime-local"
              aria-label={t("callback.other")}
              value={c.custom}
              onChange={(e) => {
                c.setCustom(e.target.value);
                c.setPick("custom");
              }}
              onFocus={() => c.setPick("custom")}
            />
          </label>
        </div>
        <ErrorLine text={flow.error} />
        <div className="trayf">
          <button type="button" className="fa" onClick={flow.dismiss}>
            {t("reject.cancel")}
          </button>
          <button type="button" className="fa pri wide violet" disabled={!c.chosenAt || busy} onClick={() => void c.submit()}>
            <Ic n="clock" />
            <span>{c.chosenAt ? t("callback.submitAt", { time: flow.cbWhen(c.chosenAt) }) : t("callback.submit")}</span>
          </button>
        </div>
      </div>
    );
  }

  // send + schedule share the carrier cards
  const s = flow.send;
  const ch = s.carriers;
  const ccy = formatDisplayCurrencyCode(flow.order.currency, flow.order.marketId);
  const cards = ch.loading ? (
    <p className="q">{t("send.loading")}</p>
  ) : ch.cards.length === 0 ? (
    <div className="note h-amber">
      <Ic n="alert" />
      <span>{t("send.none")}</span>
    </div>
  ) : (
    <div className="carr" role="radiogroup" aria-label={t("send.title")}>
      {ch.cards.map((c) => {
        const blocked = c.coverage === "uncovered";
        const delay = deliveryDelay(c.transitHours);
        const rate = c.deliveryRate == null ? t("send.unknown") : t("send.rate", { n: Math.round(c.deliveryRate * 100) });
        const delayText = delay ? t(delay.unit === "days" ? "send.days" : "send.hours", { n: delay.n }) : t("send.unknown");
        return (
          <button key={c.id} type="button" role="radio" aria-checked={ch.selected === c.id} disabled={blocked} className={`cr2${ch.selected === c.id ? " on" : ""}`} onClick={() => ch.select(c.id)}>
            <span className="rd" />
            <span>
              <b>
                {c.name}
                {c.best ? (
                  <span className="best">
                    <Ic n="star" />
                    {t("send.best")}
                  </span>
                ) : null}
              </b>
              <small>{blocked ? tCov("notCovered", { city: ch.order?.customer_city ?? "" }) : t("send.stats", { rate, delay: delayText })}</small>
            </span>
            {c.cost != null ? (
              <span className="amt">
                {Math.round(c.cost)}
                <small>{ccy}</small>
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );

  if (step === "schedule") {
    const sc = flow.schedule;
    const carrier = ch.selectedCard?.name ?? "—";
    return (
      <div className="tray" data-tray="schedule">
        <Head hue="violet" icon="cal" title={t("schedule.title")} sub={t("schedule.sub")} onClose={flow.dismiss} closeLabel={closeLabel} />
        <div className="two">
          <input className="inp" type="date" aria-label={t("schedule.date")} value={sc.date} onChange={(e) => sc.setDate(e.target.value)} />
          <input className="inp" type="time" aria-label={t("schedule.time")} value={sc.time} onChange={(e) => sc.setTime(e.target.value)} />
        </div>
        <label className="keepv">
          <input type="checkbox" checked={sc.auto} onChange={(e) => sc.setAuto(e.target.checked)} /> {t("schedule.auto")}
        </label>
        {cards}
        {!Number.isNaN(sc.at.getTime()) ? (
          <p className="q" style={{ fontSize: 12.5, margin: 0 }}>
            {t("schedule.will", { when: flow.cbWhen(sc.at), carrier })}
          </p>
        ) : null}
        <ErrorLine text={flow.error} />
        <div className="trayf">
          <button type="button" className="fa" onClick={flow.back}>
            <Ic n="left" className="flip" />
            <span>{t("schedule.back")}</span>
          </button>
          <button type="button" className="fa pri wide" disabled={busy} onClick={() => void sc.submit()}>
            <Ic n="cal" />
            <span>{flow.busy === "schedule" ? t("sheet.saving") : t("schedule.submit")}</span>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="tray" data-tray="send">
      {flow.justConfirmed ? (
        <div className="note h-green" role="status">
          <Ic n="check" />
          <span>{t("done.confirmed")}</span>
        </div>
      ) : null}
      <Head hue="teal" icon="truck" title={t("send.title")} sub={t("send.sub")} onClose={flow.dismiss} closeLabel={closeLabel} />
      {flow.order.twin ? (
        <div className="note h-amber">
          <Ic n="copy" />
          <span>{t("send.dup")}</span>
        </div>
      ) : null}
      {cards}
      {s.needState ? (
        <div className="rg">
          <h6>{t("send.pickState")}</h6>
          <DexpressLocationPicker value={s.dexState} onChange={s.setDexState} />
        </div>
      ) : null}
      {s.dupAsk ? (
        <div className="note h-amber" role="alert">
          <Ic n="copy" />
          <span>{t("send.dup")}{s.dupAsk.externalId ? ` · #${s.dupAsk.externalId}` : ""}</span>
          <button type="button" className="lnk" onClick={() => void s.submit(true)}>
            {t("send.dupConfirm")}
          </button>
        </div>
      ) : null}
      <ErrorLine text={flow.error} />
      <div className="trayf">
        <button type="button" className="fa" onClick={flow.dismiss}>
          {t("send.later")}
        </button>
        <button type="button" className="fa" onClick={() => flow.openTray("schedule")}>
          <Ic n="cal" />
          <span>{t("send.schedule")}</span>
        </button>
        <button
          type="button"
          className="fa pri wide"
          disabled={busy || (s.needState && s.dexState.stateId === null)}
          onClick={() => void s.submit()}
        >
          <Ic n="truck" />
          <span>{flow.busy === "dispatch" ? t("send.sending") : t("send.now")}</span>
        </button>
      </div>
    </div>
  );
}
