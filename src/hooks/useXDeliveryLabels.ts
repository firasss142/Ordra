"use client";

import { useCallback, useEffect, useState } from "react";
import useSWR from "swr";
import { jsonFetcher } from "@/lib/fetchers";
import type { XDeliveryLabelSummary } from "@/app/api/warehouse/xdelivery-labels/route";
import type { XDeliveryLabelFormat } from "@/lib/labels/XDeliveryLabelPdf";

/**
 * X-Delivery labels for the warehouse screens (Phase 5): what is still to print, and the
 * print itself. The format is remembered per computer, not per site: a printer is plugged
 * into one machine, and the desk PC and a thermal station can sit in the same building.
 */

const KEY = "/api/warehouse/xdelivery-labels";
const FORMAT_KEY = "ordra.xdelivery.labelFormat";

function readFormat(): XDeliveryLabelFormat {
  try {
    return localStorage.getItem(FORMAT_KEY) === "thermal" ? "thermal" : "a4x2";
  } catch {
    return "a4x2";
  }
}

export function useXDeliveryLabels(enabled: boolean) {
  const { data, mutate } = useSWR<XDeliveryLabelSummary>(enabled ? KEY : null, jsonFetcher, {
    revalidateOnFocus: true,
    refreshInterval: 60_000,
  });
  const [format, setFormatState] = useState<XDeliveryLabelFormat>("a4x2");
  const [printing, setPrinting] = useState(false);

  // After mount: the server has no localStorage, and the first paint must match it.
  useEffect(() => setFormatState(readFormat()), []);

  const setFormat = useCallback((f: XDeliveryLabelFormat) => {
    setFormatState(f);
    try {
      localStorage.setItem(FORMAT_KEY, f);
    } catch {
      /* private mode: the choice lasts this visit only */
    }
  }, []);

  /** Prints `orderIds`, or every label still to print. Resolves false on any failure. */
  const print = useCallback(
    async (orderIds?: string[]): Promise<boolean> => {
      // Opened BEFORE the request: a tab opened after an await is a popup to the browser.
      const tab = window.open("", "_blank");
      setPrinting(true);
      try {
        const res = await fetch(KEY, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(orderIds ? { format, order_ids: orderIds } : { format }),
        });
        if (!res.ok) {
          tab?.close();
          return false;
        }
        const url = URL.createObjectURL(await res.blob());
        if (tab) {
          tab.location.href = url;
        } else {
          // Popups blocked: hand the PDF over as a download instead of losing it.
          const a = document.createElement("a");
          a.href = url;
          a.download = "etiquettes-xdelivery.pdf";
          a.click();
        }
        await mutate();
        return true;
      } catch {
        tab?.close();
        return false;
      } finally {
        setPrinting(false);
      }
    },
    [format, mutate],
  );

  return { summary: data, format, setFormat, print, printing };
}
