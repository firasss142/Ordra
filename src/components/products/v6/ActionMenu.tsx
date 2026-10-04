"use client";

// The ⋯ button of the prototype (rows and the sheet header), with the actions
// it stood for. The panel is portaled out of .pv6, so it re-enters the scope.

import { Ellipsis } from "lucide-react";
import { Popover } from "@/components/ui/Popover";

export interface MenuAction {
  key: string;
  label: string;
  onSelect: () => void;
  danger?: boolean;
}

export function ActionMenu({ actions, label }: { actions: MenuAction[]; label: string }) {
  if (actions.length === 0) return null;
  return (
    <Popover
      align="end"
      trigger={
        <button
          type="button"
          className="iconbtn"
          aria-label={label}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <Ellipsis className="ic" aria-hidden />
        </button>
      }
    >
      {(close) => (
        <div className="pv6 pv6-menu" role="menu" onClick={(e) => e.stopPropagation()}>
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
