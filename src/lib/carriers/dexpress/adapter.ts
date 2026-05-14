import type {
  CarrierAdapter,
  CarrierOrderData,
  CarrierConfig,
  CarrierRawResponse,
  CarrierDispatchResult,
  CarrierVoidResult,
} from "../types";
import { CarrierDispatchError } from "../errors";
import { buildOrderPayload } from "./payload";
import { DexpressClient } from "./client";
import { scrapeCsrfToken } from "./csrf";
import { parseFormErrors, type FieldError } from "./errors";

const ADD_ORDERS_PATH = "/merchant/add-orders";
const SUCCESS_RE = /\/merchant\/success-added-order\/(\d+)/;

/**
 * Pull the human-meaningful bits out of a Dexpress HTML response for logging.
 * Laravel renders validation/flash errors in a handful of known patterns;
 * <head> boilerplate is useless, so target the <body> and known containers.
 */
function diagnoseHtml(html: string): Record<string, unknown> {
  const grab = (re: RegExp, max = 600): string[] =>
    [...html.matchAll(re)]
      .map((m) => (m[1] ?? m[0]).replace(/\s+/g, " ").trim().slice(0, max))
      .filter(Boolean);

  return {
    isLoginPage: /name="email"/.test(html) && /name="password"/.test(html),
    title: html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
    alertDanger: grab(
      /<div[^>]*class="[^"]*alert-danger[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    ),
    errorList: grab(/<ul[^>]*class="[^"]*"[^>]*>([\s\S]*?)<\/ul>/gi),
    invalidFeedback: grab(
      /<div[^>]*class="[^"]*invalid-feedback[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    ),
    // Last resort: a chunk of the <body> with tags stripped.
    bodyText:
      (html.match(/<body[\s\S]*?>([\s\S]*)<\/body>/i)?.[1] ?? html)
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 2000),
  };
}

export class DexpressAdapter implements CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): Record<string, string> {
    const stateId = Number(extra?.state_id);
    if (!Number.isFinite(stateId)) {
      throw new CarrierDispatchError(
        "DEXPRESS_MISSING_STATE: state_id required in extra"
      );
    }
    return buildOrderPayload(order, config, { state_id: stateId });
  }

  async dispatch(
    payload: Record<string, string>,
    config: CarrierConfig
  ): Promise<CarrierRawResponse> {
    const client = new DexpressClient(config.id, config);

    // Step A: GET /merchant/add-orders → scrape fresh _token
    const formPage = await client.getMerchantPage(ADD_ORDERS_PATH);
    const token = scrapeCsrfToken(formPage.html);
    if (!token) {
      throw new CarrierDispatchError(
        "DEXPRESS_NO_TOKEN: form page returned no _token"
      );
    }

    // Step B: POST /merchant/add-orders with token injected
    // Log the exact payload sent so a rejection can be matched to its fields.
    console.error("[DexpressAdapter] submitting payload", {
      payload: { ...payload, _token: "[scraped]" },
    });
    const submission = await client.submitMerchantForm(ADD_ORDERS_PATH, {
      ...payload,
      _token: token,
    });

    // Success: 302 → /merchant/success-added-order/{id}
    if (submission.status >= 300 && submission.status < 400) {
      const match = submission.redirectLocation?.match(SUCCESS_RE);
      if (match) {
        return { status: 302, body: { orderId: match[1] } };
      }

      // Redirect back to /merchant/add-orders is the Laravel "redirect back with
      // errors" pattern — flash messages live in the next GET of the form page.
      const isRedirectBack = !!submission.redirectLocation?.match(
        /\/merchant\/add-orders(\?.*)?$/
      );
      // Redirect back to /merchant/add-orders is the Laravel "redirect back
      // with errors" pattern — flash data lives in the next GET of the form.
      if (isRedirectBack) {
        const flash = await client.getMerchantPage(ADD_ORDERS_PATH);
        const { errors } = parseFormErrors(flash.html);
        if (errors.length === 0) {
          // Dexpress redirected back but we couldn't extract field errors —
          // dump the meaningful HTML so we can see what it actually returned
          // (login page? top-level alert? different markup?).
          console.error("[DexpressAdapter] redirect-back with no parseable errors", {
            redirectLocation: submission.redirectLocation,
            flashStatus: flash.status,
            diagnosis: diagnoseHtml(flash.html),
          });
        }
        return { status: 200, body: { errors } };
      }

      return {
        status: submission.status,
        body: { redirectLocation: submission.redirectLocation },
      };
    }

    // Validation: 200 with form re-rendered + invalid-feedback divs
    if (submission.status === 200) {
      const { errors } = parseFormErrors(submission.html);
      if (errors.length === 0) {
        console.error("[DexpressAdapter] 200 response with no parseable errors", {
          diagnosis: diagnoseHtml(submission.html),
        });
      }
      return { status: 200, body: { errors } };
    }

    // 4xx / 5xx — bubble up status, keep an HTML excerpt for logs
    return {
      status: submission.status,
      body: { htmlExcerpt: submission.html.slice(0, 500) },
    };
  }

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult {
    if (raw.status === 302) {
      const body = raw.body as { orderId?: string };
      if (body?.orderId) {
        return { success: true, trackingNumber: body.orderId };
      }
    }

    if (raw.status === 200) {
      const body = raw.body as { errors?: FieldError[] };
      const list = body?.errors ?? [];
      const formatted =
        list.length > 0
          ? list
              .map((e) => (e.field ? `${e.field}: ${e.message}` : e.message))
              .join("; ")
          : "Validation error";
      return {
        success: false,
        errorCode: "DEXPRESS_VALIDATION",
        errorMessage: formatted,
        retryable: false,
      };
    }

    return {
      success: false,
      errorCode: "DEXPRESS_UNKNOWN",
      errorMessage: `Unexpected response (HTTP ${raw.status})`,
      retryable: raw.status >= 500,
    };
  }

  async voidDispatch(
    trackingNumber: string,
    config: CarrierConfig
  ): Promise<CarrierVoidResult> {
    const client = new DexpressClient(config.id, config);
    try {
      const result = await client.deleteOrder(trackingNumber);
      return result.ok
        ? { success: true, supported: true }
        : { success: false, supported: true, reason: result.reason };
    } catch (err) {
      return {
        success: false,
        supported: true,
        reason: err instanceof Error ? err.message : "unknown",
      };
    }
  }
}
