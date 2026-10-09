"use client";

import { useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { FileText, Info, Loader2, Send, X } from "lucide-react";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import type { TemplateRow } from "@/components/whatsapp/TemplatesTable";
import { errorReasonKey } from "@/lib/whatsapp/compose";
import { resolveLeadVariables } from "@/lib/whatsapp/render";
import { WhatsAppComposer } from "../WhatsAppComposer";

const TEXT_MAX = 1000;

/**
 * The bottom of the thread (prototype `.compose` / `.wclosed`). While the
 * customer's 24 h window is open: a reply box, « Modèle » and « Envoyer » —
 * the free text goes through the same POST /api/whatsapp/send as everywhere.
 * Once it has closed: the bar and « Envoyer un modèle ». A template opens the
 * shared WhatsAppComposer (language, chips, variables, preview) in place; the
 * brakes it knows (not connected, opted out, undeliverable) are shown by it
 * directly.
 */
export function InboxComposer({
  conversationId,
  thread,
  templates,
  marketCode,
  onThreadChanged,
}: {
  conversationId: string;
  thread: ThreadPayload | null;
  templates: TemplateRow[];
  marketCode: "ly" | "tn";
  onThreadChanged: () => void;
}) {
  const t = useTranslations("whatsappAdmin.inbox");
  const tw = useTranslations("whatsapp");
  const tCommon = useTranslations("whatsappAdmin.common");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [tplOpen, setTplOpen] = useState(false);
  const conv = thread?.conversation ?? null;
  const language = thread?.customer_language ?? (marketCode === "ly" ? "ar" : "fr");

  const send = useCallback(async () => {
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    setFailure(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target: { conversation_id: conversationId }, language, mode: "text", text: body }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        const key = errorReasonKey({ error: json?.error ?? null, code: typeof json?.code === "number" ? json.code : null, kind: json?.kind ?? null });
        setFailure(t("sendFailed", { reason: tw(`errors.${key}` as Parameters<typeof tw>[0]) }));
        return;
      }
      setText("");
    } catch {
      setFailure(t("sendFailed", { reason: tw("errors.generic") }));
    } finally {
      setSending(false);
      onThreadChanged();
    }
  }, [text, sending, conversationId, language, onThreadChanged, t, tw]);

  if (!thread) return null;

  const blocked = !thread.config_active || !thread.phone_e164 || Boolean(conv?.opted_out_at) || Boolean(conv?.undeliverable_at);
  const composer = (
    <WhatsAppComposer
      target={{ conversation_id: conversationId }}
      thread={thread}
      templates={templates}
      variables={resolveLeadVariables({ customer_name: conv?.profile_name ?? null })}
      defaultLanguage={marketCode === "ly" ? "ar" : "fr"}
      templateSet="agent"
      onThreadChanged={onThreadChanged}
    />
  );
  if (blocked) return composer;

  if (tplOpen) {
    return (
      <div className="tplpane">
        <button type="button" className="x" aria-label={tCommon("close")} onClick={() => setTplOpen(false)}>
          <X className="ic" strokeWidth={1.9} aria-hidden />
        </button>
        {composer}
      </div>
    );
  }

  if (!thread.window_open) {
    return (
      <div className="wclosed">
        <Info className="ic" strokeWidth={1.9} aria-hidden />
        {t("closedBar")}
        <button type="button" className="btn pri" onClick={() => setTplOpen(true)}>
          <FileText className="ic" strokeWidth={1.9} aria-hidden />
          {t("sendTpl")}
        </button>
      </div>
    );
  }

  return (
    <>
      {failure && (
        <p role="alert" className="cerr">
          {failure}
        </p>
      )}
      <div className="compose">
        <textarea
          className="box"
          rows={1}
          dir="auto"
          value={text}
          maxLength={TEXT_MAX}
          placeholder={t("place")}
          aria-label={t("place")}
          onChange={(e) => {
            setText(e.target.value);
            setFailure(null);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <button type="button" className="btn sec" onClick={() => setTplOpen(true)}>
          <FileText className="ic" strokeWidth={1.9} aria-hidden />
          {t("tpl")}
        </button>
        <button type="button" className="btn pri" onClick={() => void send()} disabled={sending || !text.trim()}>
          {sending ? <Loader2 className="ic animate-spin" strokeWidth={1.9} aria-hidden /> : <Send className="ic flip" strokeWidth={1.9} aria-hidden />}
          {sending ? t("sending") : t("send")}
        </button>
      </div>
    </>
  );
}
