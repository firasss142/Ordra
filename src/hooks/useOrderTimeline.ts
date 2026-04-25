import useSWR from "swr";
import type { OrderTimeline } from "@/app/api/orders/[id]/timeline/route";

export function useOrderTimeline(orderId: string | null) {
  const key = orderId ? `/api/orders/${orderId}/timeline` : null;
  const { data, error, isLoading, mutate } = useSWR<OrderTimeline>(key, {
    revalidateOnFocus: false,
  });
  return { timeline: data ?? null, error, isLoading, mutate };
}
