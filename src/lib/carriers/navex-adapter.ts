import type {
  CarrierAdapter,
  CarrierOrderData,
  CarrierConfig,
  CarrierRawResponse,
  CarrierDispatchResult,
  CarrierVoidResult,
} from "./types";
import { resolveGovernorate } from "./governorates";
import { CarrierDispatchError } from "./errors";

export class NavexAdapter implements CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    config: CarrierConfig,
    _extra?: Record<string, unknown>
  ): Record<string, string> {
    return {
      prix: String(order.total_price),
      nom: order.customer_name,
      gouvernerat: resolveGovernorate(order.customer_city) ?? "",
      ville: order.customer_city ?? "",
      adresse: order.customer_address ?? "",
      tel: order.customer_phone,
      tel2: "",
      designation: order.variant_label
        ? `${order.product_name} - ${order.variant_label}`
        : order.product_name,
      nb_article: String(order.quantity),
      msg: order.customer_note ?? "",
      echange: "0",
      article: "",
      nb_echange: "0",
      ouvrir: "Non",
      sender_name: config.apiCredentials.sender_name ?? "",
      sender_location: config.apiCredentials.sender_location ?? "",
    };
  }

  async dispatch(
    payload: Record<string, string>,
    config: CarrierConfig
  ): Promise<CarrierRawResponse> {
    const token = config.apiCredentials.token;
    const url = `${config.apiEndpoint}/${token}/v1/post.php`;

    const body = new URLSearchParams(payload).toString();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new CarrierDispatchError(
        `Navex API request failed: ${err instanceof Error ? err.message : "Unknown error"}`
      );
    }

    let parsedBody: unknown;
    try {
      parsedBody = await response.json();
    } catch {
      parsedBody = await response.text();
    }

    const isSuccess =
      response.status === 201 ||
      (response.status === 200 &&
        typeof parsedBody === "object" &&
        parsedBody !== null &&
        ((parsedBody as Record<string, unknown>).status === 1 ||
          (parsedBody as Record<string, unknown>).status === "1"));
    if (!isSuccess) {
      console.error("[NavexAdapter] non-success response", {
        status: response.status,
        url,
        body: parsedBody,
      });
    }

    return { status: response.status, body: parsedBody };
  }

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult {
    // Navex documents 201 with `colis`, but in practice returns 200 with
    // `{ status: 1, status_message: <tracking>, lien: <label URL> }`.
    // Treat both shapes as success.
    if (raw.status === 201 || raw.status === 200) {
      const body = (raw.body ?? {}) as Record<string, unknown>;
      const tracking = String(body.colis ?? body.status_message ?? "");
      const successFlag =
        body.status === 1 || body.status === "1" || raw.status === 201;
      if (tracking && successFlag) {
        return { success: true, trackingNumber: tracking };
      }
      // 200 without a positive status flag → treat as validation error
      // and surface the carrier's message so the operator can react.
      return {
        success: false,
        errorCode: "NAVEX_VALIDATION",
        errorMessage: String(body.status_message ?? body.message ?? "Validation error"),
        retryable: false,
      };
    }

    if (raw.status === 400) {
      const body = raw.body as Record<string, unknown>;
      return {
        success: false,
        errorCode: "NAVEX_VALIDATION",
        errorMessage: String(body.message ?? "Validation error"),
        retryable: false,
      };
    }

    if (raw.status === 401 || raw.status === 403 || raw.status === 404) {
      return {
        success: false,
        errorCode: "NAVEX_CONFIG",
        errorMessage: "Carrier configuration error",
        retryable: false,
      };
    }

    const body = raw.body;
    let bodyExcerpt = "";
    if (typeof body === "string") {
      bodyExcerpt = body.slice(0, 200);
    } else if (body && typeof body === "object") {
      try {
        bodyExcerpt = JSON.stringify(body).slice(0, 200);
      } catch {
        bodyExcerpt = "";
      }
    }
    return {
      success: false,
      errorCode: "NAVEX_TRANSIENT",
      errorMessage: `Carrier temporarily unavailable (HTTP ${raw.status}${bodyExcerpt ? `: ${bodyExcerpt}` : ""})`,
      retryable: true,
    };
  }

  async voidDispatch(
    trackingNumber: string,
    config: CarrierConfig
  ): Promise<CarrierVoidResult> {
    const token = config.apiCredentials.token;
    const url = `${config.apiEndpoint}/${token}/v1/cancel.php`;
    const body = `colis=${encodeURIComponent(trackingNumber)}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body,
        signal: AbortSignal.timeout(4000),
      });
      if (response.ok) {
        return { success: true, supported: true };
      }
      return {
        success: false,
        supported: true,
        reason: `HTTP ${response.status}`,
      };
    } catch (err) {
      return {
        success: false,
        supported: true,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
