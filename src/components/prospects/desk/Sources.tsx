"use client";

/**
 * One card per source (owner's pick: « where its prospects are »): a bar
 * brought back → in progress → to call → lost, the counts under it, and what
 * it delivered — its share of the band's answer.
 */
import { useTranslations } from "next-intl";
import { List, PhoneOff, Repeat, Undo2 } from "lucide-react";
import type { DeskView } from "@/lib/prospects/desk/model";
import type { DeskSource, DeskState, RecoverySettings } from "@/lib/prospects/desk/types";
import { fmtMoney, fmtNum } from "./format";

export const SOURCE_ICON: Record<DeskSource, typeof List> = { rej: PhoneOff, ret: Undo2, old: Repeat, camp: List };
const SEG_COLOR: Record<DeskState, string> = { won: "var(--o-won)", in_progress: "var(--o-work)", to_call: "var(--o-call)", lost: "var(--o-lost)" };

export function Sources({ view, settings, selected, onToggle, locale, marketId }: {
  view: DeskView; settings: RecoverySettings; selected: DeskSource[]; onToggle: (s: DeskSource) => void; locale: string; marketId: string;
}) {
  const t = useTranslations("prospects.desk.sources");
  const ruleOf = (k: DeskSource) => k === "rej" ? t("rules.rej", { days: settings.rej.delay_days }) : k === "old" ? t("rules.old", { days: settings.old.after_days }) : t(`rules.${k}`);
  return (
    <>
      <div className="sh"><h2>{t("title")}</h2><small>{t("hint")}</small></div>
      <section className="srcs">
        {view.sources.map((s) => {
          const Icon = SOURCE_ICON[s.key];
          const on = selected.includes(s.key);
          const dim = selected.length > 0 && !on;
          return (
            <button key={s.key} type="button" className={`card src${on ? " on" : ""}${dim ? " dim" : ""}`} aria-pressed={on} onClick={() => onToggle(s.key)}>
              <span className="flt">{t("filter")}</span>
              <div className="top"><span className="si"><Icon className="ic" /></span><div><h3>{t(`names.${s.key}`)}</h3><p className="rule">{ruleOf(s.key)}</p></div></div>
              <div className="tot"><b className="num" style={s.created ? undefined : { color: "var(--ink-4)" }}>{fmtNum(s.created, locale)}</b><span>{t("thisMonth")}</span></div>
              <div className="bar">
                {s.segments.filter((g) => g.n > 0).map((g) => (
                  <i key={g.key} style={{ width: `${g.share * 100}%`, background: SEG_COLOR[g.key] }} data-tip={`${g.n} ${t(`seg.${g.key}`)} — ${t(`segTip.${g.key}`)}`} />
                ))}
              </div>
              <div className="cap">
                {s.segments.map((g) => (
                  <span key={g.key} className={`${g.key === "won" ? "won" : ""}${g.n ? "" : " zero"}`}>
                    <i style={{ background: SEG_COLOR[g.key] }} /><b className="num">{fmtNum(g.n, locale)}</b> {t(`seg.${g.key}`)}
                  </span>
                ))}
              </div>
              <div className="foot" data-tip={t("deliveredTip", { won: s.won, n: s.delivered })}>
                <span>{t.rich("delivered", { n: s.delivered, b: (c) => <b>{c}</b> })}</span>
                <span className="num"><bdi>{fmtMoney(s.revenue, locale, marketId)}</bdi></span>
              </div>
            </button>
          );
        })}
      </section>
    </>
  );
}
