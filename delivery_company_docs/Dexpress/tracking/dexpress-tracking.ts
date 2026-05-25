/**
 * Dexpress order tracking — status + history fetchers.
 *
 * Two endpoints, two functions:
 *
 *   1. getOrderStatus(id)
 *      → hits GET /merchant/ajax-order-case/{id}
 *      → returns JSON { statusName, statusId, slug, isAccepted }
 *      → cheap and fast; use for polling, customer-facing tracking pages,
 *        anywhere you only need the *current* state.
 *
 *   2. getOrderTracking(id)
 *      → hits GET /merchant/track-order/{id} (HTML page)
 *      → parses the timeline into a structured event list
 *      → returns the current status PLUS the full history with timestamps
 *        and courier info where present.
 *      → use this when you want to display the full progression in your OMS.
 *
 * Both reuse the existing cookie-based session helper (see client.ts).
 * Neither requires a CSRF token (both are GETs).
 *
 * Convention: this file assumes your existing helper exposes an
 * `authenticatedFetch(path, init)` (or similar) that:
 *   - prepends the Dexpress base URL
 *   - attaches the laravel_session cookie
 *   - handles 302→/login by re-logging in and retrying
 *   - returns a Response object
 *
 * Adjust the import name on line 39 to whatever your helper actually exports.
 */

import { parse, HTMLElement } from "node-html-parser";
import {
  findStatusById,
  findStatusByLabel,
  type DexpressStatus,
} from "./dexpress-statuses";

// Replace with your actual session-aware fetch helper from client.ts.
// It should accept a path like "/merchant/track-order/123" and return
// a standard Response, having handled auth + session refresh internally.
import { authenticatedFetch } from "./client";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OrderStatusSnapshot {
  orderId: number;
  /** Numeric status ID, or null if Dexpress returned a label we don't yet recognize. */
  statusId: number | null;
  /** Stable English slug for our own DB, or null for unknown statuses. */
  slug: string | null;
  /** Raw Arabic label as returned by Dexpress — always present, never null. */
  statusName: string;
  /**
   * Mirrors Dexpress's `order_accept` field. 0 = not yet accepted (still pending),
   * 1 = accepted into the workflow. Useful for pending-orders edits.
   */
  isAccepted: boolean;
}

export interface TrackingEvent {
  /** Same shape as OrderStatusSnapshot's status fields — see findStatusByLabel. */
  statusId: number | null;
  slug: string | null;
  statusName: string;
  /** ISO date string `YYYY-MM-DD` exactly as Dexpress provides. */
  date: string | null;
  /** Normalized 24h time string `HH:MM:SS`, converted from Dexpress's `HH-MM-SS م/ص` format. */
  time: string | null;
  /** Combined ISO 8601 timestamp, or null if either date or time were missing. */
  timestamp: string | null;
  /** Courier name + branch, if the event involves a courier. */
  courierName: string | null;
  /** Courier phone, if present. */
  courierPhone: string | null;
}

export interface OrderTracking {
  orderId: number;
  /** Current status, parsed from the page header. */
  current: OrderStatusSnapshot;
  /** Full timeline, newest event first (the order Dexpress renders them in). */
  events: TrackingEvent[];
}

// ---------------------------------------------------------------------------
// 1. Lightweight current-status fetcher
// ---------------------------------------------------------------------------

/**
 * Fetch the current status of a single order via the JSON ajax endpoint.
 *
 * Endpoint shape (reverse-engineered from the search modal's JS):
 *   GET /merchant/ajax-order-case/{id}
 *   Response body: a JSON STRING (not application/json — has to be JSON.parse'd
 *   after .text()). Shape: { response_case: 201, status_name: "...", order_accept: 0|1 }
 */
