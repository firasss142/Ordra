interface SeriesPoint {
  day: string;
  rate: number | null;
}

export function computeStreak(series: SeriesPoint[], target: number): number {
  // series must be newest-first; iterate from most recent toward oldest
  let streak = 0;

  for (const point of series) {
    if (point.rate === null) continue; // skip zero-activity days
    if (point.rate >= target) {
      streak++;
    } else {
      break;
    }
  }

  return streak;
}
