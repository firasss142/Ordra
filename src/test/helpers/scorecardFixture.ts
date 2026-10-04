import type { Scorecard, ScorecardCarrier, ScorecardWeek } from "@/lib/carriers/scorecard/types";

/**
 * A Libyan scorecard shaped like the approved prototype
 * (prototypes/transporteurs-v2.html, 30 days to 2026-10-03): Darb Tripoli and
 * Darb Benghazi, plus the dormant Dexpress account.
 */
export const LY = "00000000-0000-0000-0000-000000000002";
export const TRI = "4f1271c8-b1f2-4836-9293-8ab3d0b18e69";
export const BEN = "43077d36-3d61-40d6-ae35-59ed15cec8f7";
export const DEX = "ec7a79bf-3f17-45c2-bf6c-d4c3f2667fd2";

const WEEKS = ["2026-07-06", "2026-07-13", "2026-07-20", "2026-07-27", "2026-08-03", "2026-08-10", "2026-08-17", "2026-08-24",
  "2026-08-31", "2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"];
const weeks = (rows: [number, number, number][]): ScorecardWeek[] =>
  rows.map(([d, f, m], i) => ({ week: WEEKS[i], delivered: d, failed: f, in_flight: m }));

export function tripoli(over: Partial<ScorecardCarrier> = {}): ScorecardCarrier {
  return {
    id: TRI, name: "Darb Assabil - Tripoli", code: "darb_assabil", accent_color: "#1F5FBF",
    account_label: { fr: "Tripoli", ar: "طرابلس" }, first_upload_at: "2026-07-06T09:00:00Z", last_upload_at: "2026-10-02T09:00:00Z",
    has_reasons: true, has_attempts: true,
    period: { sent: 369, delivered: 178, failed: 172, in_flight: 19, prev_delivered: 51, prev_failed: 49,
      picked: 360, picked_fast: 274, first_attempt: 71, median_days: 1.2, fast3: 139 },
    weeks: weeks([[1, 3, 19], [0, 0, 0], [0, 0, 0], [0, 0, 0], [50, 35, 9], [48, 44, 3], [17, 23, 0], [28, 23, 0], [34, 40, 0],
      [44, 40, 1], [43, 51, 0], [41, 36, 8], [19, 11, 8]]),
    open: { total: 16, not_picked: 1, b0_2: 5, b3_4: 2, b5_9: 8, b10p: 0, late: 11, stuck: 3 },
    returns: { failed: 462, handed_back: 444, scanned: 0, out: 18, out_late: 0, age_lt7: 52, age_7_30: 114, age_30p: 278, within7: 255, median_days: 6 },
    reasons: [
      { class: "no_answer", n: 116 }, { class: "customer_cancelled", n: 72 }, { class: "not_needed", n: 32 }, { class: "other", n: 27 },
      { class: "not_serious", n: 19 }, { class: "out_of_coverage", n: 15 }, { class: "wrong_item", n: 11 }, { class: "no_cash", n: 6 },
    ],
    cities: [
      { city: "طرابلس", delivered: 93, failed: 126, median_days: 0.9 }, { city: "بنغازي", delivered: 48, failed: 31, median_days: 2.1 },
      { city: "سبها", delivered: 38, failed: 26, median_days: 2.6 }, { city: "مصراتة", delivered: 30, failed: 16, median_days: 2 },
      { city: "الخمس", delivered: 26, failed: 12, median_days: 1.2 }, { city: "الزاوية", delivered: 13, failed: 11, median_days: 1.8 },
      { city: "البيضاء", delivered: 8, failed: 14, median_days: 3.5 }, { city: "الكفرة", delivered: 9, failed: 5, median_days: 4.1 },
    ],
    ...over,
  };
}

export function benghazi(over: Partial<ScorecardCarrier> = {}): ScorecardCarrier {
  return {
    id: BEN, name: "Darb Assabil — Benghazi", code: "darb_assabil", accent_color: "#C24E17",
    account_label: { fr: "Benghazi", ar: "بنغازي" }, first_upload_at: "2026-09-07T09:00:00Z", last_upload_at: "2026-10-02T09:00:00Z",
    has_reasons: true, has_attempts: true,
    period: { sent: 229, delivered: 113, failed: 101, in_flight: 15, prev_delivered: 3, prev_failed: 2,
      picked: 200, picked_fast: 50, first_attempt: 40, median_days: 1.8, fast3: 86 },
    weeks: weeks([[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 1], [0, 0, 0], [0, 0, 0], [0, 0, 0],
      [30, 33, 0], [35, 34, 0], [30, 26, 5], [17, 5, 10]]),
    open: { total: 13, not_picked: 3, b0_2: 1, b3_4: 7, b5_9: 2, b10p: 0, late: 12, stuck: 1 },
    returns: { failed: 114, handed_back: 98, scanned: 0, out: 16, out_late: 4, age_lt7: 12, age_7_30: 60, age_30p: 26, within7: 47, median_days: 7 },
    reasons: [{ class: "no_answer", n: 23 }, { class: "customer_cancelled", n: 21 }, { class: "other", n: 12 }, { class: "not_needed", n: 9 }],
    cities: [
      { city: "بنغازي", delivered: 42, failed: 41, median_days: 1.1 }, { city: "سبها", delivered: 12, failed: 7, median_days: 4 },
      { city: "المرج", delivered: 7, failed: 7, median_days: 0.4 }, { city: "الكفرة", delivered: 8, failed: 5, median_days: 4.1 },
      { city: "البيضاء", delivered: 6, failed: 8, median_days: 1.5 },
    ],
    ...over,
  };
}

export function libyaScorecard(over: Partial<Scorecard> = {}): Scorecard {
  return {
    market_id: LY, days: 30, generated_at: "2026-10-03T12:00:00Z",
    settings: { target_pct: 60, late_days: 3, stuck_days: 5 },
    last_sync_at: "2026-10-03T11:52:00Z",
    carriers: [tripoli(), benghazi()],
    dormant: [{ id: DEX, name: "Dexpress", code: "dexpress", accent_color: null, last_upload_at: "2026-05-30T09:00:00Z", open: 323 }],
    ...over,
  };
}
