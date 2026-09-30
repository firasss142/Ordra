import { describe, it, expect } from "vitest";
import { previewParts, toBodyParameters, resolveOrderVariables, resolveLeadVariables, resolveProductVariables, bodyToText, localizeVariables } from "../render";

/**
 * Variables are bound by POSITION on Meta's side ({{1}}..{{n}}) and by NAME on
 * ours (`whatsapp_templates.variables`). The renderer is the only place the
 * two meet; everything downstream (composer preview, outbox, campaign) trusts
 * it.
 */
describe("previewParts", () => {
  it("keeps the {text, variable} shape the WhatsApp sheet already highlights", () => {
    const parts = previewParts("Bonjour {{1}}, colis avec {{2}}.", ["name", "carrier"], { name: "Amel", carrier: "Navex" });
    expect(parts).toEqual([
      { text: "Bonjour ", variable: false },
      { text: "Amel", variable: true },
      { text: ", colis avec ", variable: false },
      { text: "Navex", variable: true },
      { text: ".", variable: false },
    ]);
  });

  it("renders a missing value as an em dash rather than leaving the placeholder", () => {
    const parts = previewParts("Hi {{1}}", ["name"], {});
    expect(parts[1]).toEqual({ text: "—", variable: true });
  });

  it("is safe on a body with no variables", () => {
    expect(previewParts("Merci.", [], {})).toEqual([{ text: "Merci.", variable: false }]);
  });
});

describe("toBodyParameters", () => {
  it("orders values by the variables array, never by object key order", () => {
    expect(toBodyParameters(["carrier", "name"], { name: "Amel", carrier: "Navex" })).toEqual(["Navex", "Amel"]);
  });

  it("strips newlines and tabs, which Meta rejects inside a parameter", () => {
    expect(toBodyParameters(["address"], { address: "Rue 1\nBloc B\tApt 4" })).toEqual(["Rue 1 Bloc B Apt 4"]);
  });

  it("caps a parameter at Meta's practical length", () => {
    const long = "x".repeat(2000);
    expect(toBodyParameters(["address"], { address: long })[0].length).toBeLessThanOrEqual(1024);
  });
});

describe("bodyToText", () => {
  it("fills placeholders into a plain string", () => {
    expect(bodyToText("Hi {{1}} — {{2}}", ["name", "amount"], { name: "A", amount: "9 TND" })).toBe("Hi A — 9 TND");
  });
});

describe("resolveOrderVariables", () => {
  const order = {
    id: "o-1",
    order_number: "TN-1042",
    customer_name: "Amel Ben Salah",
    customer_address: "12 rue de Carthage",
    customer_city: "Sousse",
    product_name: "Sérum vitamine C",
    total_price: 89,
    currency: "TND",
    tracking_number: "NX123",
    carrier_name: "Navex",
    courier_name: null,
    agent_name: "Sami",
  };

  it("fills every variable the catalogue can ask for", () => {
    const v = resolveOrderVariables(order);
    expect(v).toEqual({
      name: "Amel",
      order_ref: "TN-1042",
      carrier: "Navex",
      tracking: "NX123",
      amount: "89 TND",
      product: "Sérum vitamine C",
      city: "Sousse",
      address: "12 rue de Carthage",
      courier: "—",
      agent: "Sami",
      discount: "—",
    });
  });

  it("greets by first name, like the prototype (« مرحباً محمود »)", () => {
    expect(resolveOrderVariables({ ...order, customer_name: "Mohamed Ali Ben Abdallah El Amri" }).name).toBe("Mohamed");
    expect(resolveOrderVariables({ ...order, customer_name: "محمود السنوسي" }).name).toBe("محمود");
  });

  it("formats Libyan amounts with LYD and no decimals noise", () => {
    expect(resolveOrderVariables({ ...order, total_price: 150.5, currency: "LYD" }).amount).toBe("150.5 LYD");
    expect(resolveOrderVariables({ ...order, total_price: 150, currency: "LYD" }).amount).toBe("150 LYD");
  });
});

describe("resolveLeadVariables / resolveProductVariables", () => {
  it("binds a lead's name, product interest and the campaign offer", () => {
    expect(
      resolveLeadVariables({ customer_name: "Nour", customer_city: "Tripoli", product_name: "Crème", offer: "-20 %" }),
    ).toMatchObject({ name: "Nour", city: "Tripoli", product: "Crème", discount: "-20 %" });
  });

  it("binds a product's name and price for the share template", () => {
    expect(resolveProductVariables({ name: "Sérum", price: 89, currency: "TND" }, "Amel")).toMatchObject({
      name: "Amel",
      product: "Sérum",
      amount: "89 TND",
    });
  });
});

describe("localizeVariables — values in the TEMPLATE's language", () => {
  const values = resolveOrderVariables({ customer_name: "محمود السنوسي", total_price: 249, currency: "LYD", carrier_name: "Darb Assabil", tracking_number: "SH2164265" });

  it("Arabic templates get the Arabic currency sign and the carrier's Arabic name", () => {
    const ar = localizeVariables(values, "ar");
    expect(ar.amount).toBe("249 د.ل");
    expect(ar.carrier).toBe("درب السبيل");
    expect(ar.tracking).toBe("SH2164265");
    expect(localizeVariables({ ...values, amount: "89 TND" }, "ar").amount).toBe("89 د.ت");
  });

  it("French templates are left as resolved", () => {
    expect(localizeVariables(values, "fr")).toEqual(values);
  });
});
