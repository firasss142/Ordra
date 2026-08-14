/**
 * Ad account ids, normalised once.
 *
 * Meta shows the id as `act_772000111` in Business Settings and returns it that
 * way from some endpoints, while the Graph path wants the same prefix and our
 * column stores the bare digits. Operators paste whichever form they are
 * looking at, so the boundary accepts both and stores exactly one — otherwise
 * `act_772000111` and `772000111` become two accounts with one unique index
 * between them, and the second connection fails with a constraint error that
 * explains nothing.
 */

/** Strip Meta's `act_` prefix. Returns the digits as stored in the column. */
export function normaliseAccountId(raw: string): string {
  const trimmed = raw.trim();
  return trimmed.startsWith("act_") ? trimmed.slice(4) : trimmed;
}

/** True when the value is a usable ad account id — digits, nothing else. */
export function isValidAccountId(value: string): boolean {
  return /^\d+$/.test(value);
}
