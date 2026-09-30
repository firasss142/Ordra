import { describe, expect, it } from "vitest";
import { retryRequest, windowUntil } from "../compose";

describe("retryRequest — « Réessayer » on a failed bubble resends the same thing", () => {
  const base = { language: "ar", template_id: null, body: null, kind: "text" } as const;

  it("a failed template is resent as that template in its language", () => {
    expect(retryRequest({ order_id: "o-1" }, { ...base, kind: "template", template_id: "t-1", body: "rendered" })).toEqual({
      target: { order_id: "o-1" }, language: "ar", mode: "template", template_id: "t-1",
    });
  });

  it("a failed free text is resent as text", () => {
    expect(retryRequest({ lead_id: "l-1" }, { ...base, language: "fr", body: "Je vous rappelle" })).toEqual({
      target: { lead_id: "l-1" }, language: "fr", mode: "text", text: "Je vous rappelle",
    });
  });

  it("nothing to resend → null (an image, or a message with no body)", () => {
    expect(retryRequest({ order_id: "o-1" }, { ...base, kind: "image" })).toBeNull();
    expect(retryRequest({ order_id: "o-1" }, { ...base })).toBeNull();
  });
});

describe("windowUntil", () => {
  it("same local day → no « demain »", () => {
    expect(windowUntil(new Date(2026, 8, 25, 18, 0).toISOString(), new Date(2026, 8, 25, 9, 0), "fr")).toEqual({ time: "18:00", tomorrow: false });
  });
});
