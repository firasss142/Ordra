import { decrypt } from "@/lib/crypto";
import type { CarrierAdapter, CarrierConfig, CarrierDispatchResult, CarrierVoidResult, OrderForDispatch } from "@/types/carrier";

export class DexpressAdapter implements CarrierAdapter {
  formatPayload(
    order: OrderForDispatch,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): string {
    if (!config.api_base_url) {
      throw new Error("Dexpress carrier config missing api_base_url");
    }

    if (extra?.state_id === undefined || extra?.state_id === null) {
      throw new Error("Dexpress dispatch requires state_id in extra");
    }

    const params = new URLSearchParams({
      state_id: String(extra.state_id),
      place_id: extra?.place_id !== undefined ? String(extra.place_id) : "",
      name: order.customer_name,
      address: order.customer_address,
      phone: order.customer_phone,
      whatsapp: "",
      phone_2: "",
      info: `${order.product_name} - ${order.variant_label}`,
      notes: order.customer_note ?? "",
      women_delivery: "0",
      qty: String(order.quantity),
      order_total: String(order.total_price),
      amount_type: "with_delivery_cost",
      cost_type: "0",
      source_creation: "oms",
    });

    return params.toString();
  }

  async dispatch(payload: string, config: CarrierConfig): Promise<Response> {
    if (!config.api_base_url) {
      throw new Error("Dexpress carrier config missing api_base_url");
    }

    const apiKey = decrypt(config.api_key_encrypted);
    const url = `${config.api_base_url}/create-order`;

    return fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: apiKey,
      },
      body: payload,
      signal: AbortSignal.timeout(15000),
    });
  }

  async parseResponse(response: Response): Promise<CarrierDispatchResult> {
    let body: Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      // non-JSON body
    }

    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error_message:
          "خطأ في تكوين شركة التوصيل. اتصل بالمسؤول.",
        raw_response: body,
      };
    }

    if (response.status >= 500) {
      return {
        success: false,
        error_message: "شركة التوصيل غير متاحة مؤقتاً. حاول مرة أخرى.",
        raw_response: {},
      };
    }

    const code = body.code as number | undefined;

    if (code === 4000) {
      const data = body.data as Record<string, unknown> | undefined;
      return {
        success: true,
        tracking_number: String(data?.tracking_code ?? ""),
        raw_response: body,
      };
    }

    if (code === 4011) {
      return {
        success: false,
        error_message: "ولاية التوصيل غير صالحة",
        raw_response: body,
      };
    }

    if (code === 4012) {
      return {
        success: false,
        error_message: "مكان التوصيل غير صالح",
        raw_response: body,
      };
    }

    if (code === 4010) {
      return {
        success: false,
        error_message:
          "بيانات الطلب غير صالحة: " + JSON.stringify(body.errors ?? {}),
        raw_response: body,
      };
    }

    return {
      success: false,
      error_message: "شركة التوصيل غير متاحة مؤقتاً. حاول مرة أخرى.",
      raw_response: {},
    };
  }

  // DExpress does not expose a public cancel/void endpoint yet.
  async voidDispatch(_trackingNumber: string, _config: CarrierConfig): Promise<CarrierVoidResult> {
    return { success: false, supported: false, reason: "DExpress void not supported — contact carrier manually" };
  }
}
