import { describe, it, expect } from "vitest";
import {
  DEFAULT_GOAL_TARGETS,
  evaluateDailyGoals,
  computeGoalStreak,
  rankAgents,
  suggestCoachingTarget,
  formatActiveMinutes,
  confirmationsPerHour,
  type DailyGoalInput,
} from "./goals";

const T = DEFAULT_GOAL_TARGETS;

describe("evaluateDailyGoals", () => {
  it("meets all three when volume, quality and hygiene are satisfied", () => {
    const r = evaluateDailyGoals(
      { treated: 13, confirmed: 6, overdueCallbacks: 0, staleUntouched: 0 },
      T,
    );
    expect(r.volume.met).toBe(true);
    expect(r.quality.met).toBe(true);
    expect(r.hygiene.met).toBe(true);
    expect(r.metCount).toBe(3);
  });

  it("volume fails below the daily treated target", () => {
    const r = evaluateDailyGoals(
      { treated: 11, confirmed: 6, overdueCallbacks: 0, staleUntouched: 0 },
      T,
    );
    expect(r.volume.met).toBe(false);
    expect(r.metCount).toBe(2); // quality (54.5 %) + hygiene
  });

  it("quality is 'pending' (null) until 10 treated — never a miss early in the day", () => {
    const r = evaluateDailyGoals(
      { treated: 4, confirmed: 0, overdueCallbacks: 0, staleUntouched: 0 },
      T,
    );
    expect(r.quality.met).toBeNull();
    expect(r.quality.value).toBeNull();
    // pending does not count as met
    expect(r.metCount).toBe(1); // hygiene only
  });

  it("quality fails once ≥ 10 treated and rate below target", () => {
    const r = evaluateDailyGoals(
      { treated: 18, confirmed: 0, overdueCallbacks: 0, staleUntouched: 0 },
      T,
    );
    expect(r.quality.met).toBe(false);
    expect(r.quality.value).toBe(0);
  });

  it("hygiene fails on any overdue callback or stale untouched order", () => {
    expect(
      evaluateDailyGoals({ treated: 20, confirmed: 10, overdueCallbacks: 1, staleUntouched: 0 }, T)
        .hygiene.met,
    ).toBe(false);
    expect(
      evaluateDailyGoals({ treated: 20, confirmed: 10, overdueCallbacks: 0, staleUntouched: 2 }, T)
        .hygiene.met,
    ).toBe(false);
  });

  it("respects per-agent overrides", () => {
    const r = evaluateDailyGoals(
      { treated: 13, confirmed: 6, overdueCallbacks: 0, staleUntouched: 0 },
      { ...T, dailyTreated: 20, minRate: 50 },
    );
    expect(r.volume.met).toBe(false);
    expect(r.quality.met).toBe(false);
  });

  it("no activity → nothing met, quality pending", () => {
    const r = evaluateDailyGoals(
      { treated: 0, confirmed: 0, overdueCallbacks: 0, staleUntouched: 0 },
      T,
    );
    expect(r.metCount).toBe(1); // hygiene trivially met when nothing is stuck
    expect(r.quality.met).toBeNull();
    expect(r.idle).toBe(true);
  });
});

describe("computeGoalStreak", () => {
  const d = (treated: number, confirmed: number): DailyGoalInput => ({
    treated,
    confirmed,
    overdueCallbacks: 0,
    staleUntouched: 0,
  });

  it("returns zeros for empty history", () => {
    expect(computeGoalStreak([], T)).toEqual({ current: 0, best: 0 });
  });

  it("counts consecutive active days at 3/3, most recent last", () => {
    // tasnim, 8→14 août: 28/13, absent, 8/3, 28/13, 12/5, absent, 13/6
    const series = [d(28, 13), d(0, 0), d(8, 3), d(28, 13), d(12, 5), d(0, 0), d(13, 6)];
    expect(computeGoalStreak(series, T)).toEqual({ current: 3, best: 3 });
  });

  it("inactive days are skipped, not broken", () => {
    const series = [d(23, 13), d(12, 7), d(25, 12), d(0, 0)];
    expect(computeGoalStreak(series, T).current).toBe(3);
  });

  it("a failed day resets the current streak but keeps the best", () => {
    const series = [d(20, 10), d(20, 10), d(20, 1), d(20, 10)];
    expect(computeGoalStreak(series, T)).toEqual({ current: 1, best: 2 });
  });

  it("volume alone is not enough — quality below target breaks it", () => {
    // roqaya 12–13 août: 18/0, 31/3
    const series = [d(41, 15), d(18, 0), d(31, 3)];
    expect(computeGoalStreak(series, T).current).toBe(0);
  });
});

