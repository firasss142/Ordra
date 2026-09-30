import { describe, expect, it } from "vitest";
import { makeFakeSupabase } from "@/test/helpers/fakeSupabase";
import { loadThread } from "../thread";

const TN = "00000000-0000-0000-0000-000000000001";

describe("loadThread", () => {
  it("signs each agent message with the sender's name, oldest first", async () => {
    const db = makeFakeSupabase({
      whatsapp_conversations: [{ id: "c1", market_id: TN, phone_e164: "21698765432", customer_id: null, unread_count: 0, last_inbound_at: null }],
      whatsapp_messages: [
        { id: "m2", conversation_id: "c1", direction: "out", sent_by: "u-1", actor_type: "agent", created_at: "2026-09-25T10:03:00Z" },
        { id: "m1", conversation_id: "c1", direction: "out", sent_by: null, actor_type: "system", created_at: "2026-09-24T17:40:00Z" },
      ],
      users: [{ id: "u-1", full_name: "Tasnim" }],
    });
    const thread = await loadThread(db.client as never, { marketId: TN, phones: ["98765432"] });
    expect(thread.messages.map((m) => [m.id, m.sent_by_name ?? null])).toEqual([
      ["m1", null],
      ["m2", "Tasnim"],
    ]);
  });
});
