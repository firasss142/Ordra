"use client";

// « Je prends des commandes » (prototype `.avl` in the band, `.mavl` on a phone). Readiness is the
// headline, the live connection is the sub-line — two green dots meaning two kinds of « online » is
// how a manager ends up believing an agent is working (see docs/order-distribution.md).

import { useTranslations } from "next-intl";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";
import { useAgentToast } from "@/components/agent/shared";

export function AgentAvail({ live, variant }: { live: boolean; variant: "desk" | "phone" }) {
  const t = useTranslations("agent.avail");
  const toast = useAgentToast();
  const { availability, pending, setAvailable } = useAgentAvailability(true);
  const on = availability?.is_available ?? false;
  const stale = on && !(availability?.receiving_orders ?? false);

  async function flip() {
    if (pending) return;
    const next = !on;
    const res = await setAvailable(next);
    if (!res) return toast(t("failed"));
    toast(next ? t("toastOn") : t("toastOff", { n: res.released }));
  }

  const word = on ? t("on") : t("off");
  if (variant === "phone") {
    return (
      <button type="button" className={`mavl${on ? " on" : ""}`} role="switch" aria-checked={on} aria-busy={pending} aria-label={t("aria")} onClick={flip} disabled={pending}>
        <i />
        {word}
      </button>
    );
  }
  const sub = !on ? t("offSub") : stale ? t("staleSub") : live ? t("onSub") : t("reconnectSub");
  return (
    <button type="button" className={`avl${on ? " on" : ""}${stale || (on && !live) ? " warn" : ""}`} role="switch" aria-checked={on} aria-busy={pending} aria-label={t("aria")} title={sub} onClick={flip} disabled={pending}>
      <span className={`tog${on ? " on" : ""}`} />
      <span className="avt">
        <b>{word}</b>
        <small>{sub}</small>
      </span>
    </button>
  );
}
