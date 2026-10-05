"use client";

/**
 * The prototype's format helpers for « Prospects » — `ageLong`, `cbWhen`, `whenText`, `fnum`,
 * `CCY`, and the words of the chip, its sentence and the next move's reason — over next-intl.
 */
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { marketParts, useWhen } from "@/components/orders/commandes/ui";
import { marketIdToCode } from "@/lib/markets";
import { formatPhone } from "@/lib/prospects/presentation";
import { ageParts, type Line, type Sit, type Why } from "./crm-model";

export function useCrmWords(marketId: string | null, locale: string) {
  const t = useTranslations("agentCrm");
  const when = useWhen(marketId, locale);
  const code = marketIdToCode(marketId) ?? "ly";

  const age = useCallback((minutes: number) => {
    const p = ageParts(minutes);
    return t(`age.${p.key}`, p.values);
  }, [t]);

  /** `cbWhen`: « 18:30 » today, « demain 10:00 », else the full `whenText`. */
  const cbWhen = useCallback((iso: string) => {
    const now = new Date();
    const day = marketParts(iso, marketId).day;
    if (day === marketParts(now.toISOString(), marketId).day) return when(iso, { short: true });
    if (day === marketParts(new Date(now.getTime() + 86_400_000).toISOString(), marketId).day) {
      return t("tomorrow", { time: marketParts(iso, marketId).time });
    }
    return when(iso);
  }, [marketId, t, when]);

  /** `fnum` — grouped by spaces; isolated in Arabic so the digit groups keep their order. */
  const fnum = useCallback((n: number) => {
    const s = n.toLocaleString("fr-FR", { maximumFractionDigits: code === "tn" ? 3 : 0 }).replace(/\s/g, " ");
    return locale === "ar" ? `⁦${s}⁩` : s;
  }, [code, locale]);

  const sitText = useCallback((s: Sit) => {
    switch (s.key) {
      case "hot": case "cbLate": return t(`sit.${s.key}`, { age: age(s.minutes ?? 0) });
      case "cbAt": return t("sit.cbAt", { when: cbWhen(s.at ?? "") });
      case "retry": return t("sit.retry", { n: s.n ?? 0 });
      case "won": return t("sit.won", { ref: s.ref ?? "" });
      default: return t(`sit.${s.key}`);
    }
  }, [t, age, cbWhen]);

  const lineNode = useCallback((l: Line): ReactNode => {
    if (!l) return null;
    if ("quote" in l) return <span dir="auto">« {l.quote} »</span>;
    switch (l.key) {
      case "replied": case "retry": case "won": return t(`line.${l.key}`, { age: age(l.minutes) });
      case "campaign": {
        const sent = l.days === null || l.days === 0 ? null : l.days === 1 ? t("line.sentYday") : t("line.sentDays", { d: l.days });
        return [l.name, sent].filter(Boolean).join(" · ") || null;
      }
      case "winback": return t("line.winback", { why: l.why.toLowerCase() });
      default: return t(`line.${l.key}`);
    }
  }, [t, age]);

  const whyText = useCallback((w: Why) => {
    switch (w.key) {
      case "hot": return t("why.hot", { age: age(w.minutes ?? 0) });
      case "cbLate": return t("why.cbLate", { time: when(w.at ?? "", { short: true }) });
      case "cbAt": return t("why.cbAt", { when: cbWhen(w.at ?? "") });
      case "retry": return t("why.retry", { n: w.n ?? 0 });
      case "winback": return t("why.winback", { why: (w.why ?? "").toLowerCase() });
      case "won": return t("why.won", { ref: w.ref ?? "—" });
      default: return t(`why.${w.key}`);
    }
  }, [t, age, cbWhen, when]);

  return useMemo(() => ({
    t, when, age, cbWhen, fnum, sitText, lineNode, whyText, code,
    ccy: t(`ccy.${code}`),
    phone: (p: string) => formatPhone(p),
  }), [t, when, age, cbWhen, fnum, sitText, lineNode, whyText, code]);
}

export type CrmWords = ReturnType<typeof useCrmWords>;
