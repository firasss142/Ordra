import useSWR from "swr";

const fetcher = (url: string) =>
  fetch(url).then((res) => {
    if (!res.ok) throw new Error("Failed to fetch carriers");
    return res.json();
  });

export interface CarrierListItem {
  id: string;
  name: string;
  code: string;
  is_active: boolean;
}

export function useCarriers(marketId: string | null) {
  const key = marketId ? `/api/carriers?market_id=${marketId}` : null;

  const { data, error, isLoading } = useSWR(key, fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 60000,
  });

  const carriers = ((data?.data ?? []) as CarrierListItem[]).filter(
    (c) => c.is_active
  );

  return { carriers, error, isLoading };
}
