interface QueueOrder {
  status: string;
  callback_scheduled_at: string | null;
  created_at: string;
}

export function sortAgentQueue<T extends QueueOrder>(orders: T[]): T[] {
  const now = new Date();

  function priority(order: QueueOrder): number {
    if (
      order.status === "callback_scheduled" &&
      order.callback_scheduled_at !== null &&
      new Date(order.callback_scheduled_at) <= now
    ) {
      return 0;
    }
    if (order.status === "attempt_1" || order.status === "attempt_2" || order.status === "attempt_3") {
      return 1;
    }
    if (order.status === "assigned") {
      return 2;
    }
    return 3;
  }

  return orders.slice().sort((a, b) => {
    const pa = priority(a);
    const pb = priority(b);
    if (pa !== pb) return pa - pb;
    return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
  });
}
