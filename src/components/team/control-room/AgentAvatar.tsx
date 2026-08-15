"use client";

import { useEffect, useState } from "react";
import { PRESENCE_COLOR, type PresenceState } from "@/lib/presence";
import { agentColor } from "@/lib/team/format";

interface Props {
  name: string;
  avatarUrl?: string | null;
  presence?: PresenceState | null;
  size?: number;
  /** Ghost = grey letter avatar for agents with nothing to say today. */
  ghost?: boolean;
}

export function AgentAvatar({ name, avatarUrl, presence, size = 30, ghost = false }: Props) {
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [avatarUrl]);
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  const showImg = !!avatarUrl && !errored;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }} aria-hidden="true">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl!}
          alt=""
          className="h-full w-full rounded-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        <span
          className="grid h-full w-full place-items-center rounded-full font-semibold text-white"
          style={{
            background: ghost ? "#EEF0F2" : agentColor(name),
            color: ghost ? "#6D7175" : "#FFFFFF",
            fontSize: Math.max(10, Math.round(size * 0.42)),
          }}
        >
          {initial}
        </span>
      )}
      {presence && (
        <span
          className="absolute -bottom-0.5 -end-0.5 rounded-full border-2 border-surface-card"
          style={{ width: 10, height: 10, background: PRESENCE_COLOR[presence] }}
        />
      )}
    </span>
  );
}
