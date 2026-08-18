import { describe, test, expect } from "vitest";
import {
  findCancellationCause,
  shippingCostLegs,
  displayTimeline,
  currentHolder,
  statusHue,
  eventHue,
  initialOf,
  type DarbTimelineLike,
} from "./darb-shipment-display";

describe("findCancellationCause", () => {
  test("resolves a documented cause to a bilingual label", () => {
    expect(findCancellationCause("3-days-no-response")).toEqual({
      slug: "3-days-no-response",
      labelEn: "No answer for 3 days",
      labelAr: "لا يرد منذ 3 أيام",
    });
  });

  test("covers every cause the vendor documents, not just the ones seen so far", () => {
    for (const slug of [
      "not-needed",
      "fake",
      "mistake-by-store",
      "replacement",
      "other",
      "3-days-no-response",
      "incorrect-product-specs",
      "cancelled-by-the-customer",
    ]) {
      expect(findCancellationCause(slug), slug).not.toBeNull();
    }
  });

  test("returns null for an unknown or absent cause rather than throwing", () => {
    expect(findCancellationCause("teleported")).toBeNull();
    expect(findCancellationCause(null)).toBeNull();
    expect(findCancellationCause("")).toBeNull();
  });
});

describe("shippingCostLegs", () => {
  test("splits the carrier's own breakdown into ordered, non-zero legs", () => {
    expect(
      shippingCostLegs({ branchToBranch: 30, pickFromDoor: 0, dropToDoor: 5 }),
    ).toEqual([
      { key: "branchToBranch", amount: 30 },
      { key: "dropToDoor", amount: 5 },
    ]);
  });

  test("returns [] when the carrier sent no breakdown", () => {
    expect(shippingCostLegs(null)).toEqual([]);
    expect(shippingCostLegs({})).toEqual([]);
  });

  test("ignores non-numeric values rather than rendering NaN", () => {
    expect(
      shippingCostLegs({ branchToBranch: 30, junk: "x" } as unknown as Record<string, number>),
    ).toEqual([{ key: "branchToBranch", amount: 30 }]);
  });
});

describe("displayTimeline", () => {
  const events: DarbTimelineLike[] = [
    { event_id: "1", type: "info", description_ar: "تم إنشاء الشحنة", description_en: "Created", remarks: null, actor_name: null, actor_phone: null, occurred_at: "2026-08-13T14:12:00Z" },
    { event_id: "2", type: "referenced", description_ar: "تم إحالة الطلب بالرقم 1511544", description_en: "Reference the order by 1511544", remarks: null, actor_name: null, actor_phone: null, occurred_at: "2026-08-13T14:41:00Z" },
    { event_id: "3", type: "delayed", description_ar: null, description_en: "The order is delayed.", remarks: "لايرد ودزيت رساله", actor_name: "ايوب", actor_phone: "+218915094841", occurred_at: "2026-08-15T15:32:00Z" },
  ];

  test("drops the carrier's internal bookkeeping events", () => {
    // 'referenced' entries are untranslated internal noise ("Box Reference the
    // order by BX18KF") — useful in the stored audit trail, not in the panel.
    const shown = displayTimeline(events);
    expect(shown.map((e) => e.event_id)).toEqual(["3", "1"]);
  });

  test("orders newest first", () => {
    expect(displayTimeline(events)[0].event_id).toBe("3");
  });

  test("keeps a bookkeeping event when it carries a courier remark", () => {
    // A note from a person outweighs the event type — never drop human input.
    const withNote: DarbTimelineLike[] = [
      { ...events[1], remarks: "تم تغيير الصندوق" },
    ];
    expect(displayTimeline(withNote)).toHaveLength(1);
  });

  test("survives an empty or malformed list", () => {
    expect(displayTimeline([])).toEqual([]);
    expect(displayTimeline(null as unknown as DarbTimelineLike[])).toEqual([]);
  });
});

describe("currentHolder", () => {
  test("prefers the named courier and their direct line", () => {
    expect(
      currentHolder({
        handler_name: "ايوب مندوب البيضاء",
        handler_phone: "+218915094841",
        handler_account_name: "مكتب البيضاء",
        handler_account_phone: "+218918446655",
      }),
    ).toEqual({
      name: "ايوب مندوب البيضاء",
      phone: "+218915094841",
      office: "مكتب البيضاء",
      isOfficeFallback: false,
    });
  });

  test("falls back to the branch office, and says so", () => {
    // Darb assigns a courier only once a shipment is booked. Before that the
    // office is who you call — but the UI must not imply it is a person.
    expect(
      currentHolder({
        handler_name: null,
        handler_phone: null,
        handler_account_name: "مكتب البيضاء",
        handler_account_phone: "+218918446655",
      }),
    ).toEqual({
      name: "مكتب البيضاء",
      phone: "+218918446655",
      office: null,
      isOfficeFallback: true,
    });
  });

  test("returns null when nobody is holding it yet", () => {
    expect(
      currentHolder({
        handler_name: null,
        handler_phone: null,
        handler_account_name: null,
        handler_account_phone: null,
      }),
    ).toBeNull();
  });
});

describe("statusHue", () => {
  test("maps each carrier status to a meaning, not a decoration", () => {
    expect(statusHue("completed")).toBe("ok");
    expect(statusHue("returned")).toBe("bad");
    expect(statusHue("cancelled")).toBe("bad");
    expect(statusHue("delayed")).toBe("warn");
    expect(statusHue("returning")).toBe("warn");
    expect(statusHue("released")).toBe("info");
    expect(statusHue("on-branch")).toBe("info");
    expect(statusHue("processing")).toBe("info");
  });

  test("a not-yet-moving shipment stays neutral — nothing to signal yet", () => {
    expect(statusHue("pending")).toBe("neutral");
    expect(statusHue(null)).toBe("neutral");
  });

  test("an unknown status is neutral rather than alarming", () => {
    expect(statusHue("teleported")).toBe("neutral");
  });
});

describe("eventHue", () => {
  test("colours an event by what it means for the parcel", () => {
    expect(eventHue("rejected")).toBe("bad");
    expect(eventHue("cancelled")).toBe("bad");
    expect(eventHue("delayed")).toBe("warn");
    expect(eventHue("completed")).toBe("ok");
    expect(eventHue("accepted")).toBe("ok");
    expect(eventHue("assigned")).toBe("info");
    expect(eventHue("released")).toBe("info");
  });

  test("bookkeeping and plain info stay neutral so real signals stand out", () => {
    expect(eventHue("info")).toBe("neutral");
    expect(eventHue("referenced")).toBe("neutral");
    expect(eventHue("whatever")).toBe("neutral");
  });
});

describe("initialOf", () => {
  test("takes the first letter of an Arabic courier name", () => {
    expect(initialOf("ايوب مندوب البيضاء")).toBe("ا");
  });

  test("handles Latin names and stray whitespace", () => {
    expect(initialOf("  firas kr ")).toBe("F");
  });

  test("returns null rather than an empty circle", () => {
    expect(initialOf(null)).toBeNull();
    expect(initialOf("   ")).toBeNull();
  });
});
