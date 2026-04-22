import type {
  CarrierAdapter,
  CarrierOrderData,
  CarrierConfig,
  CarrierRawResponse,
  CarrierDispatchResult,
} from "./types";
import { CarrierDispatchError } from "./errors";

export class DexpressAdapter implements CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    _config: CarrierConfig,
    extra?: Record<string, unknown>
  ): Record<string, string> {
    const payload: Record<string, string> = {
      client_name: order.customer_name,
      client_phone: order.customer_phone,
      client_address: order.customer_address ?? "",
      product_name: order.product_name,
      quantity: String(order.quantity),
      cod_amount: String(order.total_price),
    };

    if (extra?.state_id !== undefined) {
      payload.state_id = String(extra.state_id);
    }
    if (extra?.place_id !== undefined) {
      payload.place_id = String(extra.place_id);
    }

    return payload;
  }

  async dispatch(
    payload: Record<string, string>,
    config: CarrierConfig
  ): Promise<CarrierRawResponse> {
    const baseUrl = config.apiCredentials.api_base_url ?? config.apiEndpoint;
    const url = `${baseUrl}/create-order`;
    const apiKey = config.apiCredentials.api_key;

    const body = new URLSearchParams(payload).toString();

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${apiKey}`,
        },
        body,
        signal: AbortSignal.timeout(15000),
      });
    } catch (err) {
      throw new CarrierDispatchError(
        `Dexpress API request failed: ${err instanceof Error ? err.message : "Unknown error"}`
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
    // HTTP-level errors
    if (raw.status >= 500) {
      return {
        success: false,
        errorCode: "DEXPRESS_TRANSIENT",
        errorMessage: "Carrier temporarily unavailable",
        retryable: true,
      };
    }

    if (raw.status === 401 || raw.status === 403) {
      return {
        success: false,
        errorCode: "DEXPRESS_CONFIG",
        errorMessage: "Carrier configuration error",
        retryable: false,
      };
    }

    // Application-level response codes
    const body = raw.body as Record<string, unknown>;
    const code = body.code as number;

    if (code === 4000) {
      const data = body.data as Record<string, unknown>;
      return {
        success: true,
        trackingNumber: String(data.tracking_code ?? ""),
      };
    }

    if (code === 4011) {
      return {
        success: false,
        errorCode: "DEXPRESS_INVALID_STATE",
        errorMessage: "Invalid state selected",
        retryable: false,
      };
    }

    if (code === 4012) {
      return {
        success: false,
        errorCode: "DEXPRESS_INVALID_PLACE",
        errorMessage: "Invalid place selected",
        retryable: false,
      };
    }

    if (code === 4010) {
      return {
        success: false,
        errorCode: "DEXPRESS_VALIDATION",
        errorMessage: String(body.message ?? "Validation error"),
        retryable: false,
      };
    }

    return {
      success: false,
      errorCode: "DEXPRESS_UNKNOWN",
      errorMessage: String(body.message ?? "Unknown error"),
      retryable: false,
    };
  }
}
