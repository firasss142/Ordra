import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { readScannerPrefs, writeScannerPrefs, signalOutcome, SCANNER_PREFS_KEY } from "../scanner-prefs";

/**
 * Scanner preferences live in the phone, not the database: a sound on success
 * and a buzz on refusal are about this device in this hall, and they must
 * survive a reload without a round trip.
 */
beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());

describe("scanner prefs", () => {
  it("defaults to sound on, vibration on, camera first", () => {
    expect(readScannerPrefs()).toEqual({ sound: true, vibrate: true, cameraFirst: true });
  });

  it("round-trips through storage", () => {
    writeScannerPrefs({ sound: false, vibrate: true, cameraFirst: false });
    expect(readScannerPrefs()).toEqual({ sound: false, vibrate: true, cameraFirst: false });
    expect(localStorage.getItem(SCANNER_PREFS_KEY)).not.toBeNull();
  });

  it("survives corrupt or blocked storage with the defaults", () => {
    localStorage.setItem(SCANNER_PREFS_KEY, "{not json");
    expect(readScannerPrefs().sound).toBe(true);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(readScannerPrefs().vibrate).toBe(true);
  });

  it("buzzes on a refusal, not on success, when vibration is on", () => {
    const vibrate = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { vibrate });
    signalOutcome("refused_here", { sound: false, vibrate: true, cameraFirst: true });
    expect(vibrate).toHaveBeenCalledTimes(1);
    signalOutcome("bound", { sound: false, vibrate: true, cameraFirst: true });
    expect(vibrate).toHaveBeenCalledTimes(2);
    signalOutcome("bound", { sound: false, vibrate: false, cameraFirst: true });
    expect(vibrate).toHaveBeenCalledTimes(2);
    vi.unstubAllGlobals();
  });
});
