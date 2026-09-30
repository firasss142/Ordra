"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { AlertTriangle, Ban, CheckCheck, Clock, Info, Loader2, Pencil, Phone, Send } from "lucide-react";
import type { TemplateRow } from "@/components/whatsapp/TemplatesTable";
import type { ThreadPayload } from "@/lib/whatsapp/thread";
import type { MessageRow, SendTarget } from "@/lib/whatsapp/send";
import type { CustomerLang, TemplateVariable, VariableValues } from "@/lib/whatsapp/types";
import { localizeVariables, previewParts } from "@/lib/whatsapp/render";
import { errorReasonKey, templateChips, windowUntil, type TemplateSet } from "@/lib/whatsapp/compose";
import { StatusGlyph } from "./StatusGlyph";
import { WhatsAppGlyph } from "./WhatsAppGlyph";

/**
 * The composer. Prototype: whatsapp-agent-v1.html — `composer()` for the
 * order panel (variant "panel") and `waSheet()` for the /delivery and
 * prospects sheets (variant "sheet"). The customer's language, the 24 h
 * window chip, the template chips (plus « Texte libre » only while the
 * window is open), the rendered preview with its variables highlighted, and
 * the send button. Variables come from the order/lead; the agent types
 * nothing unless the window is open.
 *
 * Every refusal the server can give is shown here in the agent's words, and
 * the brakes (not connected, opt-out, undeliverable) replace the composer
 * entirely — with the wa.me link as the way out when the market is not
 * connected.
 */
export interface WhatsAppComposerProps {
  target: SendTarget;
  /** null while the thread loads. */
  thread: ThreadPayload | null;
  templates: TemplateRow[];
  variables: VariableValues;
  defaultLanguage: CustomerLang;
  templateSet: TemplateSet;
  campaignId?: string | null;
  /** What the agent calls the campaign (its name), shown on its chip instead of Meta's template id. */
  campaignLabel?: string | null;
  defaultCatalogueKey?: string | null;
  logDeliveryAction?: boolean;
  /** "panel": compact, under the thread. "sheet": the full sheet body of /delivery and prospects. */
  variant?: "panel" | "sheet";
  /** Open on the text area when the window is open (the inbox: replying is the usual move). */
  preferFreeText?: boolean;
  placeholder?: string;
  /** today's wa.me link, offered when the market is not connected. */
  fallbackHref?: string | null;
  /** The thread request failed. */
  loadError?: boolean;
  onSent?: (message: MessageRow) => void;
  onThreadChanged?: () => void;
  onCall?: () => void;
  /** Sheet variant: « Fermer » after a send. */
  onClose?: () => void;
  now?: Date;
  className?: string;
}

interface SendFailure {
  error: string | null;
  code: number | null;
  kind: string | null;
  message: string | null;
}

const TEXT_MAX = 1000;

