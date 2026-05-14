import { describe, test, expect } from "vitest";
import { validateUuidOnlyPayload } from "./uuid-only-payload";

const valid = {
  customer: {
    name: "Ahmed",
    phone: "+21699999999",
    city: "Tunis",
    address: "12 Rue X",
  },
  product: { variant_id: 42, quantity: 2 },
};

describe("validateUuidOnlyPayload", () => {
  test("accepts a well-formed payload", () => {
    expect(validateUuidOnlyPayload(valid)).toEqual({ ok: true });
  });

  test("rejects non-object payload", () => {
    expect(validateUuidOnlyPayload("nope")).toEqual({
      ok: false,
      error: "Payload must be a JSON object",
    });
  });

  test("rejects missing customer", () => {
    const { customer, ...rest } = valid;
    void customer;
    expect(validateUuidOnlyPayload(rest)).toMatchObject({ ok: false });
  });

  test.each(["name", "phone", "city", "address"] as const)(
    "rejects empty customer.%s",
    (field) => {
      const bad = { ...valid, customer: { ...valid.customer, [field]: "" } };
      expect(validateUuidOnlyPayload(bad)).toEqual({
        ok: false,
        error: `customer.${field} must be a non-empty string`,
      });
    },
  );

  test.each(["name", "phone", "city", "address"] as const)(
    "rejects whitespace-only customer.%s",
    (field) => {
      const bad = { ...valid, customer: { ...valid.customer, [field]: "   " } };
      expect(validateUuidOnlyPayload(bad)).toMatchObject({ ok: false });
    },
  );

  test("rejects missing product", () => {
    const { product, ...rest } = valid;
    void product;
    expect(validateUuidOnlyPayload(rest)).toMatchObject({ ok: false });
  });

  test("rejects non-numeric variant_id", () => {
    const bad = { ...valid, product: { ...valid.product, variant_id: "42" } };
    expect(validateUuidOnlyPayload(bad)).toEqual({
      ok: false,
      error: "product.variant_id must be a number",
    });
  });

  test.each([0, -1, 1.5, "2", null])(
    "rejects invalid product.quantity (%s)",
    (q) => {
      const bad = { ...valid, product: { ...valid.product, quantity: q } };
      expect(validateUuidOnlyPayload(bad)).toEqual({
        ok: false,
        error: "product.quantity must be a positive integer",
      });
    },
  );
});
