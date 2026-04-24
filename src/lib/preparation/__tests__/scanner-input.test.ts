import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { createScannerInputHandler, SCANNER_INTER_KEY_MS } from "../scanner-input";

// Helpers to simulate keydown events
function key(ch: string): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: ch, bubbles: true });
}
function enter(): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
}

describe("createScannerInputHandler", () => {
  let onScan: ReturnType<typeof vi.fn>;
  let handler: (e: KeyboardEvent) => void;
  let cleanup: () => void;

  beforeEach(() => {
    vi.useFakeTimers();
    onScan = vi.fn();
    const result = createScannerInputHandler(onScan);
    handler = result.handler;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  test("does not fire for single char + Enter (human-speed — delay > threshold)", () => {
    handler(key("A"));
    vi.advanceTimersByTime(200); // human delay
    handler(enter());
    expect(onScan).not.toHaveBeenCalled();
  });

  test("fires with buffered string when chars arrive fast then Enter", () => {
    ["o", "r", "d", "e", "r", "-", "1"].forEach((ch) => {
      handler(key(ch));
      vi.advanceTimersByTime(10); // fast — within threshold
    });
    handler(enter());
    expect(onScan).toHaveBeenCalledWith("order-1");
  });

  test("fires with UUID-length barcode string", () => {
    const barcodeId = "abc12345-6789-0000-dead-beefcafebabe";
    barcodeId.split("").forEach((ch) => {
      handler(key(ch));
      vi.advanceTimersByTime(5);
    });
    handler(enter());
    expect(onScan).toHaveBeenCalledWith(barcodeId);
  });

  test("resets buffer after Enter so next scan starts fresh", () => {
    ["a", "b", "c"].forEach((ch) => {
      handler(key(ch));
      vi.advanceTimersByTime(10);
    });
    handler(enter());
    expect(onScan).toHaveBeenCalledWith("abc");

    onScan.mockClear();

    ["x", "y", "z"].forEach((ch) => {
      handler(key(ch));
      vi.advanceTimersByTime(10);
    });
    handler(enter());
    expect(onScan).toHaveBeenCalledWith("xyz");
  });

  test("drops buffer and does NOT fire when inter-key delay exceeds threshold before Enter", () => {
    handler(key("A"));
    vi.advanceTimersByTime(10);
    handler(key("B"));
    vi.advanceTimersByTime(SCANNER_INTER_KEY_MS + 10); // slow gap
    handler(key("C"));
    vi.advanceTimersByTime(10);
    handler(enter());
    // Buffer was reset after the long gap — only 'C' was buffered since reset
    // Still below 2 chars minimum; nothing should fire
    expect(onScan).not.toHaveBeenCalled();
  });

  test("ignores non-printable keys like Shift, Control", () => {
    ["a", "b"].forEach((ch) => {
      handler(key(ch));
      vi.advanceTimersByTime(10);
    });
    handler(new KeyboardEvent("keydown", { key: "Shift", bubbles: true }));
    handler(enter());
    expect(onScan).toHaveBeenCalledWith("ab");
  });

  test("cleanup removes the listener so no more calls after cleanup", () => {
    cleanup();
    ["a", "b", "c"].forEach((ch) => {
      handler(key(ch));
      vi.advanceTimersByTime(5);
    });
    handler(enter());
    expect(onScan).not.toHaveBeenCalled();
  });

  test("minimum 2 chars required to fire (avoids single-key noise)", () => {
    handler(key("X"));
    vi.advanceTimersByTime(5);
    handler(enter());
    expect(onScan).not.toHaveBeenCalled();
  });
});
