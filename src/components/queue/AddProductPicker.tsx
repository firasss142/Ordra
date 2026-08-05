"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { stockBadge } from "@/lib/products/stock-badge";
import { fetcher } from "@/lib/swr-config";
import { useOrderMutation } from "@/hooks/useOrderMutation";

export interface ProductSearchResult {
  id: string;
  market_id: string;
  name: string;
  unit_price: number;
  current_stock: number;
  is_active: boolean;
  image_url?: string | null;
  product_variants?: { id: string; label: string; is_active: boolean }[];
}

export interface AddProductPickerProps {
  orderId: string;
  marketId: string;
  /** product_ids already on the order — used to mark rows "alreadyAdded". */
  currentItemIds: (string | null)[];
  onClose: () => void;
  /** Fired right after the optimistic insert succeeds. */
  onAdded?: () => void;
  /**
   * Optional anchor element. When provided, the picker is rendered in a portal
   * and positioned under (or above) this element using its bounding rect — this
   * frees the popover from any `overflow:hidden` ancestor that would otherwise
   * clip it (e.g. the receipt card in OrderDetailPanel).
   */
  anchorRef?: React.RefObject<HTMLElement | null>;
}

const POPOVER_GAP = 6;
const POPOVER_MIN_WIDTH = 280;
const VIEWPORT_PADDING = 12;
const ESTIMATED_HEIGHT = 360;

