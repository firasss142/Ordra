import { describe, test, expect } from "vitest";
import { mergeTimeline } from "../timeline";

describe("mergeTimeline", () => {
  const history = [
    { id: "h1", status_from: "confirmed", status_to: "uploaded", note: null, created_at: "2026-09-10T08:00:00Z" },
    { id: "h2", status_from: "uploaded", status_to: "scanned", note: null, created_at: "2026-09-10T12:00:00Z" },
  ];
  const events = [
    { id: "e1", type: "delayed", description_ar: "تم تأجيل", description_en: "Delayed", remarks: "الزبون لم يرد", actor_name: "علي", occurred_at: "2026-09-12T09:00:00Z" },
  ];
  const conversation = [
    { id: "c1", message: "اتصلت ولم يرد", author_name: "علي", posted_at: "2026-09-12T09:05:00Z" },
  ];
  const actions = [
    { id: "a1", action_type: "call_customer", outcome: "no_answer", note: "rien", actor_id: "me", actor_type: "agent", actor_name: "Tasnim", created_at: "2026-09-12T10:00:00Z" },
    { id: "a2", action_type: "proactive_call_task", outcome: "pending", note: null, actor_id: null, actor_type: "system", actor_name: null, created_at: "2026-09-11T10:00:00Z" },
  ];

  test("newest first, every source tagged", () => {
    const tl = mergeTimeline({ history, events, conversation, actions, viewerId: "me", lang: "fr" });
    expect(tl.map((e) => `${e.source}:${e.id}`)).toEqual([
      "action:a1",
      "remark:c1",
      "carrier:e1",
      "action:a2",
      "order:h2",
      "order:h1",
    ]);
  });

  test("marks the viewer's own actions, and nothing else, as mine", () => {
    const tl = mergeTimeline({ history, events, conversation, actions, viewerId: "me", lang: "fr" });
    expect(tl.filter((e) => e.mine).map((e) => e.id)).toEqual(["a1"]);
  });

  test("carrier events read in the viewer's language, falling back to the other", () => {
    const ar = mergeTimeline({ history: [], events, conversation: [], actions: [], viewerId: "me", lang: "ar" });
    expect(ar[0]).toMatchObject({ kind: "delayed", text: "تم تأجيل · الزبون لم يرد", actor: "علي" });
    const fr = mergeTimeline({ history: [], events, conversation: [], actions: [], viewerId: "me", lang: "fr" });
    expect(fr[0].text).toBe("Delayed · الزبون لم يرد");
    const onlyAr = mergeTimeline({
      history: [],
      events: [{ ...events[0], description_en: null, remarks: null }],
      conversation: [],
      actions: [],
      viewerId: "me",
      lang: "fr",
    });
    expect(onlyAr[0].text).toBe("تم تأجيل");
  });

  test("order history rows carry the status they moved to", () => {
    const tl = mergeTimeline({ history, events: [], conversation: [], actions: [], viewerId: "me", lang: "fr" });
    expect(tl[0]).toMatchObject({ source: "order", kind: "scanned" });
  });
});
