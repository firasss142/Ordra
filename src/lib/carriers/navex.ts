import { decrypt } from "@/lib/crypto";
import { mapCityToGovernorate } from "./governorates-v2";
import type { CarrierAdapter, CarrierConfig, CarrierDispatchResult, CarrierVoidResult, OrderForDispatch } from "@/types/carrier";

export class NavexAdapter implements CarrierAdapter {
  formatPayload(
    order: OrderForDispatch,
    config: CarrierConfig,
    _extra?: Record<string, unknown>
  ): string {
    if (!config.sender_name || !config.sender_location) {
      throw new Error(
        "Navex carrier config missing sender_name or sender_location"
      );
    }

    const params = new URLSearchParams({
      prix: String(order.total_price),
      nom: order.customer_name,
      gouvernerat: mapCityToGovernorate(order.customer_city),
      ville: order.customer_city,
      adresse: order.customer_address,
      tel: order.customer_phone,
      tel2: "",
      designation: `${order.product_name} - ${order.variant_label}`,
      nb_article: String(order.quantity),
      msg: order.customer_note ?? "",
      echange: "0",
      article: "",
      nb_echange: "0",
      ouvrir: "Non",
      sender_name: config.sender_name,
      sender_location: config.sender_location,
    });

    return params.toString();
  }

  async dispatch(payload: string, config: CarrierConfig): Promise<Response> {
    const token = decrypt(config.api_key_encrypted);
    const url = `https://app.navex.tn/api/${token}/v1/post.php`;

    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
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

    if (response.status === 201) {
      return {
        success: true,
        tracking_number: String(body.colis ?? ""),
        raw_response: body,
      };
    }

    if (response.status === 400) {
      return {
        success: false,
        error_message:
          String(body.status_message ?? body.message ?? "Erreur de validation Navex"),
        raw_response: body,
      };
    }

    if (
      response.status === 401 ||
      response.status === 403 ||
      response.status === 404
    ) {
      return {
        success: false,
        error_message:
          "Erreur de configuration transporteur. Contactez l'administrateur.",
        raw_response: body,
      };
    }

    return {
      success: false,
      error_message:
        "Le transporteur est temporairement indisponible. Réessayez dans quelques minutes.",
      raw_response: {},
    };
  }

  async voidDispatch(trackingNumber: string, config: CarrierConfig): Promise<CarrierVoidResult> {
    try {
      const token = decrypt(config.api_key_encrypted);
      const url = `https://app.navex.tn/api/${token}/v1/cancel.php`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ colis: trackingNumber }).toString(),
        signal: AbortSignal.timeout(10000),
      });
      if (res.ok) return { success: true, supported: true };
      return { success: false, supported: true, reason: `HTTP ${res.status}` };
    } catch (err) {
      return { success: false, supported: true, reason: String(err) };
    }
  }
}
