import { describe, test, expect } from "vitest";
import {
  projectDarbShipment,
  projectDarbTimeline,
  projectDarbConversation,
  type DarbShipmentProjection,
} from "./darb-assabil-shipment";

/**
 * Shaped from a REAL Tripoli record captured 2026-08-17 by
 * scripts/probe-darb-shipments-list.ts (reference 1511544). Trimmed to the
 * fields under test; the field names and nesting are verbatim.
 */
const realRecord: Record<string, unknown> = {
  _id: "6a7dd0c820deaf35607d9197",
  reference: "1511544",
  status: "delayed",
  createdAt: "2026-08-13T14:12:24.796Z",
  updatedAt: "2026-08-16T20:37:09.101Z",
  delayedUntil: "2026-08-17T20:37:11.092Z",
  priority: 4,
  notes: "",
  groupReference: "BX26741BN",
  tags: ["#SH2043390"],
  toBranchGroup: "BYD",
  toZoneCode: "BN",
  handler: {
    _id: "67c66ecc7863ee1cbce8d2a8",
    fname: "ايوب",
    lname: "مندوب البيضاء",
    phone: "+218915094841",
  },
  handlerAccount: {
    _id: "67e9fc44b15f4c23894ce1e0",
    name: "مكتب البيضاء",
    phone: "+218918446655",
    email: "hashimh696@gmail.com",
  },
  service: { _id: "6783c612dcf305c9e775c987", title: "توصيل رجالي", attributes: ["male"] },
  to: { countryCode: "lby", city: "البيضاء", area: "البيضاء", address: "مراوة" },
  remainings: [{ currency: "lyd", amount: 179 }],
  invoices: [
    {
      currency: "lyd",
      items: [
        { type: "product", amount: 179, quantity: 1, isChargeable: true },
        {
          type: "shipping",
          amount: 35,
          currency: "lyd",
          breakdown: { branchToBranch: 30, pickFromDoor: 0, dropToDoor: 5 },
        },
      ],
    },
  ],
  attachments: [
    { url: "https://s3/…/a", mimeType: "image/jpeg", sizeInBytes: 75790, alt: "ImageAttachment" },
    { url: "https://s3/…/b", mimeType: "image/jpeg", sizeInBytes: 109199, alt: "ImageAttachment" },
  ],
  timeline: [
    {
      _id: "e1",
      type: "info",
      description: { en: "Shipment is created", ar: "تم إنشاء الشحنة" },
      timestamp: "2026-08-13T14:12:24.796Z",
      createdBy: { fname: "firas", lname: "kr", phone: "+218942050182" },
    },
    {
      _id: "e2",
      type: "referenced",
      description: { en: "Reference the order by 1511544", ar: "تم إحالة الطلب بالرقم 1511544" },
      timestamp: "2026-08-13T14:41:54.000Z",
      createdBy: { fname: "محمد", lname: "العجيلي", phone: "+218943090419" },
    },
    {
      _id: "e3",
      type: "delayed",
      description: { en: "The order is delayed.", ar: "" },
      remarks: "لايرد ودزيت رساله",
      timestamp: "2026-08-15T15:32:05.000Z",
      createdBy: { fname: "ايوب", lname: "مندوب البيضاء", phone: "+218915094841" },
    },
    {
      _id: "e4",
      type: "delayed",
      description: { en: "The order is delayed.", ar: "" },
      remarks: "يسكن في مراوه سيتم تحويلها إلى مندوب المناطق",
      timestamp: "2026-08-16T20:37:09.101Z",
      createdBy: { fname: "ايوب", lname: "مندوب البيضاء", phone: "+218915094841" },
    },
  ],
};

