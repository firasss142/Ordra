import useSWR from "swr";
import type { FollowUpCampaign } from "@/types/follow-up";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch campaigns");
    return res.json();
  });

export function useFollowUpCampaigns(
  marketId?: string | null,
  enabled: boolean = true,
) {
  const key = enabled
    ? marketId
      ? `/api/follow-up-campaigns?market_id=${marketId}`
      : "/api/follow-up-campaigns"
    : null;

  const { data, error, isLoading, mutate } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 5000,
  });

  return {
    campaigns: (data?.data ?? []) as FollowUpCampaign[],
    error,
    isLoading,
    mutate,
  };
}
