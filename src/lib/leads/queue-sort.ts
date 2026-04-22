interface QueueLead {
  status: string;
  callback_scheduled_at: string | null;
  created_at: string;
}

export function sortAgentLeadQueue<T extends QueueLead>(leads: T[]): T[] {
  const now = new Date();

  function priority(l: QueueLead): number {
    if (
      l.status === "callback_scheduled" &&
      l.callback_scheduled_at !== null &&
      new Date(l.callback_scheduled_at) <= now
    ) {
      return 0;
    }
    if (
      l.status === "attempt_1" ||
      l.status === "attempt_2" ||
      l.status === "attempt_3"
    ) {
      return 1;
    }
    if (l.status === "assigned") return 2;
    if (l.status === "qualified") return 3;
    return 4;
  }

  return leads.slice().sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}