describe("projectDarbShipment", () => {
  const p = projectDarbShipment(realRecord) as DarbShipmentProjection;

  test("captures identity and status", () => {
    expect(p.darbId).toBe("6a7dd0c820deaf35607d9197");
    expect(p.reference).toBe("1511544");
    expect(p.slug).toBe("delayed");
    expect(p.rawStatus).toBe("delayed");
  });

  test("captures the courier's name and phone", () => {
    expect(p.handlerName).toBe("ايوب مندوب البيضاء");
    expect(p.handlerPhone).toBe("+218915094841");
  });

  test("captures the handling branch office", () => {
    expect(p.handlerAccountName).toBe("مكتب البيضاء");
    expect(p.handlerAccountPhone).toBe("+218918446655");
  });

  test("captures the latest courier remark — the 'why is this not delivered' field", () => {
    expect(p.latestRemark).toBe("يسكن في مراوه سيتم تحويلها إلى مندوب المناطق");
    expect(p.latestRemarkAt).toBe("2026-08-16T20:37:09.101Z");
  });

  test("captures the ACTUAL billed shipping cost and its breakdown", () => {
    expect(p.billedShippingAmount).toBe(35);
    expect(p.billedCurrency).toBe("lyd");
    expect(p.shippingBreakdown).toEqual({ branchToBranch: 30, pickFromDoor: 0, dropToDoor: 5 });
  });

  test("captures the outstanding COD amount", () => {
    expect(p.codOutstanding).toBe(179);
  });

  test("captures delay, routing, service and attachment metadata", () => {
    expect(p.delayedUntil).toBe("2026-08-17T20:37:11.092Z");
    expect(p.toBranchGroup).toBe("BYD");
    expect(p.toZoneCode).toBe("BN");
    expect(p.groupReference).toBe("BX26741BN");
    expect(p.serviceTitle).toBe("توصيل رجالي");
    expect(p.priority).toBe(4);
    expect(p.attachments).toHaveLength(2);
    expect(p.toCity).toBe("البيضاء");
    expect(p.toAddress).toBe("مراوة");
  });

  test("recovers the creation-time SH reference from tags", () => {
    // Darb re-references at booking but keeps the original as a #tag — the only
    // link back to the tracking_number we stored at dispatch.
    expect(p.originalReference).toBe("SH2043390");
  });

  test("normalizes an empty note to null rather than an empty string", () => {
    expect(p.notes).toBeNull();
  });

  test("tracks the newest timeline timestamp for delta detection", () => {
    expect(p.latestEventAt).toBe("2026-08-16T20:37:09.101Z");
  });

  test("returns null for a record with no usable id", () => {
    expect(projectDarbShipment({ reference: "x" })).toBeNull();
    expect(projectDarbShipment(null)).toBeNull();
    expect(projectDarbShipment("nope")).toBeNull();
  });

  test("survives a record carrying none of the optional fields", () => {
    const bare = projectDarbShipment({ _id: "abc", status: "pending" });
    expect(bare).toMatchObject({
      darbId: "abc",
      slug: "pending",
      handlerName: null,
      handlerPhone: null,
      billedShippingAmount: null,
      latestRemark: null,
      attachments: [],
    });
  });

  test("keeps rawStatus but nulls the slug for an unknown carrier status", () => {
    const odd = projectDarbShipment({ _id: "abc", status: "teleported" });
    expect(odd?.slug).toBeNull();
    expect(odd?.rawStatus).toBe("teleported");
  });

  test("reads cancellationCause and completedAt when the carrier supplies them", () => {
    const done = projectDarbShipment({
      _id: "z",
      status: "cancelled",
      cancellationCause: "3-days-no-response",
      cancelCount: 1,
      resendCount: 2,
      completedAt: "2026-08-16T07:18:49.384Z",
      deliveryWithdrawalAt: "2026-08-17T11:30:32.479Z",
    });
    expect(done).toMatchObject({
      cancellationCause: "3-days-no-response",
      cancelCount: 1,
      resendCount: 2,
      completedAt: "2026-08-16T07:18:49.384Z",
      deliveryWithdrawalAt: "2026-08-17T11:30:32.479Z",
    });
  });

  test("ignores a non-shipping invoice line when reading the billed fee", () => {
    const noShipping = projectDarbShipment({
      _id: "q",
      status: "pending",
      invoices: [{ currency: "lyd", items: [{ type: "product", amount: 100 }] }],
    });
    // A missing shipping line is NOT a zero fee.
    expect(noShipping?.billedShippingAmount).toBeNull();
  });
});

