"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Quote, Truck } from "lucide-react";
import { suggestFromRemark, suggestFromWords } from "@/lib/feedback/suggest";
import type { FeedbackCategory, FeedbackMoment } from "@/lib/feedback/taxonomy";
import type { FeedbackTopic } from "@/types/feedback";
import { CategoryCards, MomentRow, TopicChips } from "./atoms";

export interface FeedbackOfferState {
  on: boolean;
  category: FeedbackCategory | null;
  topicId: string | null;
}

/**
 * The offer's state. On by default (owner, 2026-10-01). The category and topic follow what
 * the words — or the courier's remark — point to, until the agent picks one themselves;
 * with nothing to go on, a refusal is an objection (« pourquoi il hésite ou refuse »).
 */
export function useFeedbackOffer({ topics, words, remark = null, remarkClass = null }: {
  topics: FeedbackTopic[];
  words: string | null | undefined;
  remark?: string | null;
  remarkClass?: string | null;
}) {
  const [on, setOn] = useState(true);
  const [picked, setPicked] = useState<{ category: FeedbackCategory | null; topicId: string | null } | null>(null);

  const suggestion = useMemo(
    () => suggestFromRemark(remarkClass, remark) ?? suggestFromWords(words),
    [remarkClass, remark, words],
  );
  const suggestedTopicId = suggestion?.topicKey
    ? topics.find((x) => x.category === suggestion.category && x.key === suggestion.topicKey)?.id ?? null
    : null;

  const state: FeedbackOfferState = picked
    ? { on, ...picked }
    : { on, category: suggestion?.category ?? "objection", topicId: suggestedTopicId };

  return {
    state,
    suggested: suggestion?.category ?? null,
    setOn,
    pickCategory: (category: FeedbackCategory | null) => setPicked({ category, topicId: null }),
    pickTopic: (topicId: string | null) => setPicked({ category: state.category, topicId }),
  };
}

export type FeedbackOfferHandle = ReturnType<typeof useFeedbackOffer>;

/**
 * « Pourquoi ? Garder ce que le client a dit » (Livraison) and « Garder aussi dans la voix du
 * client » (refus « Autre ») — prototype voix-du-client-agent-v2, screens ③ and ④. The
 * action's note becomes the customer's words; nothing is retyped.
 */
export function FeedbackOffer({ kind, offer, topics, remark = null, moment, status }: {
  kind: "delivery" | "reject";
  offer: FeedbackOfferHandle;
  topics: FeedbackTopic[];
  remark?: string | null;
  moment: FeedbackMoment;
  status: string | null;
}) {
  const t = useTranslations("feedback.offer");
  const { state } = offer;
  return (
    <div className="mt-3.5 rounded-[14px] border border-[#DDD6FE] bg-[#FAF8FF] px-3.5 py-3">
      <div className="flex items-start gap-3">
        <Quote size={18} className="mt-0.5 shrink-0 text-[#6D28D9]" aria-hidden />
        <div>
          <b className="block text-[14.5px]">{kind === "delivery" ? t("deliveryTitle") : t("rejectTitle")}</b>
          <span className="text-[13px] text-[#6B7280]">{kind === "delivery" ? t("deliverySub") : t("rejectSub")}</span>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={state.on}
          aria-label={kind === "delivery" ? t("deliveryTitle") : t("rejectTitle")}
          onClick={() => offer.setOn(!state.on)}
          className={`relative ms-auto h-6 w-[42px] shrink-0 rounded-full transition-colors ${state.on ? "bg-[#15803D]" : "bg-[#D1D5DB]"}`}
        >
          <span
            aria-hidden
            className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-white shadow-[0_1px_2px_rgba(0,0,0,0.2)] transition-[inset-inline-start] ${state.on ? "start-[21px]" : "start-[3px]"}`}
          />
        </button>
      </div>
      {state.on && (
        <>
          {remark && (
            <div className="mt-2 flex items-start gap-2.5 rounded-[10px] border border-dashed border-[#CBD5E1] bg-[#F8FAFC] px-3 py-2.5 text-[13px] text-[#334155]">
              <Truck size={16} className="mt-px shrink-0 text-[#475569]" aria-hidden />
              <div>
                {t("courierSaid")}
                <span className="mt-0.5 block text-[14px] font-semibold text-[#111827] [unicode-bidi:plaintext]">« {remark} »</span>
              </div>
            </div>
          )}
          <div className="mt-3">
            <CategoryCards value={state.category} onChange={offer.pickCategory} suggested={offer.suggested} compact />
          </div>
          {state.category && (
            <div className="mt-2.5">
              <TopicChips category={state.category} topics={topics} value={state.topicId} onChange={offer.pickTopic} />
            </div>
          )}
          <MomentRow moment={moment} status={status} />
          {kind === "reject" && offer.suggested && (
            <p className="m-0 mt-2 text-[12.5px] text-[#6B7280]">{t("rejectHint")}</p>
          )}
        </>
      )}
    </div>
  );
}
