import { describe, test, expect } from "vitest";
import { encodeFollowUpCursor, decodeFollowUpCursor } from "../list";

describe("follow-ups keyset cursor", () => {
  test("round-trips a valid cursor", () => {
    const raw = encodeFollowUpCursor({
      updatedAt: "2026-04-22T10:30:00.000Z",
      id: "abc-123",
    });
    const decoded = decodeFollowUpCursor(raw);
    expect(decoded).toEqual({
      updatedAt: "2026-04-22T10:30:00.000Z",
      id: "abc-123",
    });
  });

  test("rejects a malformed cursor", () => {
    expect(decodeFollowUpCursor("not-a-cursor")).toBeNull();
  });

  test("rejects a cursor missing the separator", () => {
    const bad = Buffer.from("just-one-value", "utf8").toString("base64url");
    expect(decodeFollowUpCursor(bad)).toBeNull();
  });

  test("rejects a cursor with a non-ISO timestamp", () => {
    const bad = Buffer.from("2026-04-22|abc-123", "utf8").toString("base64url");
    expect(decodeFollowUpCursor(bad)).toBeNull();
  });

  test("rejects a cursor with an empty id", () => {
    const bad = Buffer.from("2026-04-22T10:30:00.000Z|", "utf8").toString("base64url");
    expect(decodeFollowUpCursor(bad)).toBeNull();
  });
});
