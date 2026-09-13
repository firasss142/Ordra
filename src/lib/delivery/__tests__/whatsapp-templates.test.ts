import { describe, test, expect } from "vitest";
import {
  TEMPLATE_KEYS,
  renderTemplate,
  toE164,
  buildWaLink,
  suggestTemplate,
} from "../whatsapp-templates";

const vars = {
  name: "هدى المبروك",
  amount: "185",
  currency: "LYD",
  carrier: "Darb Assabil",
  courier: "علي بن عمر",
  address: "عين زارة، خلف مسجد النور",
};

describe("toE164", () => {
  test("Libyan numbers lose the trunk zero and gain 218", () => {
    expect(toE164("0913322110", "ly")).toBe("218913322110");
    expect(toE164("091 332 2110", "ly")).toBe("218913322110");
    expect(toE164("+218913322110", "ly")).toBe("218913322110");
    expect(toE164("00218913322110", "ly")).toBe("218913322110");
  });

  test("Tunisian numbers gain 216", () => {
    expect(toE164("22 123 456", "tn")).toBe("21622123456");
    expect(toE164("+21622123456", "tn")).toBe("21622123456");
  });

  test("anything that is not a plausible subscriber number yields null", () => {
    expect(toE164("", "ly")).toBeNull();
    expect(toE164("12345", "ly")).toBeNull();
    expect(toE164("0913322110", "tn")).toBeNull();
  });
});

describe("renderTemplate", () => {
  test("every key renders in both languages with the customer's name", () => {
    for (const key of TEMPLATE_KEYS) {
      for (const lang of ["ar", "fr"] as const) {
        const parts = renderTemplate(key, lang, vars);
        const text = parts.map((p) => p.text).join("");
        expect(text).toContain(vars.name);
        expect(text).not.toMatch(/\{\w+\}/);
      }
    }
  });

  test("variables are marked so the sheet can highlight them", () => {
    const parts = renderTemplate("before_delivery", "fr", vars);
    const marked = parts.filter((p) => p.variable).map((p) => p.text);
    expect(marked).toEqual([vars.name, vars.carrier, "185 LYD"]);
  });

  test("the address check quotes the address on file", () => {
    const text = renderTemplate("address_check", "ar", vars).map((p) => p.text).join("");
    expect(text).toContain(vars.address);
  });
});

describe("buildWaLink", () => {
  test("encodes the text and uses the E.164 number", () => {
    const link = buildWaLink("0913322110", "ly", "مرحباً\nهدى");
    expect(link).toBe(
      "https://wa.me/218913322110?text=" + encodeURIComponent("مرحباً\nهدى"),
    );
  });

  test("returns null when the number is unusable", () => {
    expect(buildWaLink("123", "ly", "x")).toBeNull();
  });
});

describe("suggestTemplate", () => {
  test("follows the situation, most urgent first", () => {
    expect(suggestTemplate({ bucket: "returning", status: "returning", remark_class: "no_answer" })).toBe(
      "returning_last_chance",
    );
    expect(suggestTemplate({ bucket: "act_now", status: "in_transit", remark_class: "no_answer" })).toBe(
      "courier_no_answer",
    );
    expect(suggestTemplate({ bucket: "act_now", status: "in_transit", remark_class: "wrong_address" })).toBe(
      "address_check",
    );
    expect(suggestTemplate({ bucket: "act_now", status: "delivery_delayed", remark_class: null })).toBe(
      "delayed_confirm_time",
    );
    expect(suggestTemplate({ bucket: "waiting_carrier", status: "out_for_delivery", remark_class: null })).toBe(
      "before_delivery",
    );
  });
});
