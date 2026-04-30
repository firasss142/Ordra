"use client";

import { useState } from "react";
import {
  CalendarDays,
  ChevronDown,
  Layers,
  MapPin,
  Package,
  Tag,
  Truck,
} from "lucide-react";
import { Popover } from "@/components/ui/Popover";
import type { Grouping, Subgrouping } from "@/lib/to-ship/types";

interface GroupingItem {
  key: Grouping;
  label: string;
  icon: React.ReactNode;
  hint?: string;
}

interface ToShipGroupingControlProps {
  grouping: Grouping;
  onChange: (g: Grouping) => void;
  subgrouping: Subgrouping;
  onSubgroupingChange: (s: Subgrouping) => void;
  labels: {
    groupBy: string;
    thenBy: string;
    city: string;
    product: string;
    carrier: string;
    schedule: string;
    status: string;
    none: string;
    subCity: string;
    subNone: string;
    cityHint?: string;
    productHint?: string;
    carrierHint?: string;
    scheduleHint?: string;
    statusHint?: string;
    noneHint?: string;
  };
}

const ICON_SIZE = 13;
const ICON_STROKE = 1.75;

export function ToShipGroupingControl({
  grouping,
  onChange,
  subgrouping,
  onSubgroupingChange,
  labels,
}: ToShipGroupingControlProps) {
  const items: GroupingItem[] = [
    {
      key: "city",
      label: labels.city,
      icon: <MapPin size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
      hint: labels.cityHint,
    },
    {
      key: "product",
      label: labels.product,
      icon: <Package size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
      hint: labels.productHint,
    },
    {
      key: "carrier",
      label: labels.carrier,
      icon: <Truck size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
      hint: labels.carrierHint,
    },
    {
      key: "schedule",
      label: labels.schedule,
      icon: <CalendarDays size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
      hint: labels.scheduleHint,
    },
    {
      key: "status",
      label: labels.status,
      icon: <Tag size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
      hint: labels.statusHint,
    },
    {
      key: "none",
      label: labels.none,
      icon: <Layers size={ICON_SIZE} strokeWidth={ICON_STROKE} />,
      hint: labels.noneHint,
    },
  ];

  const active = items.find((i) => i.key === grouping) ?? items[0];
  const allowSecondary = grouping === "product" || grouping === "carrier";

  const [primaryOpen, setPrimaryOpen] = useState(false);
  const [secondaryOpen, setSecondaryOpen] = useState(false);

  return (
    <div className="inline-flex items-center gap-1.5 flex-wrap">
      <span className="text-[12px] font-medium text-ink-secondary pe-1">
        {labels.groupBy}
      </span>

      <Popover
        align="start"
        open={primaryOpen}
        onOpenChange={setPrimaryOpen}
        panelClassName="p-1 w-[240px]"
        trigger={
          <button
            type="button"
            aria-label={labels.groupBy}
            className="inline-flex items-center gap-1.5 h-8 ps-2.5 pe-2 rounded-pill text-[13px] font-medium bg-ink-primary text-white border border-ink-primary hover:bg-[#2A2A2A] transition-colors duration-fast"
          >
            <span className="text-white">{active.icon}</span>
            <span className="truncate max-w-[160px]">{active.label}</span>
            <ChevronDown size={12} strokeWidth={2} className="opacity-70 ms-0.5" />
          </button>
        }
      >
        {(close) => (
          <ul role="listbox" className="m-0 p-0 max-h-[280px] overflow-y-auto">
            {items.map((it) => {
              const isActive = it.key === grouping;
              return (
                <li
                  key={it.key}
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    onChange(it.key);
                    close();
                  }}
                  className={[
                    "flex items-start gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors duration-fast",
                    isActive ? "bg-surface-selected" : "hover:bg-surface-hover",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-0.5 inline-flex items-center justify-center w-6 h-6 rounded-md",
                      isActive ? "bg-ink-primary text-white" : "bg-surface-page text-ink-secondary",
                    ].join(" ")}
                  >
                    {it.icon}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[13px] font-medium text-ink-primary leading-tight">
                      {it.label}
                    </span>
                    {it.hint && (
                      <span className="block text-[11px] text-ink-secondary leading-tight mt-0.5">
                        {it.hint}
                      </span>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Popover>

      {allowSecondary && (
        <>
          <span className="text-[12px] text-ink-secondary px-1">{labels.thenBy}</span>
          <Popover
            align="start"
            open={secondaryOpen}
            onOpenChange={setSecondaryOpen}
            panelClassName="p-1 w-[180px]"
            trigger={
              <button
                type="button"
                aria-label={labels.thenBy}
                className="inline-flex items-center gap-1.5 h-8 ps-2.5 pe-2 rounded-pill text-[13px] font-medium bg-surface-card text-ink-primary border border-line hover:bg-surface-hover transition-colors duration-fast"
              >
                <span className="text-ink-secondary">
                  {subgrouping === "city" ? (
                    <MapPin size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  ) : (
                    <Layers size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                  )}
                </span>
                <span>{subgrouping === "city" ? labels.subCity : labels.subNone}</span>
                <ChevronDown size={12} strokeWidth={2} className="opacity-60 ms-0.5" />
              </button>
            }
          >
            {(close) => (
              <ul role="listbox" className="m-0 p-0">
                {(["none", "city"] as Subgrouping[]).map((k) => {
                  const isActive = k === subgrouping;
                  const lbl = k === "city" ? labels.subCity : labels.subNone;
                  return (
                    <li
                      key={k}
                      role="option"
                      aria-selected={isActive}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        onSubgroupingChange(k);
                        close();
                      }}
                      className={[
                        "flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer text-[13px] transition-colors duration-fast",
                        isActive
                          ? "bg-surface-selected text-ink-primary font-medium"
                          : "text-ink-primary hover:bg-surface-hover",
                      ].join(" ")}
                    >
                      <span className="text-ink-secondary">
                        {k === "city" ? (
                          <MapPin size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                        ) : (
                          <Layers size={ICON_SIZE} strokeWidth={ICON_STROKE} />
                        )}
                      </span>
                      <span>{lbl}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Popover>
        </>
      )}
    </div>
  );
}
