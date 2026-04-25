import type { ContactOutcome } from "@/types/follow-up";

const OFFSETS_MS: Record<ContactOutcome, number | null> = {
  voicemail: 24 * 60 * 60 * 1000,
  no_answer:  4 * 60 * 60 * 1000,
  busy:       2 * 60 * 60 * 1000,
  other: null,
};

const DURATION_LABELS: Record<ContactOutcome, string | null> = {
  voicemail: "24h",
  no_answer: "4h",
  busy: "2h",
  other: null,
};

export function suggestNextContact(
  outcome: ContactOutcome,
  nowMs: number = Date.now()
): Date | null {
  const offset = OFFSETS_MS[outcome];
  return offset === null ? null : new Date(nowMs + offset);
}

export function suggestDurationLabel(outcome: ContactOutcome): string | null {
  return DURATION_LABELS[outcome];
}
