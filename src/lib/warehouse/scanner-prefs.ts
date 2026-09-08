import type { ScanOutcome } from "@/lib/preparation/scan-outcome";

/**
 * Scanner preferences: about this phone in this hall, so they live on the
 * device and never round-trip through the database.
 */
export interface ScannerPrefs {
  /** A short tone on every outcome, distinct for success and refusal. */
  sound: boolean;
  /** A buzz on every outcome; the refusal pattern is longer, so it reads through a glove. */
  vibrate: boolean;
  /** Open the camera as soon as a parcel is in hand, instead of on tap. */
  cameraFirst: boolean;
}

export const SCANNER_PREFS_KEY = "wh.scanner";

const DEFAULTS: ScannerPrefs = { sound: true, vibrate: true, cameraFirst: true };

export function readScannerPrefs(): ScannerPrefs {
  try {
    const raw = typeof localStorage === "undefined" ? null : localStorage.getItem(SCANNER_PREFS_KEY);
    if (!raw) return { ...DEFAULTS };
    const parsed = JSON.parse(raw) as Partial<Record<keyof ScannerPrefs, unknown>>;
    return {
      sound: typeof parsed.sound === "boolean" ? parsed.sound : DEFAULTS.sound,
      vibrate: typeof parsed.vibrate === "boolean" ? parsed.vibrate : DEFAULTS.vibrate,
      cameraFirst: typeof parsed.cameraFirst === "boolean" ? parsed.cameraFirst : DEFAULTS.cameraFirst,
    };
  } catch {
    // Private mode, blocked storage, corrupt value: the defaults are the answer.
    return { ...DEFAULTS };
  }
}

export function writeScannerPrefs(prefs: ScannerPrefs): void {
  try {
    localStorage.setItem(SCANNER_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // Nothing to do: the toggle still applies for this session.
  }
}

/** Two tones only: success is short and high, refusal is lower and doubled. */
function beep(ok: boolean): void {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const at = ctx.currentTime;
    const notes = ok ? [[880, 0, 0.12]] : [[330, 0, 0.12], [330, 0.18, 0.14]];
    for (const [freq, start, len] of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.value = 0.08;
      osc.connect(gain).connect(ctx.destination);
      osc.start(at + start);
      osc.stop(at + start + len);
    }
    setTimeout(() => void ctx.close(), 600);
  } catch {
    // No audio on this device: silence is acceptable, a crash is not.
  }
}

/** Physical feedback for an outcome, according to the preferences. */
export function signalOutcome(outcome: ScanOutcome | "lookup", prefs: ScannerPrefs): void {
  const ok = outcome === "bound" || outcome === "lookup";
  if (prefs.vibrate && typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    navigator.vibrate(ok ? 40 : [80, 60, 80]);
  }
  if (prefs.sound && typeof window !== "undefined") beep(ok);
}
