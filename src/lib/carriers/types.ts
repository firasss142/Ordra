export interface CarrierOrderData {
  customer_name: string;
  customer_phone: string;
  customer_phone_2: string | null;
  customer_whatsapp: string | null;
  customer_address: string | null;
  customer_city: string | null;
  customer_note: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
}

export interface CarrierConfig {
  id: string;
  code: string;
  apiEndpoint: string;
  apiCredentials: Record<string, string>;
  deliveryFee: number;
  returnFee: number;
}

export interface CarrierRawResponse {
  status: number;
  body: unknown;
}

export type CarrierDispatchResult =
  | {
      success: true;
      trackingNumber: string;
      /**
       * Carrier-specific data to persist on the order's `carrier_extra` JSONB
       * alongside the tracking number (e.g. Darb Assabil's internal `_id`,
       * needed later for status polling). Merged by `performDispatch`.
       */
      extra?: Record<string, unknown>;
    }
  | {
      success: false;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    };

export interface CarrierVoidResult {
  success: boolean;
  supported: boolean;
  reason?: string;
}

export interface CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): Record<string, string>;

  dispatch(
    payload: unknown,
    config: CarrierConfig
  ): Promise<CarrierRawResponse>;

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult;

  voidDispatch(
    trackingNumber: string,
    config: CarrierConfig,
    /**
     * The order's persisted `carrier_extra` JSONB. Some carriers cancel by a
     * different identifier than the tracking number — e.g. Darb Assabil's
     * `DELETE /api/local/shipments/:id` needs the internal `_id` stored in
     * `extra.darb_assabil_id`, not the human `SH…` reference. Optional so
     * carriers that void by tracking number (Dexpress, Navex) can ignore it.
     */
    extra?: Record<string, unknown>
  ): Promise<CarrierVoidResult>;
}
