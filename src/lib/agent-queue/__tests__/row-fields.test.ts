import { describe, expect, test } from "vitest";
import { QUEUE_ROW_FIELDS, QUEUE_ROW_SELECT, pickQueueFields } from "../row-fields";

describe("QUEUE_ROW_SELECT", () => {
  test("never asks for raw_payload — the largest key on the wire, read by nothing here", () => {
    expect(QUEUE_ROW_SELECT).not.toContain("raw_payload");
    expect(QUEUE_ROW_FIELDS).not.toContain("raw_payload");
  });

  test("keeps the product and carrier embeds the card renders", () => {
    expect(QUEUE_ROW_SELECT).toContain(
      "product:products!orders_product_id_fkey(image_url, name)",
    );
    expect(QUEUE_ROW_SELECT).toContain("carrier:carriers!orders_carrier_id_fkey(code, name)");
  });

  test("carries the fields both enrichment RPCs build their payloads from", () => {
    for (const f of [
      "customer_phone", "customer_phone_2", "customer_name",
      "customer_address", "customer_city",
      "product_id", "product_name", "quantity", "created_at",
    ]) {
      expect(QUEUE_ROW_FIELDS).toContain(f);
    }
  });

  test("carries the fields the sort, bucketing and ownership checks read", () => {
    for (const f of [
      "id", "status", "assigned_to",
      "callback_scheduled_at", "scheduled_dispatch_at", "scheduled_dispatch_auto",
      "created_at",
    ]) {
      expect(QUEUE_ROW_FIELDS).toContain(f);
    }
  });

  test("lists no field twice", () => {
    expect(new Set(QUEUE_ROW_FIELDS).size).toBe(QUEUE_ROW_FIELDS.length);
  });

  // QUEUE_ROW_SELECT has to be a string literal for supabase-js to infer the
  // row shape at the type level, so it cannot be built from QUEUE_ROW_FIELDS.
  // This is what stops the two copies drifting: pickQueueFields uses the array,
  // the query uses the literal, and a field added to one but not the other
  // would mean realtime and fetch disagree about the row shape.
  test("the select literal and the field array describe the same columns", () => {
    const selectedColumns = QUEUE_ROW_SELECT.split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !s.includes("(") && !s.includes(")"));

    expect([...selectedColumns].sort()).toEqual([...QUEUE_ROW_FIELDS].sort());
  });
});

describe("pickQueueFields", () => {
  // A realtime postgres_changes payload carries every order column. Merging it
  // unnarrowed would reintroduce exactly what the select list dropped.
  const realtimeRow = {
    id: "o1",
    status: "attempt_1",
    assigned_to: "agent-1",
    customer_name: "Amina",
    raw_payload: { huge: "x".repeat(1000) },
    storefront_id: "sf-1",
    external_variant_id: "v-9",
    carrier_extra: { a: 1 },
    delivery_saving_lyd: 3,
  };

  test("drops raw_payload and the other columns the queue does not consume", () => {
    const picked = pickQueueFields(realtimeRow);
    expect(picked).not.toHaveProperty("raw_payload");
    expect(picked).not.toHaveProperty("storefront_id");
    expect(picked).not.toHaveProperty("external_variant_id");
    expect(picked).not.toHaveProperty("carrier_extra");
    expect(picked).not.toHaveProperty("delivery_saving_lyd");
  });

  test("keeps every field the queue does consume", () => {
    const picked = pickQueueFields(realtimeRow);
    expect(picked).toMatchObject({
      id: "o1",
      status: "attempt_1",
      assigned_to: "agent-1",
      customer_name: "Amina",
    });
  });

  // The reason this returns only keys PRESENT on the input rather than filling
  // the full field set with undefined: a spread merge must not clobber
  // server-derived values that realtime has no equivalent for.
  test("omits absent keys instead of writing undefined over them", () => {
    const picked = pickQueueFields({ id: "o1", status: "confirmed" });
    expect("tracking_number" in picked).toBe(false);

    const prev = {
      id: "o1",
      status: "attempt_1",
      product_display_name: "Vitamin C Serum",
      repeat_kind: "repeat",
      last_action_at: "2026-08-10T09:00:00Z",
    };
    const merged = { ...prev, ...picked };
    expect(merged.status).toBe("confirmed");
    expect(merged.product_display_name).toBe("Vitamin C Serum");
    expect(merged.repeat_kind).toBe("repeat");
    expect(merged.last_action_at).toBe("2026-08-10T09:00:00Z");
  });
});
