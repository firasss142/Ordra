import type { SWRConfiguration } from "swr";

export const fetcher = (url: string) =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error(`Fetch error ${r.status}`);
    return r.json();
  });

export const defaultSwrConfig: SWRConfiguration = {
  fetcher,
  focusThrottleInterval: 60000,
  dedupingInterval: 5000,
  keepPreviousData: true,
  revalidateIfStale: true,
  shouldRetryOnError: false,
};
