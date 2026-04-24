// Inter-key delay threshold in ms: hardware scanners are < 50ms per char.
// Human typing is typically > 80ms. We use 80ms as the cutoff.
export const SCANNER_INTER_KEY_MS = 80;

// Minimum characters required to treat buffered input as a barcode scan.
const MIN_SCAN_LENGTH = 2;

// Single-character keys that carry printable content.
function isPrintableKey(key: string): boolean {
  return key.length === 1;
}

interface ScannerHandler {
  handler: (e: KeyboardEvent) => void;
  cleanup: () => void;
}

/**
 * Creates a keyboard event handler that buffers fast keystroke sequences
 * (< SCANNER_INTER_KEY_MS between chars) and calls onScan when Enter arrives.
 * Slow sequences (human typing) reset the buffer so they never trigger onScan.
 *
 * Returns { handler, cleanup } so the caller can attach/detach as needed.
 */
export function createScannerInputHandler(
  onScan: (value: string) => void,
): ScannerHandler {
  let buffer = "";
  let lastKeyTime = 0;
  let active = true;

  function handler(e: KeyboardEvent): void {
    if (!active) return;

    const now = Date.now();

    if (e.key === "Enter") {
      if (buffer.length >= MIN_SCAN_LENGTH) {
        onScan(buffer);
      }
      buffer = "";
      lastKeyTime = 0;
      return;
    }

    if (!isPrintableKey(e.key)) return;

    if (lastKeyTime > 0 && now - lastKeyTime > SCANNER_INTER_KEY_MS) {
      // Slow gap — this is human typing; reset the buffer
      buffer = "";
    }

    buffer += e.key;
    lastKeyTime = now;
  }

  function cleanup(): void {
    active = false;
    buffer = "";
  }

  return { handler, cleanup };
}