describe("rankAgents", () => {
  const a = (id: string, confirmed: number, activeMinutes: number, treated = 50) => ({
    agentId: id,
    confirmed,
    activeMinutes,
    treated,
  });

  it("orders eligible agents by confirmations per active hour, desc", () => {
    const r = rankAgents([a("tasnim", 40, 860), a("roqaya", 35, 520), a("hend", 24, 420), a("salima", 30, 650)]);
    expect(r.ranked.map((x) => x.agentId)).toEqual(["roqaya", "hend", "tasnim", "salima"]);
    expect(r.ranked[0].rank).toBe(1);
    expect(r.ranked[0].confPerHour).toBeCloseTo(4.04, 2);
  });

  it("agents under 60 active minutes or under 10 treated are unranked with a reason", () => {
    const r = rankAgents([a("tasnim", 40, 860), a("riheb", 1, 20, 1), a("mouna", 0, 0, 0)]);
    expect(r.ranked.map((x) => x.agentId)).toEqual(["tasnim"]);
    expect(r.unranked.map((x) => x.agentId)).toEqual(["riheb", "mouna"]);
    expect(r.unranked[1].reason).toBe("no_activity");
    expect(r.unranked[0].reason).toBe("too_little_activity");
  });

  it("ties keep insertion order and get consecutive ranks", () => {
    const r = rankAgents([a("x", 30, 600), a("y", 30, 600)]);
    expect(r.ranked.map((x) => [x.agentId, x.rank])).toEqual([["x", 1], ["y", 2]]);
  });
});

describe("suggestCoachingTarget", () => {
  it("targets the confirmation rate when below the quality goal", () => {
    expect(
      suggestCoachingTarget({ rate: 26.7, throughput: 15.1 }, { minRate: 40, medianThroughput: 6.2 }),
    ).toEqual({ metric: "rate", value: 40 });
  });
  it("otherwise targets throughput — one notch above the agent's own pace", () => {
    expect(
      suggestCoachingTarget({ rate: 44.9, throughput: 6.2 }, { minRate: 40, medianThroughput: 6.2 }),
    ).toEqual({ metric: "throughput", value: 8 });
    expect(
      suggestCoachingTarget({ rate: 51.7, throughput: 5.4 }, { minRate: 40, medianThroughput: 6.2 }),
    ).toEqual({ metric: "throughput", value: 7 });
  });
  it("returns null when there is not enough data", () => {
    expect(suggestCoachingTarget({ rate: null, throughput: null }, { minRate: 40, medianThroughput: 6.2 })).toBeNull();
  });
});

describe("formatters", () => {
  it("formatActiveMinutes", () => {
    expect(formatActiveMinutes(0)).toBe("0 h");
    expect(formatActiveMinutes(20)).toBe("20 min");
    expect(formatActiveMinutes(60)).toBe("1 h");
    expect(formatActiveMinutes(860)).toBe("14 h 20");
    expect(formatActiveMinutes(2470)).toBe("41 h 10");
  });
  it("confirmationsPerHour", () => {
    expect(confirmationsPerHour(35, 520)).toBeCloseTo(4.04, 2);
    expect(confirmationsPerHour(0, 0)).toBeNull();
  });
});
