import { describe, it, expect } from "vitest";
import { ConvertySheetsAdapter } from "./converty-sheets-adapter";
import { PayloadMappingError } from "@/lib/storefronts/errors";

const adapter = new ConvertySheetsAdapter();

const baseRow = {
  "Reference": "1439",
  "QR Code": "6a0c4e064992e02ef080ea3b",
  "Name": "شادي",
  "Phone": "914009883",
  "City": "طرابلس",
  "Address": "عين زاره خمس شورع",
  "Products": "مصحف القرآن تدبر وعمل حجم كبير x 1",
  "Quantity": "1",
  "Status": "pending",
  "Note": "",
  "Delivery Price": "0",
  "Total Price": "199",
  "Delivery Company": "none",
  "Barcode": "",
  "Created At": "2026-05-19T13:48:22.000Z",
  "Updated At": "2026-05-19T13:48:33.000Z",
};

describe("ConvertySheetsAdapter", () => {
  describe("platform", () => {
    it("has platform tag 'converty'", () => {
      expect(adapter.platform).toBe("converty");
    });
  });

  describe("mapRow — happy path", () => {
    it("maps QR Code to external_id", () => {
      const result = adapter.mapRow(baseRow);
      expect(result.external_id).toBe("6a0c4e064992e02ef080ea3b");
    });

    it("sets external_platform to 'converty'", () => {
      expect(adapter.mapRow(baseRow).external_platform).toBe("converty");
    });

    it("maps Name to customer_name", () => {
      expect(adapter.mapRow(baseRow).customer_name).toBe("شادي");
    });

    it("maps Phone string to customer_phone", () => {
      expect(adapter.mapRow(baseRow).customer_phone).toBe("914009883");
    });

    it("maps City to customer_city", () => {
      expect(adapter.mapRow(baseRow).customer_city).toBe("طرابلس");
    });

    it("maps Address to customer_address", () => {
      expect(adapter.mapRow(baseRow).customer_address).toBe("عين زاره خمس شورع");
    });

    it("maps Total Price to total_price as number", () => {
      expect(adapter.mapRow(baseRow).total_price).toBe(199);
    });

    it("parses quantity from 'Product Name x N' in Products column", () => {
      const result = adapter.mapRow({ ...baseRow, "Products": "Widget Pro x 3" });
      expect(result.quantity).toBe(3);
      expect(result.product_name).toBe("Widget Pro");
    });

    it("computes unit_price as total_price / quantity", () => {
      const result = adapter.mapRow({ ...baseRow, "Products": "Item x 2", "Total Price": "100" });
      expect(result.unit_price).toBe(50);
    });

    it("unit_price equals total_price when quantity is 1", () => {
      const result = adapter.mapRow(baseRow);
      expect(result.unit_price).toBe(199);
    });

    it("maps Note to customer_note", () => {
      const result = adapter.mapRow({ ...baseRow, "Note": "Leave at door" });
      expect(result.customer_note).toBe("Leave at door");
    });

    it("sets customer_note to null when Note is empty string", () => {
      expect(adapter.mapRow(baseRow).customer_note).toBeNull();
    });

    it("sets dexpress_state_id to null", () => {
      expect(adapter.mapRow(baseRow).dexpress_state_id).toBeNull();
    });

    it("sets sku to null", () => {
      expect(adapter.mapRow(baseRow).sku).toBeNull();
    });

    it("sets variant_label to null", () => {
      expect(adapter.mapRow(baseRow).variant_label).toBeNull();
    });

    it("sets external_variant_id to a stable slug derived from the product name", () => {
      // Enables the /mappings UI: the explicit mapping path in the product
      // resolver requires a non-null external_variant_id. Without this, sheet
      // orders never appear in the mappings review surface and can only resolve
      // via fragile name-ILIKE. The slug is deterministic so the same product
      // name always produces the same key across syncs.
      const result = adapter.mapRow(baseRow);
      expect(result.external_variant_id).toBe("مصحف-القرآن-تدبر-وعمل-حجم-كبير");
    });

    it("external_variant_id is the same regardless of quantity in Products column", () => {
      const r1 = adapter.mapRow({ ...baseRow, "Products": "Widget Pro x 1" });
      const r2 = adapter.mapRow({ ...baseRow, "Products": "Widget Pro x 5" });
      expect(r1.external_variant_id).toBe(r2.external_variant_id);
      expect(r1.external_variant_id).toBe("widget-pro");
    });

    it("external_variant_id is lowercase ASCII-safe", () => {
      const result = adapter.mapRow({ ...baseRow, "Products": "Book  A  x 2" });
      // Multiple spaces collapsed, lowercased, no trailing dash
      expect(result.external_variant_id).not.toMatch(/\s/);
      expect(result.external_variant_id).not.toMatch(/--/);
    });

    it("ignores Status column — does not set status field", () => {
      // The adapter returns InternalOrderData which has no status field.
      // Status is always set by the engine to 'pending'. This verifies
      // the adapter does not attempt to map 'abandoned' to anything.
      const result = adapter.mapRow({ ...baseRow, "Status": "abandoned" });
      expect(result).not.toHaveProperty("status");
    });
  });

  describe("mapRow — Phone coercion", () => {
    it("stringifies numeric phone values from the Sheets API", () => {
      // The Google Sheets API returns phone numbers as numbers when the cell
      // is not explicitly formatted as text. The adapter must stringify them.
      const result = adapter.mapRow({ ...baseRow, "Phone": "914009883" });
      expect(typeof result.customer_phone).toBe("string");
      expect(result.customer_phone).toBe("914009883");
    });
  });

  describe("mapRow — Products column fallback", () => {
    it("falls back to Quantity column when Products cannot be parsed as 'Name x N'", () => {
      const result = adapter.mapRow({
        ...baseRow,
        "Products": "Some Product Without Quantity Pattern",
        "Quantity": "5",
      });
      expect(result.product_name).toBe("Some Product Without Quantity Pattern");
      expect(result.quantity).toBe(5);
    });

    it("defaults quantity to 1 when Products unparseable and Quantity is missing", () => {
      const result = adapter.mapRow({
        ...baseRow,
        "Products": "No Pattern",
        "Quantity": "",
      });
      expect(result.quantity).toBe(1);
    });

    it("defaults unit_price to total_price when quantity resolves to 0", () => {
      const result = adapter.mapRow({
        ...baseRow,
        "Products": "Bad x 0",
        "Total Price": "99",
      });
      expect(result.unit_price).toBe(99);
    });
  });

  describe("mapRow — nullable fields", () => {
    it("sets customer_city to null when City is empty", () => {
      expect(adapter.mapRow({ ...baseRow, "City": "" }).customer_city).toBeNull();
    });

    it("sets customer_address to null when Address is empty", () => {
      expect(adapter.mapRow({ ...baseRow, "Address": "" }).customer_address).toBeNull();
    });
  });

  describe("mapRow — errors", () => {
    it("throws PayloadMappingError when QR Code is missing", () => {
      expect(() => adapter.mapRow({ ...baseRow, "QR Code": "" })).toThrow(
        PayloadMappingError
      );
      expect(() => adapter.mapRow({ ...baseRow, "QR Code": "" })).toThrow(
        "Missing QR Code"
      );
    });

    it("throws PayloadMappingError when Name is blank", () => {
      expect(() => adapter.mapRow({ ...baseRow, "Name": "" })).toThrow(
        PayloadMappingError
      );
      expect(() => adapter.mapRow({ ...baseRow, "Name": "   " })).toThrow(
        "Missing customer name"
      );
    });

    it("throws PayloadMappingError when Phone is blank", () => {
      expect(() => adapter.mapRow({ ...baseRow, "Phone": "" })).toThrow(
        PayloadMappingError
      );
      expect(() => adapter.mapRow({ ...baseRow, "Phone": "" })).toThrow(
        "Missing customer phone"
      );
    });

    it("throws PayloadMappingError when Total Price is non-numeric", () => {
      expect(() => adapter.mapRow({ ...baseRow, "Total Price": "N/A" })).toThrow(
        PayloadMappingError
      );
    });

    it("throws PayloadMappingError when Total Price is empty", () => {
      expect(() => adapter.mapRow({ ...baseRow, "Total Price": "" })).toThrow(
        PayloadMappingError
      );
    });

    it("throws PayloadMappingError when Products column is empty", () => {
      expect(() =>
        adapter.mapRow({ ...baseRow, "Products": "", "Quantity": "" })
      ).toThrow(PayloadMappingError);
    });
  });
});
