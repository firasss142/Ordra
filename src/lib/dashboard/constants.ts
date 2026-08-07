// Runtime constants shared between the server-only rollup (health.ts, which
// imports the Supabase server client and cannot be pulled into a client
// bundle) and client components that need the same numbers for display.
export const PERIOD_DAYS = 30;
export const CARRIER_WINDOW_DAYS = 90;
