/**
 * An agent's own colour — Salle de contrôle v6 (prototypes/team-v6.html) and
 * Performance: her card, her ring, her avatar, her table row, her drawer.
 * The database keeps the key (`users.color`, given by a trigger: the least-worn
 * hue of her market); the ramps live in globals.css as --agent-<key>-{0,1,2,5,7,9}.
 * Six hues validated together (dataviz validate_palette.js), docs/design-system.md §4.25.
 */
import type { CSSProperties } from "react";
import type { AgentColorKey } from "./room/types";

export const AGENT_COLORS: readonly { key: AgentColorKey; hex: string }[] = [
  { key: "indigo", hex: "#444CE7" },
  { key: "pink", hex: "#DD2590" },
  { key: "cyan", hex: "#088AB2" },
  { key: "gold", hex: "#CA8504" },
  { key: "lime", hex: "#4CA30D" },
  { key: "orange", hex: "#E04F16" },
];

const KEYS = new Set<string>(AGENT_COLORS.map((c) => c.key));

/** The saved colour; without one (an account the migration has not reached), a stable pick from her id. */
export function agentColorKey(color: string | null | undefined, agentId: string): AgentColorKey {
  if (color && KEYS.has(color)) return color as AgentColorKey;
  let h = 0;
  for (let i = 0; i < agentId.length; i++) h = (h * 31 + agentId.charCodeAt(i)) >>> 0;
  return AGENT_COLORS[h % AGENT_COLORS.length].key;
}

const STEPS = ["0", "1", "2", "5", "7", "9"] as const;

/** Her ramp as --a0…--a9, for every child of the element that wears it. */
export function agentColorVars(key: AgentColorKey): CSSProperties {
  return Object.fromEntries(STEPS.map((s) => [`--a${s}`, `var(--agent-${key}-${s})`])) as CSSProperties;
}
