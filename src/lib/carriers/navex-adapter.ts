import type {
  CarrierAdapter,
  CarrierOrderData,
  CarrierConfig,
  CarrierRawResponse,
  CarrierDispatchResult,
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
      nom: order.customer_name,
      tel: order.customer_phone,
      adresse: order.customer_address ?? "",
      gouvernerat: resolveGovernorate(order.customer_city) ?? "",
      cod: String(order.total_price),
      produit: order.product_name,
      nb_piece: String(order.quantity),
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

    return { status: response.status, body: parsedBody };
  }

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult {
    if (raw.status === 201) {
      const body = raw.body as Record<string, unknown>;
      return {
        success: true,
        trackingNumber: String(body.colis ?? ""),
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

    return {
      success: false,
      errorCode: "NAVEX_TRANSIENT",
      errorMessage: "Carrier temporarily unavailable",
      retryable: true,
    };
  }
}
