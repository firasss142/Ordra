export interface CarrierOrderData {
  customer_name: string;
  customer_phone: string;
  customer_address: string | null;
  customer_city: string | null;
  product_name: string;
  variant_label: string | null;
  quantity: number;
  total_price: number;
}

export interface CarrierConfig {
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
  | { success: true; trackingNumber: string }
  | {
      success: false;
      errorCode: string;
      errorMessage: string;
      retryable: boolean;
    };

export interface CarrierAdapter {
  formatPayload(
    order: CarrierOrderData,
    config: CarrierConfig,
    extra?: Record<string, unknown>
  ): Record<string, string>;

  dispatch(
    payload: Record<string, string>,
    config: CarrierConfig
  ): Promise<CarrierRawResponse>;

  parseResponse(raw: CarrierRawResponse): CarrierDispatchResult;
}
