import { describe, it, expect } from "vitest";
import { buildXDeliveryLabel, type XDeliveryLabelInput } from "./xdelivery-label";

/**
 * What the Ordra label for an X-Delivery parcel says (prototypes/xdelivery-label-v1.html):
 * their barcode on top, the depot code big, the recipient, the amount to collect, the
 * contents, and our QR. Every value must be the one X-Delivery received at upload.
 */

function input(over: Partial<XDeliveryLabelInput["order"]> = {}, rest: Partial<XDeliveryLabelInput> = {}): XDeliveryLabelInput {
  return {
    order: {
      id: "6f1c2a9e-0000-4000-8000-000000001042",
      external_id: "1042",
      tracking_number: "611791217700001",
      customer_name: "Client A.",
      customer_phone: "+216 22 123 456",
      customer_city: "Sousse",
      customer_address: "Rue de la Corniche, imm. B",
      total_price: 89.9,
      product_name: "Pantalon",
      variant_label: "M",
      quantity: 1,
      carrier_extra: null,
      ...over,
    },
    items: [],
    isOpened: false,
    sender: { name: "Boutique Exemple", phone: "71 000 000" },
    // 14:20 in Tunis.
    printedAt: new Date("2026-10-06T13:20:00Z"),
    ...rest,
  };
}

describe("buildXDeliveryLabel", () => {
  it("carries their barcode as-is, and grouped by four for the eye", () => {
    const l = buildXDeliveryLabel(input());
    expect(l.barcode).toBe("611791217700001");
    expect(l.barcodeText).toBe("6117 9121 7700 001");
  });

  it("without a pick: the governorate's main town, the delegation X-Delivery received", () => {
    const l = buildXDeliveryLabel(input());
    expect(l).toMatchObject({ governorate: "Sousse", delegation: "Sousse Ville", depot: "SH" });
  });

  it("with the agent's pick saved at upload, that pick", () => {
    const l = buildXDeliveryLabel(
      input({ carrier_extra: { xdelivery_governorate: "Sousse", xdelivery_delegation: "Sousse Jaouhara" } }),
    );
    expect(l).toMatchObject({ governorate: "Sousse", delegation: "Sousse Jaouhara", depot: "SH" });
  });

  it("the governorate picked at upload wins over the order's city", () => {
    const l = buildXDeliveryLabel(input({ customer_city: "Tripoli", carrier_extra: { xdelivery_governorate: "Sfax" } }));
    expect(l).toMatchObject({ governorate: "Sfax", delegation: "Sfax Ville", depot: "SF" });
  });

  it("an unresolvable destination still prints, with the city as written and no depot", () => {
    const l = buildXDeliveryLabel(input({ customer_city: "Quelque part" }));
    expect(l).toMatchObject({ governorate: "Quelque part", delegation: "", depot: "" });
  });

  it("no city at all: a dash, never an empty box on the parcel", () => {
    expect(buildXDeliveryLabel(input({ customer_city: null }))).toMatchObject({ governorate: "—", delegation: "", depot: "" });
  });

  it("the phone in the 8 digits they hold, spaced 2-3-3", () => {
    expect(buildXDeliveryLabel(input()).phone).toBe("22 123 456");
    expect(buildXDeliveryLabel(input({ customer_phone: "0021698765432" })).phone).toBe("98 765 432");
    expect(buildXDeliveryLabel(input({ customer_phone: "12345" })).phone).toBe("12345");
  });

  it("the amount to collect in dinars, three decimals, no invisible bidi marks", () => {
    expect(buildXDeliveryLabel(input()).cod).toBe("89,900 DT");
    expect(buildXDeliveryLabel(input({ total_price: 1250 })).cod).toBe("1 250,000 DT");
  });

  it("« Ouvrir le colis » follows the account setting", () => {
    expect(buildXDeliveryLabel(input()).open).toBe("NON");
    expect(buildXDeliveryLabel(input({}, { isOpened: true })).open).toBe("OUI");
  });

  it("every line of the parcel, from order_items when present", () => {
    const l = buildXDeliveryLabel(
      input({}, {
        items: [
          { product_name: "Robe", variant_label: "S", quantity: 1 },
          { product_name: "Ceinture", variant_label: null, quantity: 2 },
        ],
      }),
    );
    expect(l.items).toEqual(["1× Robe S", "2× Ceinture"]);
  });

  it("the order's own line when there are no items", () => {
    expect(buildXDeliveryLabel(input()).items).toEqual(["1× Pantalon M"]);
  });

  it("a long parcel keeps four lines and says how many more", () => {
    const items = Array.from({ length: 6 }, (_, i) => ({ product_name: `Article ${i + 1}`, variant_label: null, quantity: 1 }));
    expect(buildXDeliveryLabel(input({}, { items })).items).toEqual([
      "1× Article 1",
      "1× Article 2",
      "1× Article 3",
      "1× Article 4",
      "+ 2 autres articles",
    ]);
  });

  it("our side: the order id for the QR, the storefront number, the print time in Tunis", () => {
    const l = buildXDeliveryLabel(input());
    expect(l).toMatchObject({
      qr: "6f1c2a9e-0000-4000-8000-000000001042",
      ref: "Commande #1042",
      date: "06/10/2026 14:20",
      sender: "Boutique Exemple · 71 000 000",
    });
  });

  it("no storefront number: the short order id", () => {
    expect(buildXDeliveryLabel(input({ external_id: null })).ref).toBe("Commande 6F1C2A9E");
  });
});