export async function getOrderStatus(
  orderId: number
): Promise<OrderStatusSnapshot> {
  const res = await authenticatedFetch(`/merchant/ajax-order-case/${orderId}`, {
    method: "GET",
    headers: {
      Accept: "application/json, text/plain, */*",
      "X-Requested-With": "XMLHttpRequest",
    },
  });

  if (res.status !== 200) {
    throw new Error(
      `Dexpress ajax-order-case returned ${res.status} for order ${orderId}`
    );
  }

  const text = await res.text();
  // The endpoint returns a JSON string, not a JSON object content-type.
  // The portal's own JS does JSON.parse(result), so we do too.
  let payload: {
    response_case?: number;
    status_name?: string;
    order_accept?: number;
  };
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `Dexpress ajax-order-case returned non-JSON body for order ${orderId}: ${text.slice(0, 200)}`
    );
  }

  if (payload.response_case !== 201) {
    // The portal's UI surfaces a "not found" message via a different
    // code path; we treat anything that isn't 201 as a lookup failure.
    throw new Error(
      `Dexpress ajax-order-case reported response_case=${payload.response_case} for order ${orderId}`
    );
  }

  const rawName = (payload.status_name ?? "").trim();
  const match = rawName ? findStatusByLabel(rawName) : null;

  return {
    orderId,
    statusId: match?.id ?? null,
    slug: match?.slug ?? null,
    statusName: rawName,
    isAccepted: payload.order_accept === 1,
  };
}

// ---------------------------------------------------------------------------
// 2. Full tracking-page fetcher with timeline parser
// ---------------------------------------------------------------------------

/**
 * Fetch the full tracking history of a single order by scraping the
 * /merchant/track-order/{id} HTML page.
 */
