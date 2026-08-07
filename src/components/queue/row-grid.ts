/**
 * The queue row's column template, shared by the list's header strip and every
 * OrderCard.
 *
 * It lives here rather than in either component because a header that can drift
 * from its rows is worse than no header at all — two adjacent numeric time
 * columns are ambiguous enough already.
 *
 * Below `lg` the age / last-action / status cells are `hidden`, which removes
 * them from grid flow, so the narrow template has exactly the five columns that
 * remain: select, thumbnail, identity, amount, action.
 */
// Status is 172px because the longest pill — a callback label plus its "En
// retard" datum — truncated to "Rappel pr…" at 142. Action is 112px because
// "Appel terminé" wrapped to two lines at 96 and made that row taller than
// every other one.
export const QUEUE_ROW_GRID = [
  "grid-cols-[20px_40px_minmax(0,1fr)_86px_112px]",
  "lg:grid-cols-[20px_40px_minmax(150px,1fr)_92px_104px_172px_86px_112px]",
].join(" ");

/** Padding + gap, shared for the same reason. */
export const QUEUE_ROW_SPACING = "gap-3.5 ps-4 pe-3.5";
