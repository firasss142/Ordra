const TIME_RE = /^([0-1]\d|2[0-3]):([0-5]\d)$/;

export interface NextRetrySlotOptions {
  fallbackHours?: number;
}

export function computeNextRetrySlot(
  now: Date,
  presets: readonly string[],
  options: NextRetrySlotOptions = {}
): Date {
  if (presets.length === 0) {
    const fallback = options.fallbackHours ?? 2;
    const out = new Date(now.getTime());
    out.setHours(out.getHours() + fallback);
    return out;
  }

  const parsed = presets.map((raw) => {
    const match = TIME_RE.exec(raw);
    if (!match) {
      throw new Error(`Invalid preset time "${raw}" — expected HH:MM (24h)`);
    }
    return { hours: Number(match[1]), minutes: Number(match[2]) };
  });

  for (let i = 1; i < parsed.length; i++) {
    const prev = parsed[i - 1];
    const curr = parsed[i];
    const prevMinutes = prev.hours * 60 + prev.minutes;
    const currMinutes = curr.hours * 60 + curr.minutes;
    if (currMinutes <= prevMinutes) {
      throw new Error(
        `Preset times must be strictly increasing (got "${presets[i - 1]}" then "${presets[i]}")`
      );
    }
  }

  for (const slot of parsed) {
    const candidate = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      slot.hours,
      slot.minutes,
      0,
      0
    );
    if (candidate.getTime() > now.getTime()) {
      return candidate;
    }
  }

  const first = parsed[0];
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
    first.hours,
    first.minutes,
    0,
    0
  );
  return tomorrow;
}
