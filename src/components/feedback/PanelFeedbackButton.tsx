"use client";

import { useTranslations } from "next-intl";
import { Quote } from "lucide-react";
import { useFeedbackContext } from "@/hooks/useFeedback";
import { useFeedbackCapture } from "./FeedbackCaptureProvider";
import { Kbd } from "./atoms";

/**
 * The order panel's « Voix du client  F » button (prototype agent-v2, `.fbk`). The red count
 * is this customer's réclamations still open — the agent sees it before calling. Fetching the
 * context here also warms it for the capture window.
 */
export function PanelFeedbackButton({ orderId }: { orderId: string }) {
  const t = useTranslations("feedback.capture");
  const { openCapture } = useFeedbackCapture();
  const { context } = useFeedbackContext(orderId);
  const open = context?.history.open ?? 0;
  return (
    <button
      type="button"
      onClick={() => openCapture(orderId)}
      className="relative inline-flex h-8 items-center gap-[7px] whitespace-nowrap rounded-lg border border-[#D1D5DB] bg-white pe-2 ps-2.5 text-[13px] font-semibold text-[#374151] hover:bg-[#F9FAFB] max-lg:w-9 max-lg:justify-center max-lg:px-0"
    >
      <Quote size={15} className="text-[#6D28D9]" aria-hidden />
      <span className="max-lg:sr-only">{t("button")}</span>
      <span className="max-lg:hidden"><Kbd>F</Kbd></span>
      {open > 0 && (
        <span
          aria-label={t("openOnRow", { n: open })}
          className="absolute -top-[7px] -end-[7px] grid h-[18px] min-w-[18px] place-items-center rounded-full bg-[#EF4444] px-[5px] text-[11px] font-bold text-white shadow-[0_0_0_2px_#fff]"
        >
          {open}
        </span>
      )}
    </button>
  );
}