export async function getOrderTracking(orderId: number): Promise<OrderTracking> {
  const res = await authenticatedFetch(`/merchant/track-order/${orderId}`, {
    method: "GET",
    headers: {
      Accept:
        "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });

  if (res.status !== 200) {
    throw new Error(
      `Dexpress track-order returned ${res.status} for order ${orderId}`
    );
  }

  const html = await res.text();
  return parseTrackingHtml(orderId, html);
}

/**
 * Pure parser — separated from the fetcher so it's unit-testable with
 * saved HTML fixtures. Exported for tests; you probably don't need to call
 * it directly in production code.
 */
export function parseTrackingHtml(
  orderId: number,
  html: string
): OrderTracking {
  const root = parse(html);

  // ── Current status (from the page header button) ──────────────────────────
  // The header always contains a div like:
  //   <div class="btn btn-lg blue-chambray margin-bottom-5">
  //     <i class="fa fa-tag"></i> حالة الطلب : إلى المندوب
  //   </div>
  // We extract whatever comes after the "حالة الطلب :" prefix.
  const currentStatusName = extractCurrentStatusName(root);
  const currentMatch = currentStatusName
    ? findStatusByLabel(currentStatusName)
    : null;

  const current: OrderStatusSnapshot = {
    orderId,
    statusId: currentMatch?.id ?? null,
    slug: currentMatch?.slug ?? null,
    statusName: currentStatusName ?? "",
    // The HTML page doesn't expose isAccepted directly; if you need that
    // field, prefer getOrderStatus(). We default to true here because if
    // the page rendered at all, the order has moved past the pending stage.
    isAccepted: true,
  };

  // ── Timeline events ───────────────────────────────────────────────────────
  // Each event is a `.timeline-item`. We grab them all and parse each one.
  // The first timeline-item we'll encounter belongs to the left "tracking"
  // panel (`بيانات التتبع`). The right panel (`بيانات المتابعة`) was empty
  // in both captures so we don't worry about it yet — if it ever has items,
  // they'd merge into this list. If/when that happens we can scope the
  // selector to just the left portlet.
  const events: TrackingEvent[] = root
    .querySelectorAll(".timeline-item")
    .map(parseTimelineItem)
    .filter((e): e is TrackingEvent => e !== null);

  return { orderId, current, events };
}

// ---------------------------------------------------------------------------
// Internal parsing helpers
// ---------------------------------------------------------------------------

function extractCurrentStatusName(root: HTMLElement): string | null {
  // Find any element whose text contains "حالة الطلب" — there's exactly one.
  const headerBtns = root.querySelectorAll(".portlet-title .btn");
  for (const btn of headerBtns) {
    const text = btn.text.replace(/\s+/g, " ").trim();
    const match = text.match(/حالة\s+الطلب\s*[:：]\s*(.+)$/);
    if (match) {
      return match[1].trim();
    }
  }
  return null;
}

function parseTimelineItem(item: HTMLElement): TrackingEvent | null {
  // Status label: the <div class="timeline-body-title">. Strip out the icon's
  // text content (font-awesome <i> tags have no text in practice, but we
  // normalize whitespace defensively).
  const titleEl = item.querySelector(".timeline-body-title");
  if (!titleEl) {
    return null;
  }
  const statusName = titleEl.text.replace(/\s+/g, " ").trim();
  if (!statusName) {
    return null;
  }
  const match = findStatusByLabel(statusName);

  // Courier name & phone — optional. They live inside .timeline-body-content
  // spans, distinguishable by the fa icon class (motorcycle = name, phone = phone).
  let courierName: string | null = null;
  let courierPhone: string | null = null;
  let date: string | null = null;
  let time: string | null = null;

  for (const content of item.querySelectorAll(".timeline-body-content")) {
    const innerHtml = content.innerHTML;
    const textValue = content.text.replace(/\s+/g, " ").trim();

    if (innerHtml.includes("fa-motorcycle")) {
      // " مندوب التوصيل : NAME ( BRANCH )"
      courierName = textValue
        .replace(/^مندوب\s+التوصيل\s*[:：]\s*/, "")
        .trim() || null;
    } else if (innerHtml.includes("fa-phone")) {
      // " هاتف المندوب : 0916806567"
      courierPhone = textValue
        .replace(/^هاتف\s+المندوب\s*[:：]\s*/, "")
        .trim() || null;
    } else if (
      innerHtml.includes("fa-calendar") ||
      innerHtml.includes("fa-clock-o")
    ) {
      // The date+time live in a single content block:
      //   <i class="fa-calendar"></i> 2026-05-21 <i class="fa-clock-o"></i> 09-12-46 م
      const dateMatch = textValue.match(/(\d{4}-\d{2}-\d{2})/);
      if (dateMatch) {
        date = dateMatch[1];
      }
      const timeMatch = textValue.match(/(\d{1,2}-\d{2}-\d{2})\s*([صم])/);
      if (timeMatch) {
        time = normalizeArabicTime(timeMatch[1], timeMatch[2]);
      }
    }
  }

  const timestamp = date && time ? `${date}T${time}+02:00` : null;

  return {
    statusId: match?.id ?? null,
    slug: match?.slug ?? null,
    statusName,
    date,
    time,
    timestamp,
    courierName,
    courierPhone,
  };
}

/**
 * Convert Dexpress's funky time format to a normal 24h `HH:MM:SS`.
 *
 *   "05-23-40" + "م" (PM)  → "17:23:40"
 *   "02-55-55" + "ص" (AM)  → "02:55:55"
 *   "12-30-00" + "م" (PM)  → "12:30:00"  (noon stays as 12)
 *   "12-15-00" + "ص" (AM)  → "00:15:00"  (midnight wraps to 00)
 */
function normalizeArabicTime(rawTime: string, meridiem: "ص" | "م"): string {
  const parts = rawTime.split("-").map((n) => parseInt(n, 10));
  if (parts.length !== 3 || parts.some((n) => Number.isNaN(n))) {
    return rawTime; // give up gracefully; consumer can still display the raw string
  }
  let [hh, mm, ss] = parts;
  if (meridiem === "م") {
    // PM
    if (hh < 12) hh += 12;
  } else {
    // AM
    if (hh === 12) hh = 0;
  }
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(hh)}:${pad(mm)}:${pad(ss)}`;
}
