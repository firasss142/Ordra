import type { ComplaintStatus, FeedbackCategory } from "@/lib/feedback/taxonomy";
import type { AgentHue } from "@/components/agent/shared";

/** Prototype `VCAT` — each category's hue and icon (agent-shell-v2, « 6 · Voix du client »). */
export const VCAT: Record<FeedbackCategory, { hue: AgentHue; icon: string }> = {
  reclamation: { hue: "red", icon: "alert" },
  objection: { hue: "amber", icon: "help" },
  suggestion: { hue: "blue", icon: "spark" },
};

/** Prototype `VST` — the read-only status of a complaint. */
export const VST: Record<ComplaintStatus, AgentHue> = { open: "red", in_progress: "amber", resolved: "green" };