export function WhatsAppComposer({
  target,
  thread,
  templates,
  variables,
  defaultLanguage,
  templateSet,
  campaignId = null,
  campaignLabel = null,
  defaultCatalogueKey = null,
  logDeliveryAction = false,
  variant = "panel",
  preferFreeText = false,
  placeholder,
  fallbackHref = null,
  loadError = false,
  onSent,
  onThreadChanged,
  onCall,
  onClose,
  now,
  className = "",
}: WhatsAppComposerProps) {
  const t = useTranslations("whatsapp");
  const locale = useLocale();
  const sheet = variant === "sheet";

  const [lang, setLang] = useState<CustomerLang>(thread?.customer_language ?? defaultLanguage);
  const [adopted, setAdopted] = useState<string | null>(thread?.customer_language ?? null);
  // The customer's remembered language wins once it is known.
  useEffect(() => {
    const remembered = thread?.customer_language ?? null;
    if (remembered && remembered !== adopted) {
      setLang(remembered);
      setAdopted(remembered);
    }
  }, [thread?.customer_language, adopted]);

  const windowOpen = Boolean(thread?.window_open);
  const chips = useMemo(() => templateChips(templates, lang, templateSet, campaignId), [templates, lang, templateSet, campaignId]);
  const [templateId, setTemplateId] = useState<string | null>(null);
  useEffect(() => {
    if (chips.length === 0) {
      setTemplateId(null);
      return;
    }
    if (templateId && chips.some((c) => c.id === templateId)) return;
    const preferred = defaultCatalogueKey ? chips.find((c) => c.catalogue_key === defaultCatalogueKey) : null;
    setTemplateId((preferred ?? chips[0]).id);
  }, [chips, templateId, defaultCatalogueKey]);

  const [free, setFree] = useState(preferFreeText && windowOpen);
  // The agent's own pick of a chip beats preferFreeText.
  const touched = useRef(false);
  useEffect(() => {
    if (!windowOpen) setFree(false);
    else if (preferFreeText && !touched.current) setFree(true);
  }, [windowOpen, preferFreeText]);
  const [text, setText] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [sent, setSent] = useState<MessageRow | null>(null);
  const [failure, setFailure] = useState<SendFailure | null>(null);

  /** Any change after a send starts a new message. */
  const fresh = useCallback(() => {
    setState((s) => (s === "sent" ? "idle" : s));
    setFailure(null);
  }, []);

  const template = chips.find((c) => c.id === templateId) ?? null;
  const parts = useMemo(
    () => (template ? previewParts(template.body_text, (template.variables ?? []) as TemplateVariable[], localizeVariables(variables, template.language)) : []),
    [template, variables],
  );
  const footer = template?.footer_text ?? null;
  const previewLength = parts.reduce((n, p) => n + p.text.length, 0) + (footer ? footer.length + 2 : 0);

  const send = useCallback(async () => {
    if (state === "sending") return;
    const mode = free ? "text" : "template";
    if (mode === "text" && !text.trim()) return;
    if (mode === "template" && !template) return;
    setState("sending");
    setFailure(null);
    try {
      const res = await fetch("/api/whatsapp/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          target,
          language: lang,
          mode,
          template_id: mode === "template" ? template!.id : undefined,
          text: mode === "text" ? text.trim() : undefined,
          log_delivery_action: logDeliveryAction,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setFailure({ error: body?.error ?? null, code: typeof body?.code === "number" ? body.code : null, kind: body?.kind ?? null, message: body?.message ?? null });
        setState("idle");
        onThreadChanged?.();
        return;
      }
      setState("sent");
      setSent((body.data as MessageRow) ?? null);
      setText("");
      onSent?.(body.data as MessageRow);
      onThreadChanged?.();
    } catch {
      setFailure({ error: "generic", code: null, kind: null, message: null });
      setState("idle");
    }
  }, [state, free, text, template, target, lang, logDeliveryAction, onSent, onThreadChanged]);

  const dateFmt = useMemo(() => new Intl.DateTimeFormat(locale === "ar" ? "ar-LY" : "fr-FR", { day: "numeric", month: "short" }), [locale]);
  // The sent message as the thread knows it now (sent → delivered → read), else as the send returned it.
  const liveStatus = sent ? (thread?.messages.find((m) => m.id === sent.id)?.status ?? sent.status ?? "sent") : "sent";

  const shell = sheet ? `bg-white ${className}` : `border-t border-[#E5E7EB] bg-white px-3.5 pb-2.5 pt-2 ${className}`;

  // ── Loading / failed to load ──
  if (!thread) {
    if (loadError) {
      return <Banner sheet={sheet} tone="warn" icon={<AlertTriangle size={17} aria-hidden="true" />} title={t("composer.loadError")} className={className} />;
    }
    return (
      <div className={`${sheet ? "" : "border-t border-[#E5E7EB] bg-white px-3.5 py-3"} text-[12.5px] text-[#6B7280] ${className}`} aria-busy="true">
        <Loader2 size={14} className="inline animate-spin" aria-hidden="true" />
      </div>
    );
  }

  // ── Hard stops ──
  if (!thread.config_active) {
    return (
      <Banner
        sheet={sheet}
        tone="grey"
        icon={<Info size={17} aria-hidden="true" />}
        title={t("composer.noConfig")}
        sub={t("composer.noConfigSub")}
        link={fallbackHref ? { href: fallbackHref, label: t("sheet.open") } : undefined}
        className={className}
      />
    );
  }
  if (!thread.phone_e164) {
    return <Banner sheet={sheet} tone="warn" icon={<AlertTriangle size={17} aria-hidden="true" />} title={t("composer.noPhone")} className={className} />;
  }
  if (thread.conversation?.opted_out_at) {
    return (
      <Banner
        sheet={sheet}
        tone="warn"
        icon={<Ban size={17} aria-hidden="true" />}
        title={t("composer.optedOut")}
        sub={t("composer.optedOutSub", { text: thread.conversation.opt_out_text ?? "STOP", date: dateFmt.format(new Date(thread.conversation.opted_out_at)) })}
        action={onCall ? { label: t("composer.callInstead"), onClick: onCall, icon: <Phone size={13} aria-hidden="true" /> } : undefined}
        className={className}
      />
    );
  }
  if (thread.conversation?.undeliverable_at) {
    return (
      <Banner
        sheet={sheet}
        tone="warn"
        icon={<AlertTriangle size={17} aria-hidden="true" />}
        title={t("composer.undeliverable")}
        sub={t("composer.undeliverableSub")}
        action={onCall ? { label: t("composer.callInstead"), onClick: onCall, icon: <Phone size={13} aria-hidden="true" /> } : undefined}
        className={className}
      />
    );
  }

  const canSend = state !== "sending" && state !== "sent" && (free ? text.trim().length > 0 && text.length <= TEXT_MAX : Boolean(template));
  const until = windowUntil(thread.window_closes_at, now ?? new Date(), locale);
  const windowLabel = windowOpen
    ? until?.tomorrow
      ? t("composer.windowOpenTomorrow", { time: until.time })
      : t("composer.windowOpen", { time: until?.time ?? "" })
    : thread.conversation?.last_inbound_at
      ? t("composer.windowClosed")
      : t("composer.windowNever");

  const langToggle = (
    <div role="group" aria-label={t("composer.langGroup")} className={`inline-flex rounded-full bg-[#F3F4F6] p-[3px] ${sheet ? "mx-auto" : ""}`}>
      {(["ar", "fr"] as CustomerLang[]).map((l) => (
        <button
          key={l}
          type="button"
          aria-pressed={lang === l}
          onClick={() => {
            setLang(l);
            fresh();
          }}
          className={`rounded-full ${sheet ? "h-[34px] px-[26px] text-[14px]" : "h-[30px] px-4 text-[13px]"} ${lang === l ? "bg-white font-semibold text-[#111827] shadow-[0_0_0_1px_#D1D5DB]" : "text-[#6B7280]"}`}
        >
          {t(`composer.lang.${l}`)}
        </button>
      ))}
    </div>
  );

  const windowChip = (
    <span
      data-open={windowOpen}
      title={windowLabel}
      className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 text-[12px] font-semibold ${
        windowOpen ? "border-[#BBF7D0] bg-[#F0FDF4] text-[#14532D]" : "border-[#E5E7EB] bg-[#F3F4F6] text-[#6B7280]"
      } ${sheet ? "mt-2.5 self-start" : "ms-auto"}`}
    >
      <Clock size={13} strokeWidth={2.2} aria-hidden="true" />
      {windowLabel}
    </span>
  );

  const chipClass = (on: boolean, dashed = false) =>
    `${sheet ? "h-10 px-4 text-[14px]" : "h-[34px] px-3 text-[13px]"} inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border ${dashed ? "border-dashed" : ""} ${
      on ? "border-[1.5px] border-[#1E8E5A] bg-[#E8F6EE] font-semibold text-[#14532D]" : "border-[#D1D5DB] bg-white text-[#374151]"
    }`;

  const chipRow = (
    <div role="tablist" aria-label={t("composer.templatesGroup")} className={`flex gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:none] ${sheet ? "" : "mt-2"}`}>
      {chips.map((c) => {
        const label = c.source === "campaign" ? (campaignLabel ?? c.name) : c.catalogue_key ? t(`templates.${c.catalogue_key}` as Parameters<typeof t>[0]) : c.name;
        const on = !free && c.id === templateId;
        return (
          <button
            key={c.id}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => {
              touched.current = true;
              setTemplateId(c.id);
              setFree(false);
              fresh();
            }}
            className={chipClass(on)}
          >
            {label}
          </button>
        );
      })}
      {windowOpen && (
        <button
          type="button"
          role="tab"
          aria-selected={free}
          data-free
          onClick={() => {
            touched.current = true;
            setFree(true);
            fresh();
          }}
          className={chipClass(free, true)}
        >
          <Pencil size={13} aria-hidden="true" />
          {t("composer.free")}
        </button>
      )}
    </div>
  );

  const noTemplates = chips.length === 0 && !free && (
    <p role="status" className="mt-2 rounded-[10px] border border-[#FCD34D] bg-[#FFFBEB] px-3 py-2 text-[12.5px] text-[#B45309]">
      {t("composer.noTemplates")}
    </p>
  );

  const bodyBlock = free ? (
    <textarea
      dir="auto"
      value={text}
      onChange={(e) => {
        setText(e.target.value);
        fresh();
      }}
      placeholder={placeholder ?? t("composer.placeholder")}
      maxLength={TEXT_MAX}
      aria-label={t("composer.free")}
      className={`w-full resize-y rounded-[12px] border border-[#D1D5DB] bg-white text-[#111827] [unicode-bidi:plaintext] focus:border-transparent focus:outline focus:outline-2 focus:outline-[#15803D] ${
        sheet ? "min-h-[96px] px-4 py-3 text-[15.5px] leading-[1.6]" : "mt-2 min-h-[64px] px-3 py-2.5 text-[14.5px] leading-[1.55]"
      }`}
    />
  ) : template ? (
    <div
      dir={lang === "ar" ? "rtl" : "ltr"}
      lang={lang}
      data-testid="whatsapp-preview"
      className={`overflow-y-auto whitespace-pre-wrap rounded-[12px] border border-[#E5E7EB] bg-white text-[#111827] ${
        sheet ? "min-h-[150px] px-4 py-3 text-[15.5px] leading-[1.75]" : "mt-2 max-h-[112px] min-h-[52px] px-3 py-2 text-[14px] leading-[1.6]"
      }`}
    >
      {parts.map((p, i) =>
        p.variable ? (
          <mark key={i} className="rounded-[5px] bg-[#E8F6EE] px-1 font-semibold text-[#14532D]">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
      {footer && <span className="text-[#6B7280]">{`\n\n${footer}`}</span>}
    </div>
  ) : null;

  const failureBox = failure && (
    <div role="alert" className={`flex flex-wrap items-center gap-2 rounded-[10px] border border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-[13px] text-[#B91C1C] ${sheet ? "mb-3" : "mt-2"}`}>
      <AlertTriangle size={15} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <b className="font-bold">{t("composer.failed")}</b>
        {" · "}
        {failure.code
          ? t("composer.failedMeta", { code: failure.code, reason: t(`errors.${errorReasonKey(failure)}` as Parameters<typeof t>[0]) })
          : t(`errors.${errorReasonKey(failure)}` as Parameters<typeof t>[0])}
      </span>
      <button type="button" onClick={send} className="ms-auto font-bold underline">
        {t("composer.retry")}
      </button>
    </div>
  );

  const buttonInner =
    state === "sending" ? (
      <>
        <Loader2 size={sheet ? 20 : 16} className="animate-spin" aria-hidden="true" />
        {t("composer.sending")}
      </>
    ) : state === "sent" ? (
      <>
        <CheckCheck size={sheet ? 20 : 16} strokeWidth={2.4} aria-hidden="true" />
        {t("composer.sent")}
      </>
    ) : (
      <>
        {sheet ? <WhatsAppGlyph size={22} /> : <Send size={16} aria-hidden="true" />}
        {sheet ? t("sheet.send") : t("composer.send")}
      </>
    );

  if (sheet) {
    return (
      <div className={`flex flex-col ${shell}`} data-testid="whatsapp-composer" data-variant="sheet">
        {langToggle}
        <span className="mb-2 mt-3 block text-[12.5px] font-semibold uppercase tracking-[.04em] text-[#6B7280]">{t("sheet.chooseTemplate")}</span>
        {chipRow}
        {windowChip}
        {noTemplates}
        <span className="mb-2 mt-3 block text-[12.5px] font-semibold uppercase tracking-[.04em] text-[#6B7280]">{t("sheet.messageText")}</span>
        {bodyBlock}
        <div className="mx-0.5 mb-3.5 mt-1.5 text-[12.5px] tabular-nums text-[#9CA3AF]">{t("composer.chars", { count: free ? text.length : previewLength })}</div>
        {failureBox}
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          data-state={state}
          className={`flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] text-[17px] font-semibold disabled:opacity-45 ${
            state === "sent" ? "border-[1.5px] border-[#BBF7D0] bg-[#F0FDF4] text-[#14532D] disabled:opacity-100" : "bg-[#1E8E5A] text-white hover:bg-[#177A4C]"
          }`}
        >
          {buttonInner}
        </button>
        {state === "sent" && (
          <div role="status" className="mt-2.5 flex items-center gap-2.5 rounded-[10px] border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-2.5 text-[13.5px] text-[#374151]">
            <StatusGlyph status={liveStatus} />
            <span className="min-w-0 flex-1">{logDeliveryAction ? t("sheet.sentAfter") : t("sheet.sentLive")}</span>
            {onClose && (
              <button type="button" onClick={onClose} className="font-bold text-[#111827]">
                {t("sheet.close")}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className={shell} data-testid="whatsapp-composer">
      {/* r1: language + window */}
      <div className="flex flex-wrap items-center gap-2">
        {langToggle}
        {windowChip}
      </div>
      {chipRow}
      {noTemplates}
      {bodyBlock}
      {failureBox}
      {/* r2 */}
      <div className="mt-2 flex items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-[12px] tabular-nums text-[#6B7280]">
          {free ? t("composer.chars", { count: text.length }) : t("composer.varsHint")}
        </span>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          data-state={state}
          className={`inline-flex h-[42px] min-w-[132px] items-center justify-center gap-2 whitespace-nowrap rounded-[10px] px-4 text-[14.5px] font-bold disabled:opacity-45 ${
            state === "sent" ? "border border-[#BBF7D0] bg-[#F0FDF4] text-[#14532D] disabled:opacity-100" : "bg-[#1E8E5A] text-white hover:bg-[#177A4C]"
          }`}
        >
          {buttonInner}
        </button>
      </div>
    </div>
  );
}

function Banner({
  sheet,
  tone,
  icon,
  title,
  sub,
  action,
  link,
  className = "",
}: {
  sheet: boolean;
  tone: "grey" | "warn";
  icon: React.ReactNode;
  title: string;
  sub?: string;
  action?: { label: string; onClick: () => void; icon?: React.ReactNode };
  link?: { href: string; label: string };
  className?: string;
}) {
  const box = (
    <div
      role="status"
      className={`flex items-start gap-2.5 rounded-[12px] border px-[13px] py-[11px] text-[13.5px] leading-[1.45] ${
        tone === "warn" ? "border-[#FCD34D] bg-[#FFFBEB] text-[#B45309]" : "border-[#E5E7EB] bg-[#F3F4F6] text-[#374151]"
      }`}
    >
      <span className="mt-px shrink-0">{icon}</span>
      <div className="min-w-0">
        <b className="mb-px block font-bold">{title}</b>
        {sub && <span className="block">{sub}</span>}
        {action && (
          <button type="button" onClick={action.onClick} className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-current bg-white px-3 text-[13px] font-bold">
            {action.icon}
            {action.label}
          </button>
        )}
        {link && !sheet && (
          <a href={link.href} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex h-8 items-center gap-1.5 rounded-[8px] border border-[#D1D5DB] bg-white px-3 text-[13px] font-bold text-[#111827]">
            <WhatsAppGlyph size={15} />
            {link.label}
          </a>
        )}
      </div>
    </div>
  );
  if (sheet) {
    return (
      <div className={className} data-testid="whatsapp-composer-banner" data-tone={tone}>
        <div className="mb-3 mt-3.5">{box}</div>
        {link && (
          <a
            href={link.href}
            target="_blank"
            rel="noopener noreferrer"
            className="flex h-[52px] w-full items-center justify-center gap-2.5 rounded-[10px] border border-[#D1D5DB] bg-white text-[17px] font-semibold text-[#111827] hover:bg-[#F9FAFB]"
          >
            <WhatsAppGlyph size={22} />
            {link.label}
          </a>
        )}
      </div>
    );
  }
  return (
    <div className={`border-t border-[#E5E7EB] bg-white px-3.5 py-3 ${className}`} data-testid="whatsapp-composer-banner" data-tone={tone}>
      {box}
    </div>
  );
}
