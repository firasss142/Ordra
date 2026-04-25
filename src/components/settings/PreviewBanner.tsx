"use client";

import useSWR from "swr";

interface PreviewResponse {
  current: number;
  next: number;
  direction: "expand" | "shrink" | "noop";
  affectedCount: number;
}

const fetcher = (url: string) => fetch(url).then((r) => r.json());

export function PreviewBanner({
  marketId,
  currentValue,
  pendingValue,
}: {
  marketId: string;
  currentValue: number;
  pendingValue: number;
}) {
  const shouldFetch =
    marketId &&
    Number.isInteger(pendingValue) &&
    pendingValue !== currentValue;

  const { data } = useSWR<PreviewResponse>(
    shouldFetch
      ? `/api/settings/${marketId}/preview?key=max_call_attempts&value=${pendingValue}`
      : null,
    fetcher,
  );

  if (!shouldFetch || !data) return null;

  const warn = data.direction === "shrink";
  const count = data.affectedCount;

  return (
    <div
      role="status"
      style={{
        marginTop: 8,
        padding: "10px 12px",
        borderRadius: 6,
        border: `1px solid ${warn ? "#F0B6B4" : "#E1E3E5"}`,
        backgroundColor: warn ? "#FFF5F5" : "#FAFBFB",
        color: warn ? "#8E1F0B" : "#1A1A1A",
        fontSize: 13,
      }}
    >
      {warn ? (
        <>
          ⚠ Réduire à {pendingValue} rejetterait automatiquement{" "}
          <strong>{count}</strong>{" "}
          commande{count === 1 ? "" : "s"} active{count === 1 ? "" : "s"}.
        </>
      ) : (
        <>
          Augmenter à {pendingValue} rendrait{" "}
          <strong>{count}</strong>{" "}
          commande{count === 1 ? "" : "s"} rejetée{count === 1 ? "" : "s"}{" "}
          à nouveau joignable{count === 1 ? "" : "s"}.
        </>
      )}
    </div>
  );
}
