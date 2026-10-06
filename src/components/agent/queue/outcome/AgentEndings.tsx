"use client";

/**
 * The bottom of the agent's order (prototype `agentPanel`): the result line of the last
 * ending (S.done), the notes, then either the open step (`.tray`, desktop) or the footer
 * with the four endings and the `.keys` hint. On a phone the steps open in the sheet.
 *
 * Keys, while the order is open and nothing covers it, and the focus is not in a field:
 * 1–4 the four endings (1 only below the ceiling), Escape closes the step, then the order.
 */

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Ic } from "@/components/agent/shared";
import { isEditableTarget } from "@/lib/dom";
import { CALLING_STATUSES } from "@/lib/orders/row-signals";
import { OutcomeTray } from "./OutcomeTray";
import { DarbStep, OutcomeSheet, XDeliveryStep, type SheetEcho } from "./OutcomeSheet";
import type { AgentNote, Twin } from "./outcome-model";
import type { OutcomeFlow } from "./useOutcomeFlow";

export interface ExtraLine {
  key: string;
  hue: string;
  icon: string;
  text: string;
  alert?: boolean;
}

export interface AgentEndingsProps {
  flow: OutcomeFlow;
  status: string;
  phone: boolean;
  /** Something sits on top of the order (product sheet, capture, a dialog): keys stand down. */
  covered: boolean;
  notes: AgentNote[];
  twin: Twin | null;
  callbackAt: string | null;
  dispatchAt: string | null;
  /** The panel's own feedback (upload result, failed save…). */
  extra: ExtraLine[];
  canReopen: boolean;
  canDeleteBarcode: boolean;
  canReturnToPool: boolean;
  pending: boolean;
  echo: SheetEcho;
  when: (iso: string | null | undefined) => string;
  onClose: () => void;
  onReopen: () => void;
  onDeleteBarcode: () => void;
  onCancelSchedule: () => Promise<boolean>;
  onReturnToPool: () => void;
}

const KEY_ACTS = ["noAnswer", "confirm", "reject", "callback"] as const;

