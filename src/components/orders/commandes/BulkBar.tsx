"use client";

// The bulk bar (prototype `bulkBar`): white glass, never dark, floating under
// the list while something is selected.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Avatar, FreeAvatar, Ic } from "./ui";

export interface BulkButton {
  key: string;
  icon: string;
  label: string;
  neg?: boolean;
  disabled?: boolean;
  tip?: string;
}

interface Props {
  count: number;
  buttons: BulkButton[];
  /** Agents for « Assigner ▾ » — omitted when the bar has no assign menu. */
  agents?: { id: string; full_name: string }[];
  onAssign?: (agentId: string | null) => void;
  onButton: (key: string) => void;
  onClear: () => void;
}

export function BulkBar({ count, buttons, agents, onAssign, onButton, onClear }: Props) {
  const t = useTranslations("commandes");
  const [menu, setMenu] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const away = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setMenu(false);
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [menu]);
  if (!count) return null;

  let assign: ReactNode = null;
  if (agents && onAssign) {
    assign = (
      <div className="fbw up" ref={ref}>
        <button type="button" className="btn2" aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>
          <Ic n="user" />
          {t("bulk.assign")}
          <Ic n="down" />
        </button>
        {menu && (
          <div className="menu" role="menu">
            <h6>{t("row.assignTo")}</h6>
            {agents.map((a) => (
              <button key={a.id} type="button" role="menuitem" className="mi act" onClick={() => (setMenu(false), onAssign(a.id))}>
                <Avatar id={a.id} name={a.full_name} />
                <span className="ml">{a.full_name}</span>
              </button>
            ))}
            <div className="msep" />
            <button type="button" role="menuitem" className="mi act" onClick={() => (setMenu(false), onAssign(null))}>
              <FreeAvatar />
              <span className="ml">{t("row.toPool")}</span>
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bulk" role="toolbar">
      <b>{t("bulk.selected", { n: count })}</b>
      <span className="vsep" />
      {assign}
      {buttons.map((b) => (
        <button key={b.key} type="button" className={`btn2${b.neg ? " neg" : ""}`} disabled={b.disabled} data-tip={b.tip} onClick={() => onButton(b.key)}>
          <Ic n={b.icon} />
          {b.label}
        </button>
      ))}
      <button type="button" className="lnkb" onClick={onClear}>
        {t("bulk.clear")}
      </button>
    </div>
  );
}
