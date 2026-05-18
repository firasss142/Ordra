// Next.js instrumentation hook — runs once at server startup.
// We use it to start a dev-only ticker that POSTs the notifications cron every
// minute. In production this is a no-op; Vercel Cron runs the schedule from
// vercel.json instead.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.NODE_ENV === "production") return;
  if (process.env.DISABLE_DEV_CRON_TICK === "1") return;

  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn(
      "[dev-cron-tick] CRON_SECRET is not set — skipping local ticker. Set it in .env.local to enable.",
    );
    return;
  }

  const port = process.env.PORT ?? "3000";
  const url = `http://127.0.0.1:${port}/api/cron/notifications-check`;
  const intervalMs = 60_000;

  // Note: this fires inside the same Node process as the dev server, so the
  // first tick can happen before routes are warm. We let any errors surface as
  // a single console.warn rather than crashing the dev server.
  async function tick() {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "x-cron-secret": secret as string },
      });
      if (!res.ok) {
        console.warn(`[dev-cron-tick] non-ok response: ${res.status}`);
      }
    } catch (err) {
      console.warn("[dev-cron-tick] fetch failed:", (err as Error).message);
    }
  }

  // Fire once after a short delay so the dev server has time to bind, then
  // every minute.
  setTimeout(tick, 5_000);
  setInterval(tick, intervalMs);

  console.log(
    `[dev-cron-tick] enabled — POSTing ${url} every ${intervalMs / 1000}s`,
  );
}