export function AddProductPicker({
  orderId,
  marketId,
  currentItemIds,
  onClose,
  onAdded,
  anchorRef,
}: AddProductPickerProps) {
  const t = useTranslations("orders.detail");

  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
    width: number;
    placement: "below" | "above";
  } | null>(null);

  const { addItemOptimistic } = useOrderMutation(orderId);

  const { data, isLoading } = useSWR<{ data: ProductSearchResult[] }>(
    `/api/products/search?market_id=${marketId}`,
    fetcher,
    { revalidateOnFocus: false, dedupingInterval: 60 * 1000 },
  );

  const products = data?.data ?? [];
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return products;
    return products.filter((p) => p.name.toLowerCase().includes(q));
  }, [products, query]);

  const alreadyAddedSet = useMemo(
    () => new Set(currentItemIds.filter(Boolean) as string[]),
    [currentItemIds],
  );

  // SSR guard for createPortal.
  useEffect(() => {
    setMounted(true);
  }, []);

  // Compute position from the anchor's bounding rect.
  useLayoutEffect(() => {
    if (!anchorRef?.current) return;

    function update() {
      const el = anchorRef?.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const vh =
        typeof window !== "undefined" ? window.innerHeight : ESTIMATED_HEIGHT * 2;
      const vw = typeof window !== "undefined" ? window.innerWidth : r.width;
      const spaceBelow = vh - r.bottom;
      const placement: "below" | "above" =
        spaceBelow < ESTIMATED_HEIGHT && r.top > spaceBelow ? "above" : "below";
      const width = Math.max(POPOVER_MIN_WIDTH, r.width);
      // Clamp so the popover never spills past the viewport horizontally.
      const maxLeft = vw - width - VIEWPORT_PADDING;
      const left = Math.min(Math.max(VIEWPORT_PADDING, r.left), Math.max(VIEWPORT_PADDING, maxLeft));
      const top =
        placement === "below"
          ? r.bottom + POPOVER_GAP
          : r.top - POPOVER_GAP;
      setPosition({ top, left, width, placement });
    }

    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setHighlighted(0);
  }, [query]);

  useEffect(() => {
    if (highlighted >= filtered.length) setHighlighted(0);
  }, [filtered.length, highlighted]);

  // Close on outside click — but ignore clicks on the anchor itself so its
  // own toggle handler can run normally.
  useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      const target = e.target as Node;
      if (containerRef.current?.contains(target)) return;
      if (anchorRef?.current?.contains(target)) return;
      onClose();
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, [onClose, anchorRef]);

  const select = useCallback(
    async (product: ProductSearchResult) => {
      if (submitting) return;
      setSubmitting(true);
      setError(null);
      try {
        await addItemOptimistic({
          product_id: product.id,
          product_name: product.name,
          quantity: 1,
          unit_price: product.unit_price,
        });
        onAdded?.();
        onClose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setSubmitting(false);
      }
    },
    [submitting, addItemOptimistic, onAdded, onClose],
  );

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlighted((h) => Math.min(h + 1, Math.max(0, filtered.length - 1)));
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(0, h - 1));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const opt = filtered[highlighted];
      if (opt) select(opt);
    }
  }

  function renderStockBadge(stock: number) {
    const { tone, key, count } = stockBadge(stock);
    return (
      <Badge tone={tone} dot>
        {t(key, count !== undefined ? { count } : undefined)}
      </Badge>
    );
  }

  // Inline (non-portal) mode for backwards compatibility / unit tests:
  // when no anchorRef is supplied, fall back to the original absolute placement.
  const useInline = !anchorRef;

  const popover = (
    <div
      ref={containerRef}
      role="dialog"
      aria-label={t("pickProduct")}
      className={[
        useInline
          ? "absolute z-50 mt-2 start-0 end-0"
          : "fixed z-[100]",
        "bg-surface-card border border-line-subtle rounded-card",
        "shadow-[0_8px_32px_rgba(0,0,0,0.12)]",
        "overflow-hidden",
      ].join(" ")}
      style={
        useInline
          ? undefined
          : position
            ? {
                top:
                  position.placement === "below"
                    ? position.top
                    : Math.max(VIEWPORT_PADDING, position.top - ESTIMATED_HEIGHT),
                left: position.left,
                width: position.width,
                maxHeight: `calc(100vh - ${VIEWPORT_PADDING * 2}px)`,
              }
            : { visibility: "hidden" }
      }
    >
      {/* Search input */}
      <div className="flex items-center gap-2 px-3 h-10 border-b border-line-subtle">
        <Search
          size={14}
          strokeWidth={2}
          aria-hidden="true"
          className="text-ink-muted flex-shrink-0"
        />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="add-product-listbox"
          aria-activedescendant={
            filtered[highlighted] ? `add-product-opt-${filtered[highlighted].id}` : undefined
          }
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t("searchProducts")}
          disabled={submitting}
          className="flex-1 h-full bg-transparent text-[14px] text-ink-primary placeholder:text-ink-muted outline-none disabled:opacity-50"
        />
      </div>

      {/* List */}
      <ul
        id="add-product-listbox"
        role="listbox"
        className="max-h-72 overflow-y-auto py-1"
      >
        {isLoading && products.length === 0 ? (
          <li className="px-3 py-6 text-center text-[13px] text-ink-muted">
            {t("searchPlaceholder")}
          </li>
        ) : filtered.length === 0 ? (
          <li className="px-3 py-6 text-center text-[13px] text-ink-muted">
            {t("noResults")}
          </li>
        ) : (
          filtered.map((p, i) => {
            const isAdded = alreadyAddedSet.has(p.id);
            const isHighlighted = i === highlighted;
            return (
              <li
                key={p.id}
                id={`add-product-opt-${p.id}`}
                role="option"
                aria-selected={isHighlighted}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => select(p)}
                className={[
                  "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-colors duration-fast",
                  isHighlighted ? "bg-surface-selected" : "hover:bg-surface-hover",
                  submitting ? "opacity-60 pointer-events-none" : "",
                ].join(" ")}
              >
                {/* Thumbnail / initial */}
                {p.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={p.image_url}
                    alt=""
                    className="w-8 h-8 rounded-md object-cover bg-surface-subdued flex-shrink-0"
                  />
                ) : (
                  <div
                    aria-hidden="true"
                    className="w-8 h-8 rounded-md bg-surface-subdued flex items-center justify-center text-[12px] font-semibold text-ink-secondary flex-shrink-0"
                  >
                    {p.name.charAt(0).toUpperCase()}
                  </div>
                )}

                {/* Name + price */}
                <div className="flex-1 min-w-0">
                  <div className="text-[14px] text-ink-primary truncate leading-tight">
                    {p.name}
                  </div>
                  <div className="text-[12px] text-ink-secondary tabular-nums leading-tight mt-0.5">
                    {p.unit_price}
                    {isAdded && (
                      <span className="ms-2 text-ink-muted">
                        · {t("alreadyAdded")}
                      </span>
                    )}
                  </div>
                </div>

                {/* Stock badge */}
                <div className="flex-shrink-0">{renderStockBadge(p.current_stock)}</div>
              </li>
            );
          })
        )}
      </ul>

      {/* Footer: error or keyboard hints */}
      <div className="border-t border-line-subtle px-3 py-2 min-h-[32px] flex items-center">
        {error ? (
          <span className="text-[12px] text-status-critical leading-tight">
            {error}
          </span>
        ) : submitting ? (
          <span className="text-[12px] text-ink-secondary">{t("adding")}</span>
        ) : (
          <span className="text-[11px] text-ink-muted">{t("kbdHints")}</span>
        )}
      </div>
    </div>
  );

  if (useInline) return popover;
  if (!mounted) return null;
  return createPortal(popover, document.body);
}
