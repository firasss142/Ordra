"use client";

import { useEffect, useState } from "react";

/**
 * Agent avatar — the person's photo when we have one, otherwise a deterministic
 * hue per name so the same person keeps the same colour everywhere they appear
 * (row, facet menu, assignment picker). Unassigned is drawn as an empty slot
 * rather than a name, because it is the one state that wants acting on.
 *
 * The photo is the fallback's superior, not its replacement: most staff have no
 * avatar_url, so the initials path is the common case and has to look
 * deliberate rather than broken.
 */
export function AgentAvatar({
  name,
  size = 24,
  avatarUrl,
}: {
  name: string | null;
  size?: number;
  avatarUrl?: string | null;
}) {
  const [errored, setErrored] = useState(false);
  useEffect(() => setErrored(false), [avatarUrl]);

  const box = { width: size, height: size, fontSize: Math.round(size * 0.42) };

  if (!name) {
    return (
      <span
        aria-hidden
        style={box}
        className="grid shrink-0 place-items-center rounded-full border border-dashed border-oms-border-strong text-oms-ink-3"
      >
        +
      </span>
    );
  }

  if (avatarUrl && !errored) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatarUrl}
        alt=""
        aria-hidden
        width={size}
        height={size}
        style={{ ...box, objectFit: "cover" }}
        onError={() => setErrored(true)}
        className="shrink-0 rounded-full bg-oms-bg"
      />
    );
  }

  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const hue = hash % 360;

  return (
    <span
      aria-hidden
      style={{
        ...box,
        background: `linear-gradient(140deg, hsl(${hue} 55% 58%), hsl(${hue} 58% 42%))`,
      }}
      className="grid shrink-0 place-items-center rounded-full font-bold uppercase text-white"
    >
      {name.trim().slice(0, 2)}
    </span>
  );
}
