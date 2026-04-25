import { describe, expect, test } from "vitest";
import { suggestNextContact, suggestDurationLabel } from "../schedule";

const NOW = 1_700_000_000_000; // fixed epoch for determinism

describe("suggestNextContact", () => {
  test("voicemail → +24h", () => {
    const result = suggestNextContact("voicemail", NOW);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(NOW + 24 * 60 * 60 * 1000);
  });

  test("no_answer → +4h", () => {
    const result = suggestNextContact("no_answer", NOW);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(NOW + 4 * 60 * 60 * 1000);
  });

  test("busy → +2h", () => {
    const result = suggestNextContact("busy", NOW);
    expect(result).not.toBeNull();
    expect(result!.getTime()).toBe(NOW + 2 * 60 * 60 * 1000);
  });

  test("other → null (no suggestion)", () => {
    const result = suggestNextContact("other", NOW);
    expect(result).toBeNull();
  });

  test("same nowMs → same output (pure function)", () => {
    const a = suggestNextContact("no_answer", NOW);
    const b = suggestNextContact("no_answer", NOW);
    expect(a?.getTime()).toBe(b?.getTime());
  });
});

describe("suggestDurationLabel", () => {
  test("voicemail → '24h'", () => {
    expect(suggestDurationLabel("voicemail")).toBe("24h");
  });

  test("no_answer → '4h'", () => {
    expect(suggestDurationLabel("no_answer")).toBe("4h");
  });

  test("busy → '2h'", () => {
    expect(suggestDurationLabel("busy")).toBe("2h");
  });

  test("other → null", () => {
    expect(suggestDurationLabel("other")).toBeNull();
  });
});
