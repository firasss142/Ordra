"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useAgentAvailability } from "@/hooks/useAgentAvailability";

/**
 * « Je prends des commandes ».
 *
 * Replaces the shell's old connection chip rather than sitting beside it. That
 * chip is green when the websocket is connected, which is not the same thing
 * as being available — two green dots in one header, each meaning a different
 * kind of "online", is how a manager ends up believing an agent is working.
 * Readiness is now the headline and the live connection is the sub-line.
 *
 * Drawn as a real track-and-knob switch, not a coloured dot. The control is
 * `role="switch"`, so it has to LOOK like one: a dot says "here is a state",
 * a knob says "here is a state you can change", and this is the only control
 * in the agent shell that decides whether work arrives at all.
 *
 * Geometry constraints this has to respect (measured in the shell redesign):
 *  - fixed width per breakpoint in FR and AR, or the trailing cluster shifts
 *    on every state change (Arabic moved 13px);
 *  - >= 44px hit area, which SettingToggle's 22px pill fails — the whole
 *    148/192px pill is the target, not just the knob;
 *  - not #15803D on #BBF7D0 (4.14:1). The label tones below are the darker
 *    #14532D / #8A4B0B pair; the brand green appears only as a FILL under the
 *    white knob, where no text sits on it. The sub-line is #6E6860 rather
 *    than the ink-3 token: ink-3 is 4.8:1 on the agent background and drops
 *    to 4.29:1 on the paused tint, i.e. under 4.5 at 10.5px.
 *  - the knob carries a hairline ring. A white knob on a light off-track is
 *    1.8:1 whatever grey you pick; the ring gives its edge a fixed contrast
 *    instead of borrowing it from the track.
 *
 * The knob is parked with logical `start-*` and transitioned, the idiom
 * SettingToggle already uses: `translate-x` would slide the wrong way in
 * Arabic, `inset-inline-start` mirrors for free.
 */

type Tone = "ready" | "stale" | "paused";

const TONES: Record<
  Tone,
  { shell: string; label: string; track: string; knobAt: string; ring: string }
> = {
  ready: {
    shell: "border-[#B7E4C7] bg-[#F1FAF4] hover:border-[#8DD3AC]",
    label: "text-[#14532D]",
    track: "bg-[#15803D]",
    knobAt: "start-[23px]",
    ring: "focus-visible:ring-[#15803D]",
  },
  stale: {
    shell: "border-[#F0D6A0] bg-[#FDF8EE] hover:border-[#E3C078]",
    label: "text-[#8A4B0B]",
    track: "bg-[#B45309]",
    knobAt: "start-[23px]",
    ring: "focus-visible:ring-[#B45309]",
  },
  paused: {
    shell: "border-agent-outline bg-agent-surface-low hover:border-[#C7C2BA]",
    label: "text-agent-on-surface-variant",
    track: "bg-[#A8A29A]",
    knobAt: "start-[3px]",
    ring: "focus-visible:ring-agent-on-surface-variant",
  },
};

export function AgentAvailabilityToggle({ live }: { live: boolean }) {
  const t = useTranslations("agentAvailability");
  const { availability, pending, setAvailable } = useAgentAvailability(true);
  const [released, setReleased] = useState<number | null>(null);

  const available = availability?.is_available ?? false;
  const receiving = availability?.receiving_orders ?? false;

  // Declared but not beating. Worth its own state: "I paused myself" and "my
  // session went quiet" need different answers from the agent.
  const stale = available && !receiving;
  const tone = TONES[available ? (stale ? "stale" : "ready") : "paused"];

  async function onToggle() {
    if (pending) return;
    const next = !available;
    const result = await setAvailable(next);
    if (!next && result && result.released > 0) {
      setReleased(result.released);
      setTimeout(() => setReleased(null), 6000);
    } else {
      setReleased(null);
    }
  }

  const label = available ? t("available") : t("paused");
  const sub = !available
    ? t("pausedSub")
    : stale
      ? t("staleSub")
      : live
        ? t("liveSub")
        : t("reconnectingSub");

  return (
    <div className="relative">
      <button
        type="button"
        role="switch"
        aria-checked={available}
        aria-busy={pending}
        aria-label={t("toggleLabel")}
        onClick={onToggle}
        disabled={pending}
        // Fixed per breakpoint: the label changes length between states and
        // between FR and AR, and a fluid width moves everything after it.
        // Phones drop the sub-line rather than the label — the narrow pill is
        // still a switch, just a terser one.
        className={`flex h-11 w-[148px] items-center gap-2.5 rounded-full border ps-3.5 pe-1.5 text-start transition-colors duration-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:cursor-wait sm:w-[192px] ${tone.shell} ${tone.ring}`}
      >
        <span className="flex min-w-0 flex-1 flex-col leading-tight">
          <span className={`truncate text-[12.5px] font-semibold ${tone.label}`}>{label}</span>
          <span className="hidden truncate text-[10.5px] text-[#6E6860] sm:block">{sub}</span>
        </span>

        <span
          data-track
          aria-hidden
          className={`relative h-[26px] w-[46px] shrink-0 rounded-full transition-colors duration-fast ${tone.track}`}
        >
          <span
            data-knob
            className={`absolute top-[3px] h-5 w-5 rounded-full bg-white shadow-hover-row ring-1 ring-black/10 transition-all duration-fast ${tone.knobAt}`}
          >
            {pending && (
              <span className="block h-full w-full animate-spin rounded-full border-2 border-agent-outline border-t-transparent" />
            )}
          </span>
        </span>
      </button>

      {released !== null && (
        <span
          role="status"
          className="absolute end-0 top-full z-50 mt-1.5 whitespace-nowrap rounded-full bg-agent-on-surface px-3 py-1.5 text-[11.5px] font-medium text-white shadow-hover-row"
        >
          {t("released", { count: released })}
        </span>
      )}
    </div>
  );
}
