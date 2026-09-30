/**
 * The queue row's column template, shared by the list's header strip and every
 * OrderCard.
 *
 * It lives here rather than in either component because a header that can drift
 * from its rows is worse than no header at all.
 */
// Rev 3 (2026-09-19): the columns are the ones the owner's capture shows —
// select, client, activity, age, amount. The status column is gone: the bucket
// chips above the list already name the status, and every row under a chip
// shares it, so the column repeated the filter on twelve rows at once.
export const QUEUE_ROW_GRID = [
  // Phone: the prototype's card. Identity takes the room left over and spans
  // both rows; the age and the attempts counter stack beside it; the amount
  // sits at the top corner and the call button runs the full height.
  // The identity column must be `minmax(0,1fr)` and the rest content-sized —
  // with `auto` on the identity the amount is pushed off the card's edge.
  "grid-cols-[minmax(0,1fr)_auto_auto_44px]",
  "lg:grid-cols-[40px_minmax(0,1fr)_250px_196px_140px]",
].join(" ");

/** Padding + gap, shared for the same reason. */
export const QUEUE_ROW_SPACING = "gap-x-2 gap-y-1 ps-3 pe-2.5 lg:gap-x-4 lg:ps-4 lg:pe-3";
