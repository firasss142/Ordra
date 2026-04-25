import type { KanbanAccent } from "@/components/shared/KanbanBoard";

export type AgeBucket = "fresh" | "warning" | "urgent" | "critical";

const MIN = 60 * 1000;
const HOUR = 60 * MIN;

export function getAgeBucket(createdAt: string, now: Date = new Date()): AgeBucket {
  const ageMs = now.getTime() - new Date(createdAt).getTime();
  if (ageMs < 30 * MIN) return "fresh";
  if (ageMs < 2 * HOUR) return "warning";
  if (ageMs < 4 * HOUR) return "urgent";
  return "critical";
}

const BUCKET_ACCENT: Record<AgeBucket, KanbanAccent> = {
  fresh: "neutral",
  warning: "action",
  urgent: "warning",
  critical: "critical",
};

export function getBucketAccent(bucket: AgeBucket): KanbanAccent {
  return BUCKET_ACCENT[bucket];
}

export const AGE_BUCKET_ORDER: AgeBucket[] = ["critical", "urgent", "warning", "fresh"];