describe("projectDarbTimeline", () => {
  const events = projectDarbTimeline("6a7dd0c820deaf35607d9197", realRecord);

  test("keeps every event including bookkeeping ones — this is an audit log", () => {
    // The display layer drops 'referenced' noise; the stored history must not.
    expect(events).toHaveLength(4);
    expect(events.map((e) => e.type)).toEqual(["info", "referenced", "delayed", "delayed"]);
  });

  test("records who performed each event, with their phone", () => {
    expect(events[3]).toMatchObject({
      actorName: "ايوب مندوب البيضاء",
      actorPhone: "+218915094841",
      remarks: "يسكن في مراوه سيتم تحويلها إلى مندوب المناطق",
    });
  });

  test("leaves actor_* null when createdBy is a bare id, and never borrows the branch phone", () => {
    // This is the LIST-endpoint shape. timeline[].phone is the BRANCH line —
    // attributing it to a person would credit one courier with a whole office's
    // work (one such number appeared on 10,702 of 19,407 live events).
    const [e] = projectDarbTimeline("s1", {
      timeline: [
        {
          _id: "x1",
          type: "delayed",
          createdBy: "680e70a4233ffd6b66437a14",
          phone: "+218915446655",
          remarks: "مردش",
          timestamp: "2026-08-16T20:00:00Z",
        },
      ],
    });
    expect(e.actorName).toBeNull();
    expect(e.actorPhone).toBeNull();
    expect(e.actorId).toBe("680e70a4233ffd6b66437a14");
    expect(e.accountPhone).toBe("+218915446655");
    expect(e.remarks).toBe("مردش");
  });

  test("keeps both languages rather than collapsing to Arabic", () => {
    expect(events[0].descriptionAr).toBe("تم إنشاء الشحنة");
    expect(events[0].descriptionEn).toBe("Shipment is created");
  });

  test("carries a stable per-event id so re-sync is idempotent", () => {
    expect(events.map((e) => e.eventId)).toEqual(["e1", "e2", "e3", "e4"]);
    expect(events.every((e) => e.darbId === "6a7dd0c820deaf35607d9197")).toBe(true);
  });

  test("synthesizes a deterministic id when the carrier omits one", () => {
    const [a, b] = projectDarbTimeline("s1", {
      timeline: [
        { type: "info", timestamp: "2026-01-01T00:00:00Z", description: { en: "x" } },
        { type: "info", timestamp: "2026-01-01T00:00:00Z", description: { en: "y" } },
      ],
    });
    expect(a.eventId).toBeTruthy();
    // Same timestamp+type must NOT collide, or one event overwrites the other.
    expect(a.eventId).not.toBe(b.eventId);
  });

  test("returns [] for a record with no timeline", () => {
    expect(projectDarbTimeline("s1", { _id: "s1" })).toEqual([]);
    expect(projectDarbTimeline("s1", null)).toEqual([]);
  });
});

// ── projectDarbConversation ──────────────────────────────────────────
describe("projectDarbConversation", () => {
  // Real shape, captured from the 64 live shipments that carry a thread.
  const withThread = {
    _id: "s1",
    conversation: [
      {
        _id: "m1",
        message: "الزبون اجل الاستلام لي يوم الخميس قال خارج طرابلس موجود حاليا",
        createdBy: { fname: "مصطفى", lname: "الدريبي", phone: "+218935967849" },
        timestamp: "2026-08-10T09:00:00Z",
      },
      {
        _id: "m2",
        message: "مقفل اوخارج نطاق التغطية",
        createdBy: "6a2d5de9",
        timestamp: "2026-08-11T09:00:00Z",
      },
    ],
  };

  test("captures the carrier comment thread", () => {
    const rows = projectDarbConversation("s1", withThread);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      darbId: "s1",
      messageId: "m1",
      message: "الزبون اجل الاستلام لي يوم الخميس قال خارج طرابلس موجود حاليا",
      authorName: "مصطفى الدريبي",
      authorPhone: "+218935967849",
      postedAt: "2026-08-10T09:00:00Z",
    });
  });

  test("tolerates createdBy being a bare ObjectId string rather than a person", () => {
    // Darb returns either shape depending on whether it populated the ref.
    const rows = projectDarbConversation("s1", withThread);
    expect(rows[1].authorName).toBeNull();
    expect(rows[1].authorPhone).toBeNull();
    expect(rows[1].message).toBe("مقفل اوخارج نطاق التغطية");
  });

  test("synthesizes a stable id when the carrier omits one", () => {
    const rows = projectDarbConversation("s1", {
      conversation: [
        { message: "a", timestamp: "2026-01-01T00:00:00Z" },
        { message: "b", timestamp: "2026-01-01T00:00:00Z" },
      ],
    });
    expect(rows[0].messageId).not.toBe(rows[1].messageId);
  });

  test("drops an entry with no message rather than storing an empty comment", () => {
    const rows = projectDarbConversation("s1", {
      conversation: [{ _id: "m1", message: "   " }, { _id: "m2", message: "real" }],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].messageId).toBe("m2");
  });

  test("returns [] when the carrier sends no thread — the common case (92% of shipments)", () => {
    expect(projectDarbConversation("s1", { _id: "s1" })).toEqual([]);
    expect(projectDarbConversation("s1", { conversation: [] })).toEqual([]);
    expect(projectDarbConversation("s1", null)).toEqual([]);
  });
});

describe("projectDarbShipment — conversation summary", () => {
  test("surfaces the newest comment so the list view needs no join", () => {
    const p = projectDarbShipment({
      _id: "s1",
      status: "released",
      conversation: [
        { _id: "m1", message: "first", timestamp: "2026-08-10T09:00:00Z" },
        { _id: "m2", message: "مردش", timestamp: "2026-08-12T09:00:00Z" },
      ],
    });
    expect(p?.latestComment).toBe("مردش");
    expect(p?.latestCommentAt).toBe("2026-08-12T09:00:00Z");
    expect(p?.commentCount).toBe(2);
  });

  test("is null when there is no thread", () => {
    const p = projectDarbShipment({ _id: "s1", status: "pending" });
    expect(p?.latestComment).toBeNull();
    expect(p?.commentCount).toBe(0);
  });
});
