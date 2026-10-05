"use client";

// The ⋯ button of the prototype (rows and the sheet header), with the actions
// it stood for. The panel is portaled out of .fin, so it carries its own class.

import { Ellipsis } from "lucide-react";
import { Popover } from "@/components/ui/Popover";

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

/** `variant`: « mbtn » in a list row, « ibtn » (a bordered square) in the sheet header. */
export function ActionMenu({ actions, label, variant = "mbtn" }: { actions: MenuAction[]; label: string; variant?: "mbtn" | "ibtn" }) {
  if (actions.length === 0) return null;
  return (
    <Popover
      align="end"
      trigger={
        <button
          type="button"
          className={variant}
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Ellipsis className="ic" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <div className="prd-menu" role="menu" onClick={(e) => e.stopPropagation()}>
          {actions.map((a) => (
            <button
              key={a.key}
              type="button"
              role="menuitem"
              className={a.danger ? "danger" : undefined}
              onClick={() => {
                close();
                a.onSelect();
              }}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}
    </Popover>
  );
}
