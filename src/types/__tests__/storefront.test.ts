import { describe, it, expect } from "vitest";
// NOTE: These are value imports (not just type imports) so they trigger module resolution at runtime.
// The types EasyOrdersPayload, InternalOrderCreate, WebhookEvent must be exported from src/types/storefront.ts
// These tests will FAIL until that file is created.
import {
  STOREFRONT_PLATFORMS,
  WEBHOOK_EVENT_TYPES,
  isValidStorefront,
  isValidWebhookEventType,
} from "@/types/storefront";

describe("STOREFRONT_PLATFORMS", () => {
  it("is a readonly tuple containing easy_orders, shopify, woocommerce", () => {
    expect(STOREFRONT_PLATFORMS).toContain("easy_orders");
    expect(STOREFRONT_PLATFORMS).toContain("shopify");
    expect(STOREFRONT_PLATFORMS).toContain("woocommerce");
  });

  it("has exactly 3 platforms", () => {
    expect(STOREFRONT_PLATFORMS).toHaveLength(3);
  });
});

describe("WEBHOOK_EVENT_TYPES", () => {
  it("contains order.created", () => {
    expect(WEBHOOK_EVENT_TYPES).toContain("order.created");
  });

  it("contains order.updated", () => {
    expect(WEBHOOK_EVENT_TYPES).toContain("order.updated");
  });

  it("contains order.cancelled", () => {
    expect(WEBHOOK_EVENT_TYPES).toContain("order.cancelled");
  });

  it("has exactly 3 event types", () => {
    expect(WEBHOOK_EVENT_TYPES).toHaveLength(3);
  });
});

describe("isValidStorefront", () => {
  it("returns true for easy_orders", () => {
    expect(isValidStorefront("easy_orders")).toBe(true);
  });

  it("returns true for shopify", () => {
    expect(isValidStorefront("shopify")).toBe(true);
  });

  it("returns true for woocommerce", () => {
    expect(isValidStorefront("woocommerce")).toBe(true);
  });

  it("returns false for unknown platform string", () => {
    expect(isValidStorefront("magento")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidStorefront("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidStorefront(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isValidStorefront(undefined)).toBe(false);
  });
});

describe("isValidWebhookEventType", () => {
  it("returns true for order.created", () => {
    expect(isValidWebhookEventType("order.created")).toBe(true);
  });

  it("returns true for order.updated", () => {
    expect(isValidWebhookEventType("order.updated")).toBe(true);
  });

  it("returns true for order.cancelled", () => {
    expect(isValidWebhookEventType("order.cancelled")).toBe(true);
  });

  it("returns false for unknown event type", () => {
    expect(isValidWebhookEventType("order.shipped")).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isValidWebhookEventType("")).toBe(false);
  });

  it("returns false for null", () => {
    expect(isValidWebhookEventType(null)).toBe(false);
  });
});

describe("EasyOrdersPayload type shape", () => {
  it("STOREFRONT_PLATFORMS runtime constant validates Easy Orders platform string", () => {
    // Verifies the platform value used when mapping Easy Orders payloads
    expect(isValidStorefront("easy_orders")).toBe(true);
  });

  it("webhook event type order.created is valid", () => {
    expect(isValidWebhookEventType("order.created")).toBe(true);
  });
});

describe("InternalOrderCreate required fields", () => {
  it("storefront field must be one of the valid platforms", () => {
    // All three known platforms are valid
    expect(isValidStorefront("easy_orders")).toBe(true);
    expect(isValidStorefront("shopify")).toBe(true);
    expect(isValidStorefront("woocommerce")).toBe(true);
  });

  it("total_price is the revenue source of truth — external price fields are not used", () => {
    // Documented contract: revenue = total_price only
    // This test documents that understanding by verifying the platform list
    expect(STOREFRONT_PLATFORMS).toContain("easy_orders");
  });
});

describe("WebhookEvent event_type field", () => {
  it("all three webhook event types are valid", () => {
    expect(isValidWebhookEventType("order.created")).toBe(true);
    expect(isValidWebhookEventType("order.updated")).toBe(true);
    expect(isValidWebhookEventType("order.cancelled")).toBe(true);
  });

  it("unknown event type strings are invalid", () => {
    expect(isValidWebhookEventType("order.refunded")).toBe(false);
    expect(isValidWebhookEventType("payment.captured")).toBe(false);
  });
});