export function AgentEndings(p: AgentEndingsProps) {
  const t = useTranslations("agentOutcome");
  const { flow } = p;
  const [menu, setMenu] = useState(false);
  // « Modifier le statut » on a confirmed order brings the four endings back.
  const [changing, setChanging] = useState(false);
  const calling = CALLING_STATUSES.has(p.status) || changing;
  const atMax = flow.atMax;
  const busy = flow.busy !== null || p.pending;

  useEffect(() => {
    if (p.covered) return;
    const h = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        if (flow.send.darbOpen || flow.send.xdOpen) return;
        if (menu) setMenu(false);
        else if (flow.tray) flow.dismiss();
        else p.onClose();
        return;
      }
      if (isEditableTarget(e.target) || flow.tray || p.phone || !calling) return;
      const i = ["1", "2", "3", "4"].indexOf(e.key);
      if (i < 0) return;
      const kind = KEY_ACTS[i];
      if (kind === "noAnswer" && atMax) return;
      e.preventDefault();
      void flow.act(kind);
    };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [p, flow, calling, atMax, menu]);

  const more = (items: Array<{ icon: string; label: string; neg?: boolean; run: () => void }>) =>
    items.length ? (
      <div className="fbw up">
        <button type="button" className="fa io" aria-label={t("foot.more")} aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
          <Ic n="more" />
        </button>
        {menu ? (
          <div className="menu end" role="menu">
            {items.map((it) => (
              <button
                key={it.label}
                type="button"
                role="menuitem"
                className={`mi act${it.neg ? " neg" : ""}`}
                onClick={() => {
                  setMenu(false);
                  it.run();
                }}
              >
                <Ic n={it.icon} />
                <span className="ml">{it.label}</span>
              </button>
            ))}
          </div>
        ) : null}
      </div>
    ) : null;

  const pool = p.canReturnToPool ? [{ icon: "back", label: t("foot.returnToPool"), run: p.onReturnToPool }] : [];

  let foot: React.ReactNode;
  if (calling) {
    foot = (
      <>
        {!atMax ? (
          <button type="button" className="fa" disabled={busy} onClick={() => void flow.act("noAnswer")}>
            <kbd>1</kbd>
            <span>{flow.busy === "noAnswer" ? t("sheet.saving") : t("foot.noAnswer")}</span>
          </button>
        ) : null}
        <button type="button" className="fa pri" disabled={busy} onClick={() => void flow.act("confirm")}>
          <kbd>2</kbd>
          <span>{flow.busy === "confirm" ? t("sheet.saving") : t("foot.confirm")}</span>
        </button>
        <button type="button" className="fa neg" disabled={busy} onClick={() => void flow.act("reject")}>
          <kbd>3</kbd>
          <span>{t("foot.reject")}</span>
        </button>
        <button type="button" className="fa" disabled={busy} onClick={() => void flow.act("callback")}>
          <kbd>4</kbd>
          <span>{t("foot.callback")}</span>
        </button>
        {more([...(p.status === "callback_scheduled" ? [{ icon: "clock", label: t("foot.reschedule"), run: () => flow.openTray("callback") }] : []), ...pool])}
      </>
    );
  } else if (p.status === "confirmed") {
    foot = (
      <>
        <button type="button" className="fa pri wide" disabled={busy} onClick={() => flow.openTray("send")}>
          <Ic n="truck" />
          <span>{t("foot.send")}</span>
        </button>
        <button type="button" className="fa" disabled={busy} onClick={() => flow.openTray("schedule")}>
          <Ic n="cal" />
          <span>{t("foot.schedule")}</span>
        </button>
        {more([{ icon: "sliders", label: t("foot.changeStatus"), run: () => setChanging(true) }, ...pool])}
      </>
    );
  } else if (p.status === "dispatch_scheduled") {
    foot = (
      <>
        <button type="button" className="fa pri wide" disabled={busy} onClick={() => flow.openTray("send")}>
          <Ic n="truck" />
          <span>{t("foot.sendNow")}</span>
        </button>
        <button type="button" className="fa" disabled={busy} onClick={() => void unschedule()}>
          <span>{t("foot.unschedule")}</span>
        </button>
        {more(pool)}
      </>
    );
  } else {
    foot = (
      <>
        {p.canReopen ? (
          <button type="button" className="fa wide" disabled={busy} onClick={p.onReopen}>
            <Ic n="rotate" />
            <span>{t("foot.reopen")}</span>
          </button>
        ) : (
          <button type="button" className="fa wide" onClick={p.onClose}>
            {t("foot.close")}
          </button>
        )}
        {more(p.canDeleteBarcode ? [{ icon: "trash", label: t("foot.deleteBarcode"), neg: true, run: p.onDeleteBarcode }] : [])}
      </>
    );
  }

  async function unschedule() {
    if (await p.onCancelSchedule()) flow.setDone({ hue: "violet", icon: "check", text: t("done.unscheduled") });
  }

  const noteText = (n: AgentNote): React.ReactNode => {
    switch (n.kind) {
      case "outOfStock":
        return t("notes.outOfStock");
      case "dup":
        return p.twin ? t(p.twin.shipped ? "notes.dupShipped" : "notes.dup", { ref: p.twin.ref, when: p.when(p.twin.createdAt) }) : "";
      case "maxAttempts":
        return t("notes.maxAttempts");
      case "callbackLate":
        return t("notes.callbackLate", { time: p.callbackAt ? flow.cbWhen(p.callbackAt) : "" });
      case "callback":
        return t("notes.callback", { when: flow.cbWhen(p.callbackAt) });
      case "dispatch":
        return t("notes.dispatch", { when: flow.cbWhen(p.dispatchAt) });
      case "noCity":
        return t("notes.noCity");
      case "locked":
        return t("notes.locked");
    }
  };

  const desktopTray = flow.tray && !p.phone;
  const showNotes = (p.notes.length > 0 || p.extra.length > 0 || (!flow.tray && flow.error)) && !desktopTray;

  return (
    <>
      {flow.done ? (
        <div className="notes" data-testid="outcome-done">
          <div className={`note h-${flow.done.hue}`} role="status">
            <Ic n={flow.done.icon} />
            <span>{flow.done.text}</span>
          </div>
        </div>
      ) : null}
      {showNotes ? (
        <div className="notes">
          {p.notes.map((n) => (
            <div key={n.kind} className={`note h-${n.hue}`} data-note={n.kind}>
              <Ic n={n.icon} />
              <span>{noteText(n)}</span>
              {n.kind === "dup" ? (
                <button type="button" className="lnk neg" onClick={flow.deleteDup}>
                  {t("notes.dupDelete")}
                </button>
              ) : n.kind === "dispatch" ? (
                <button type="button" className="lnk" onClick={() => void unschedule()}>
                  {t("notes.dispatchCancel")}
                </button>
              ) : null}
            </div>
          ))}
          {p.extra.map((n) => (
            <div key={n.key} className={`note h-${n.hue}`} role={n.alert ? "alert" : "status"}>
              <Ic n={n.icon} />
              <span>{n.text}</span>
            </div>
          ))}
          {!flow.tray && flow.error ? (
            <div className="note h-red" role="alert">
              <Ic n="alert" />
              <span>{flow.error}</span>
            </div>
          ) : null}
        </div>
      ) : null}
      {desktopTray ? (
        <>
          <OutcomeTray flow={flow} />
          <DarbStep flow={flow} />
          <XDeliveryStep flow={flow} />
        </>
      ) : (
        <>
          <div className="dr-foot" data-testid="panel-actions">
            {foot}
          </div>
        </>
      )}
      {p.phone && flow.tray ? <OutcomeSheet flow={flow} echo={p.echo} onClose={flow.dismiss} /> : null}
    </>
  );
}
