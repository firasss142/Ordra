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
      if (isRedirectBack) {
        const flash = await client.getMerchantPage(ADD_ORDERS_PATH);
        const { errors } = parseFormErrors(flash.html);

        // Dump the full HTML to disk for offline inspection. Dev-only.
        if (errors.length === 0 && process.env.NODE_ENV !== "production") {
          try {
            const fs = await import("fs/promises");
            const path = await import("path");
            const outPath = path.resolve(
              process.cwd(),
              `dexpress-flash-${Date.now()}.html`
            );
            await fs.writeFile(outPath, flash.html, "utf8");
            console.error("[DexpressAdapter] dumped flash HTML to", outPath);
          } catch (e) {
            console.error("[DexpressAdapter] could not dump flash HTML", e);
          }
        }

        console.error("[DexpressAdapter] redirect-back with flash errors", {
          redirectLocation: submission.redirectLocation,
          errorCount: errors.length,
          errors: errors.slice(0, 5),
          htmlLength: flash.html.length,
        });
        return { status: 200, body: { errors } };
      }

      console.error("[DexpressAdapter] unexpected 3xx redirect", {
        status: submission.status,
        redirectLocation: submission.redirectLocation,
      });
      return {
        status: submission.status,
        body: { redirectLocation: submission.redirectLocation },
      };
    }

    // Validation: 200 with form re-rendered + invalid-feedback divs
    if (submission.status === 200) {
      const { errors } = parseFormErrors(submission.html);
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
    _trackingNumber: string,
    _config: CarrierConfig
  ): Promise<CarrierVoidResult> {
    return { success: false, supported: false };
  }
}
