import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getPresence,
  PRESENCE_COLOR,
  PRESENCE_LABEL,
  ONLINE_THRESHOLD_MS,
  IDLE_THRESHOLD_MS,
} from "./presence";

describe("getPresence", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-17T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("returns 'offline' when lastSeenAt is null", () => {
    expect(getPresence(null)).toBe("offline");
  });

  test("returns 'online' when last seen just now", () => {
    expect(getPresence(new Date().toISOString())).toBe("online");
  });

  test("returns 'online' at exactly 89s ago (just under threshold)", () => {
    const ts = new Date(Date.now() - 89_000).toISOString();
    expect(getPresence(ts)).toBe("online");
  });

  test("returns 'idle' at exactly the online threshold (90s)", () => {
    const ts = new Date(Date.now() - ONLINE_THRESHOLD_MS).toISOString();
    expect(getPresence(ts)).toBe("idle");
  });

  test("returns 'idle' between 90s and 5min", () => {
    const ts = new Date(Date.now() - 3 * 60_000).toISOString();
    expect(getPresence(ts)).toBe("idle");
  });

  test("returns 'offline' at exactly the idle threshold (5min)", () => {
    const ts = new Date(Date.now() - IDLE_THRESHOLD_MS).toISOString();
    expect(getPresence(ts)).toBe("offline");
  });

  test("returns 'offline' when last seen long ago", () => {
    const ts = new Date(Date.now() - 60 * 60_000).toISOString();
    expect(getPresence(ts)).toBe("offline");
  });
});

describe("presence constants", () => {
  test("has color for every state", () => {
    expect(PRESENCE_COLOR.online).toMatch(/^#/);
    expect(PRESENCE_COLOR.idle).toMatch(/^#/);
    expect(PRESENCE_COLOR.offline).toMatch(/^#/);
  });

  test("has label for every state", () => {
    expect(PRESENCE_LABEL.online).toBeTruthy();
    expect(PRESENCE_LABEL.idle).toBeTruthy();
    expect(PRESENCE_LABEL.offline).toBeTruthy();
  });

  test("thresholds are ordered", () => {
    expect(ONLINE_THRESHOLD_MS).toBeLessThan(IDLE_THRESHOLD_MS);
  });
});
