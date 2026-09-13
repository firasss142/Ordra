import { describe, test, expect } from "vitest";
import {
  pickupSettingKey,
  isPickupDisabledNow,
  PICKUP_KEY_PREFIX,
} from "../pickup-window";

// Libya is Africa/Tripoli, UTC+2 year-round. Every "midnight" below is Libyan
// midnight, not UTC midnight — the whole point of the reset.
const LY = "ly";
const LY_MARKET = "00000000-0000-0000-0000-000000000002";
const SITE = "0dfa8255-0c13-478f-b24d-0fb037c7e09a";

describe("pickupSettingKey", () => {
  test("scopes the key to one warehouse site", () => {
    expect(pickupSettingKey(SITE)).toBe(`${PICKUP_KEY_PREFIX}${SITE}`);
  });

  test("two sites never share a key", () => {
    expect(pickupSettingKey("a")).not.toBe(pickupSettingKey("b"));
  });
});

describe("isPickupDisabledNow", () => {
  test("no setting row at all → pickup stays ON (the default)", () => {
    expect(isPickupDisabledNow(null, LY, new Date("2026-09-12T10:00:00Z"))).toBe(false);
  });

  test("pressed earlier the same Libyan day → pickup OFF", () => {
    // 09:00 UTC = 11:00 Tripoli. Now 13:00 UTC = 15:00 Tripoli. Same day.
    const value = { disabled_at: "2026-09-12T09:00:00Z" };
    expect(isPickupDisabledNow(value, LY, new Date("2026-09-12T13:00:00Z"))).toBe(true);
  });

  test("pressed yesterday → pickup back ON, with no cron having run", () => {
    const value = { disabled_at: "2026-09-11T09:00:00Z" };
    expect(isPickupDisabledNow(value, LY, new Date("2026-09-12T13:00:00Z"))).toBe(false);
  });

  // The reset must land on LOCAL midnight. 2026-09-12T22:30Z is already
  // 2026-09-13 00:30 in Tripoli — a new day, so a press made at 20:00Z
  // (22:00 Tripoli, still the 12th) must already be expired.
  test("resets at Libyan midnight, not UTC midnight", () => {
    const value = { disabled_at: "2026-09-12T20:00:00Z" }; // 22:00 Tripoli, 12th
    // 21:00 UTC = 23:00 Tripoli, still the 12th → still OFF.
    expect(isPickupDisabledNow(value, LY_MARKET, new Date("2026-09-12T21:00:00Z"))).toBe(true);
    // 22:30 UTC = 00:30 Tripoli on the 13th → expired, pickup ON again.
    expect(isPickupDisabledNow(value, LY_MARKET, new Date("2026-09-12T22:30:00Z"))).toBe(false);
  });

  test("a press just after local midnight holds for the new day", () => {
    const value = { disabled_at: "2026-09-12T22:30:00Z" }; // 00:30 Tripoli, 13th
    expect(isPickupDisabledNow(value, LY_MARKET, new Date("2026-09-13T15:00:00Z"))).toBe(true);
  });

  test("garbage or missing disabled_at is not a disabled pickup", () => {
    expect(isPickupDisabledNow({}, LY, new Date())).toBe(false);
    expect(isPickupDisabledNow({ disabled_at: "not-a-date" }, LY, new Date())).toBe(false);
    expect(isPickupDisabledNow({ disabled_at: null }, LY, new Date())).toBe(false);
    expect(isPickupDisabledNow("nonsense", LY, new Date())).toBe(false);
  });

  test("reads the { value: {...} } wrapper shape settings rows sometimes carry", () => {
    const wrapped = { value: { disabled_at: "2026-09-12T09:00:00Z" } };
    expect(isPickupDisabledNow(wrapped, LY, new Date("2026-09-12T13:00:00Z"))).toBe(true);
  });
});

// marketTimezone() resolves the market UUID only; the bare code "ly" falls
// through to Africa/Tunis, an hour off — enough to reset the switch at the
// wrong midnight. Both forms must agree.
describe("market identifier forms", () => {
  const LY_UUID = "00000000-0000-0000-0000-000000000002";

  test("the code and the UUID pick the same Libyan midnight", () => {
    const value = { disabled_at: "2026-09-12T20:00:00Z" }; // 22:00 Tripoli, 12th
    const justAfterLocalMidnight = new Date("2026-09-12T22:30:00Z"); // 00:30, 13th
    expect(isPickupDisabledNow(value, LY_UUID, justAfterLocalMidnight)).toBe(false);
    expect(isPickupDisabledNow(value, LY, justAfterLocalMidnight)).toBe(false);
  });
});
