"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import useSWR from "swr";
import { useTranslations } from "next-intl";
import { AlertTriangle, Clock, Image as ImageIcon, Info, Loader2, Pencil, Plus, Trash2, X } from "lucide-react";
import { Badge, type BadgeTone } from "@/components/ui/Badge";
import { useToast } from "@/components/ui/Toast";
import { useWhatsAppAvailability } from "@/hooks/useWhatsAppAvailability";
import { LIFECYCLE_EVENT_KEYS } from "@/lib/whatsapp/types";

/**
 * Modèles WhatsApp — what Meta approved, and which event each one serves.
 * Look: prototypes/voix-du-client-et-messages-v2.html (`templates()`), styled by
 * the Messages page's messages.css (`.wam`); the drawer keeps the earlier
 * whatsapp-manager-v1 design.
 *
 * The event select is the one write here besides Meta's own actions; the
 * rest is reading Meta's state (status, rejection reason, the components
 * that were submitted) so a refusal can be understood without opening Meta's
 * console. A market_manager reads everything and maps nothing (`readOnly`);
 * sync and « Créer les modèles Ordra » stay for both roles, as the prototype
 * shows them. A market that is not connected still gets the page: the table,
 * empty, and the reason.
 */

export interface TemplateRow {
  id: string;
  market_id: string;
  meta_template_id?: string | null;
  name: string;
  language: string;
  category: string;
  status: string;
  rejected_reason: string | null;
  components: unknown[];
  body_text: string;
  header_format: string | null;
  footer_text: string | null;
  variables: string[];
  event_key: string | null;
  catalogue_key: string | null;
  source: string;
  campaign_id: string | null;
  /** Joined by GET /api/whatsapp/templates for campaign templates. */
  campaign_name?: string | null;
  synced_at: string | null;
}

interface Market {
  id: string;
  name: string;
  code: string;
}


const fetcher = async (url: string) => {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`${res.status}`);
  return res.json();
};

const templatesKey = (marketId: string) => `/api/whatsapp/templates?market_id=${marketId}`;

const STATUS_TONE: Record<string, BadgeTone> = {
  APPROVED: "success",
  PENDING: "warning",
  REJECTED: "critical",
  PAUSED: "warning",
  DISABLED: "neutral",
  DELETED: "neutral",
  DRAFT: "neutral",
  UNKNOWN: "neutral",
};
const KNOWN_LANG = new Set(["fr", "ar", "en"]);
const KNOWN_VARS = new Set(["name", "carrier", "tracking", "amount", "order_ref", "courier", "address", "product", "discount", "city", "agent"]);

const btnPrimaryCls =
  "inline-flex items-center gap-1.5 rounded-[6px] border border-brand bg-brand px-3 py-2 text-[13.5px] font-medium text-white hover:bg-brand-hover transition-colors duration-fast disabled:opacity-50";
const btnDangerCls =
  "inline-flex items-center gap-1.5 rounded-[6px] border border-[#F2B8AE] bg-surface-card px-3 py-2 text-[13.5px] font-medium text-status-critical hover:bg-status-criticalBg transition-colors duration-fast disabled:opacity-50";

function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] ?? "neutral";
}

function useLabels() {
  const t = useTranslations("whatsappAdmin.templates");
  const tCommon = useTranslations("whatsappAdmin.common");
  return useMemo(
    () => ({
      t,
      tCommon,
      lang: (l: string) => (KNOWN_LANG.has(l) ? tCommon(`language.${l}`) : l),
      status: (s: string) => t(`status.${STATUS_TONE[s] ? s : "UNKNOWN"}`),
      variable: (v: string) => (KNOWN_VARS.has(v) ? t(`vars.${v}`) : v),
    }),
    [t, tCommon],
  );
}

/** Body with `{{n}}` replaced by the n-th variable's label, highlighted like the prototype. */
function PreviewBody({ body, variables, label }: { body: string; variables: string[]; label: (v: string) => string }) {
  const parts = body.split(/(\{\{\d+\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{\{(\d+)\}\}$/.exec(p);
        if (!m) return <Fragment key={i}>{p}</Fragment>;
        const name = variables[Number(m[1]) - 1];
        return (
          <mark key={i} className="rounded-[4px] bg-[#B5E7B0] px-[3px] text-inherit">
            {name ? label(name) : "?"}
          </mark>
        );
      })}
    </>
  );
}

/** The phone mock of the prototype's drawer: wallpaper, sender, image header, green bubble, footer, ticks. */
function PhonePreview({ row, sender, label }: { row: TemplateRow; sender: string; label: (v: string) => string }) {
  const dir = row.language === "ar" ? "rtl" : "ltr";
  const image = row.header_format === "IMAGE";
  return (
    <div className="flex min-h-[180px] flex-col gap-1.5 rounded-[12px] bg-[#E5DDD5] px-3 pb-3 pt-3.5">
      <div className="flex items-center gap-2 text-[12.5px] text-[#374151]">
        <span aria-hidden className="grid h-[22px] w-[22px] place-items-center rounded-full bg-white text-[10px] font-bold">
          O
        </span>
        <b className="font-semibold">{sender}</b>
        <span className="ms-auto text-[11px] text-[#6B7280]" dir="ltr">
          10:42
        </span>
      </div>
      {image && (
        <div
          data-testid="wa-preview-image"
          className="grid aspect-[4/3] w-[70%] place-items-center rounded-t-[10px] border border-b-0 border-[#CBEBC3] bg-white text-[#E8946A]"
        >
          <ImageIcon size={28} strokeWidth={1.6} aria-hidden />
        </div>
      )}
      <div
        dir={dir}
        className={`relative w-[70%] whitespace-pre-wrap border border-[#CBEBC3] bg-[#DCF8C6] px-2.5 pb-[18px] pt-2 text-[13.5px] leading-[1.5] text-[#111827] [unicode-bidi:plaintext] ${
          image ? "rounded-b-[10px]" : "rounded-e-[10px] rounded-es-[10px]"
        }`}
      >
        <PreviewBody body={row.body_text} variables={row.variables} label={label} />
        {row.footer_text && <span className="mt-1.5 block text-[12px] text-[#6B7280]">{row.footer_text}</span>}
        <span className="absolute bottom-1 end-2 text-[10.5px] text-[#5B7A57]" dir="ltr">
          10:42 ✓✓
        </span>
      </div>
    </div>
  );
}

/** JSON with keys, strings and numbers coloured, as in the prototype's `pre.json`. */
function JsonView({ value }: { value: unknown }) {
  const text = JSON.stringify(value, null, 2);
  const tokens: ReactNode[] = [];
  const re = /("(?:[^"\\]|\\.)*")(\s*:)?|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) tokens.push(text.slice(last, m.index));
    if (m[1] && m[2]) {
      tokens.push(<span key={i++} className="text-[#93C5FD]">{m[1]}</span>, m[2]);
    } else if (m[1]) {
      tokens.push(<span key={i++} className="text-[#A7F3D0]">{m[1]}</span>);
    } else {
      tokens.push(<span key={i++} className="text-[#FCD34D]">{m[0]}</span>);
    }
    last = re.lastIndex;
  }
  if (last < text.length) tokens.push(text.slice(last));
  return (
    <pre dir="ltr" className="m-0 max-h-[320px] overflow-auto rounded-[8px] bg-[#0E1013] p-3 text-start text-[12px] leading-[1.5] text-[#E6E8EB]">
      {tokens}
    </pre>
  );
}

function nextVersion(name: string): number {
  const m = /_v(\d+)$/.exec(name);
  return (m ? Number(m[1]) : 1) + 1;
}

function TemplateDrawer({
  row,
  sender,
  readOnly,
  canDelete,
  busy,
  onClose,
  onResubmit,
  onDelete,
}: {
  row: TemplateRow;
  sender: string;
  readOnly: boolean;
  canDelete: boolean;
  busy: boolean;
  onClose: () => void;
  onResubmit: () => void;
  onDelete: () => void;
}) {
  const L = useLabels();
  const { t, tCommon } = L;
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    // Capture phase: the topmost surface wins (design-system §4.13).
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const canFix = !readOnly && row.status === "REJECTED" && Boolean(row.catalogue_key);
  const showDelete = !readOnly && canDelete;
  const json = { name: row.name, language: row.language, category: row.category, components: row.components };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-[rgba(17,24,39,0.28)]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("drawer.dialog", { name: row.name })}
        className="flex h-full w-full flex-col border-s border-line bg-surface-card shadow-panel sm:w-[520px]"
      >
        <div className="flex items-center gap-2.5 border-b border-line-subtle px-[18px] py-3.5">
          <h3 className="m-0 min-w-0 flex-1 truncate font-mono text-[16px] font-semibold text-ink-primary" dir="ltr">
            {`${row.name} · ${row.language}`}
          </h3>
          <Badge tone={statusTone(row.status)} dot>
            {L.status(row.status)}
          </Badge>
          <button
            ref={closeRef}
            type="button"
            aria-label={tCommon("close")}
            onClick={onClose}
            className="grid h-[34px] w-[34px] place-items-center rounded-[8px] border border-line bg-surface-card text-ink-primary hover:bg-surface-hover"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] py-4">
          {row.status === "REJECTED" && (
            <div className="flex items-start gap-2.5 rounded-[8px] border border-[#F5C6BC] bg-status-criticalBg px-3 py-2.5 text-[13px] leading-[1.45] text-[#9A2A14]">
              <AlertTriangle size={16} className="mt-px flex-none" aria-hidden />
              <div>
                <b className="font-semibold">{t("drawer.reason")}</b>
                <div className="mt-0.5">{row.rejected_reason ?? "—"}</div>
              </div>
            </div>
          )}

          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-secondary">{t("drawer.preview")}</div>
            <PhonePreview row={row} sender={sender} label={L.variable} />
          </div>

          <div>
            <div className="mb-1 text-[12px] font-medium text-ink-secondary">{t("drawer.json")}</div>
            <JsonView value={json} />
          </div>
        </div>

        {(canFix || showDelete) && (
          <div className="flex items-center gap-2 border-t border-line-subtle bg-surface-sunken px-[18px] py-3">
            {canFix && (
              <button type="button" className={btnPrimaryCls} onClick={onResubmit} disabled={busy}>
                {busy ? <Loader2 size={14} className="animate-spin" aria-hidden /> : <Pencil size={14} strokeWidth={1.8} aria-hidden />}
                {t("drawer.fix", { n: nextVersion(row.name) })}
              </button>
            )}
            <span className="flex-1" />
            {showDelete && (
              <button type="button" className={btnDangerCls} onClick={onDelete}>
                <Trash2 size={14} strokeWidth={1.8} aria-hidden />
                {t("drawer.delete")}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** One market in the switch, with its template count (SWR dedupes the active market's request with the table's). */
function MarketPill({ market, label, active, onPick }: { market: Market; label: string; active: boolean; onPick: () => void }) {
  const { data } = useSWR<{ data: TemplateRow[] }>(templatesKey(market.id), fetcher, { revalidateOnFocus: false });
  const count = data?.data?.length;
  return (
    <button type="button" aria-pressed={active} onClick={onPick} className={active ? "on" : undefined}>
      {label}
      {count !== undefined && <span className="n num">{count}</span>}
    </button>
  );
}

const STATE_CLASS: Record<string, string> = { APPROVED: "done", PENDING: "prog", PAUSED: "prog", REJECTED: "open" };

export interface TemplatesTableProps {
  markets: Market[];
  initialMarketId: string;
  /** market_manager: reads everything, maps no event, resubmits and deletes nothing. */
  readOnly?: boolean;
  /** super_admin: « Supprimer » in the drawer. */
  canDelete?: boolean;
  /** Where to connect the number; null hides the link (a manager cannot connect). */
  connectionsHref?: string | null;
}

/**
 * The Modèles card (prototype `templates()`, `.tbl-card`): the title and what
 * a template is, « Synchroniser avec Meta » and « Créer les modèles Ordra »,
 * the market switch for a super_admin, the offline note while the number is
 * not connected, then Modèle · Envoyé quand · Langue · État. Rendered inside
 * the page's `.wam` root, whose stylesheet carries the look. A row opens the
 * drawer (preview, JSON sent to Meta, resubmit, delete).
 */
export function TemplatesTable({ markets, initialMarketId, readOnly = false, canDelete = false, connectionsHref = null }: TemplatesTableProps) {
  const L = useLabels();
  const { t, tCommon } = L;
  const tMarkets = useTranslations("nav.markets");
  const toast = useToast();
  const [marketId, setMarketId] = useState(initialMarketId);
  const { data, mutate, isLoading } = useSWR<{ data: TemplateRow[] }>(templatesKey(marketId), fetcher, { revalidateOnFocus: false });
  const rows = useMemo(() => data?.data ?? [], [data]);
  const { availability } = useWhatsAppAvailability(marketId);
  const notConnected = availability?.connected === false;

  const [busy, setBusy] = useState<"sync" | "catalogue" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const open = rows.find((r) => r.id === openId) ?? null;

  const labelOf = useCallback((m: Market | undefined) => (m && (m.code === "tn" || m.code === "ly") ? tMarkets(m.code) : (m?.name ?? "")), [tMarkets]);
  const market = markets.find((m) => m.id === marketId);
  const sender = availability?.verified_name ?? t("drawer.sender", { market: labelOf(market) });

  const post = useCallback(
    async (path: "sync" | "catalogue") => {
      setBusy(path);
      setError(null);
      try {
        const res = await fetch(`/api/whatsapp/templates/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ market_id: marketId }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(body?.message ?? t("callFailed"));
          return;
        }
        const d = body.data ?? {};
        if (path === "sync") {
          const parts = [t("synced", { total: d.total ?? 0, updated: d.updated ?? 0 })];
          if (d.inserted) parts.push(t("syncedNew", { n: d.inserted }));
          if (d.deleted) parts.push(t("syncedGone", { n: d.deleted }));
          toast.show({ message: parts.join(", ") });
        } else {
          const created = (d.created ?? []) as string[];
          const failed = (d.failed ?? []) as { name: string; language: string; error: string }[];
          const parts = [created.length > 0 ? t("created", { n: created.length }) : t("createdNone")];
          if (failed.length > 0) parts.push(t("createdFailed", { n: failed.length, list: failed.map((f) => `${f.name}/${f.language} (${f.error})`).join(", ") }));
          toast.show({ message: parts.join(" · "), tone: failed.length > 0 ? "warning" : "info" });
        }
        mutate();
      } catch {
        setError(t("callFailed"));
      } finally {
        setBusy(null);
      }
    },
    [marketId, mutate, t, toast],
  );

  const setEvent = useCallback(
    async (row: TemplateRow, eventKey: string) => {
      setError(null);
      const res = await fetch(`/api/whatsapp/templates/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ event_key: eventKey === "" ? null : eventKey }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? t("mapRefused"));
        return;
      }
      mutate();
    },
    [mutate, t],
  );

  const remove = useCallback(
    async (row: TemplateRow) => {
      if (!window.confirm(t("confirmDelete", { name: row.name }))) return;
      const res = await fetch(`/api/whatsapp/templates/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body?.message ?? t("deleteRefused"));
        return;
      }
      setOpenId(null);
      mutate();
    },
    [mutate, t],
  );

  const closeDrawer = useCallback(() => setOpenId(null), []);
  const eventLabel = (r: TemplateRow) =>
    r.source === "campaign" ? (r.campaign_name ? t("campaignChip", { name: r.campaign_name }) : t("event.campaign")) : r.event_key ? t(`event.${r.event_key}`) : t("event.none");

  return (
    <section className="card tbl-card">
      <div className="stools">
        <div>
          <div className="ttl">{t("title")}</div>
          <div className="meta">{t("sub")}</div>
        </div>
        <span style={{ flex: 1 }} />
        {markets.length > 1 && (
          <div role="group" aria-label={t("marketGroup")} className="mini">
            {markets.map((m) => (
              <MarketPill
                key={m.id}
                market={m}
                label={labelOf(m)}
                active={m.id === marketId}
                onPick={() => {
                  setMarketId(m.id);
                  setOpenId(null);
                  setError(null);
                }}
              />
            ))}
          </div>
        )}
        <button type="button" className="btn sec" onClick={() => post("sync")} disabled={busy !== null || notConnected}>
          {busy === "sync" ? <Loader2 className="ic animate-spin" aria-hidden /> : <Clock className="ic" strokeWidth={1.9} aria-hidden />}
          {t("sync")}
        </button>
        <button type="button" className="btn pri" onClick={() => post("catalogue")} disabled={busy !== null || notConnected}>
          {busy === "catalogue" ? <Loader2 className="ic animate-spin" aria-hidden /> : <Plus className="ic" strokeWidth={2.2} aria-hidden />}
          {t("create")}
        </button>
      </div>

      {notConnected && (
        <div role="status" className="offline">
          <Info className="ic" strokeWidth={1.9} aria-hidden />
          {t("offline")}
          {connectionsHref && <Link href={connectionsHref}>{tCommon("goToConnections")}</Link>}
        </div>
      )}

      {error && (
        <p role="alert" className="offline err">
          <AlertTriangle className="ic" strokeWidth={1.9} aria-hidden />
          {error}
        </p>
      )}

      <div className={`tblwrap ${notConnected || error ? "gap" : ""}`}>
        <table>
          <thead>
            <tr>
              {(["name", "when", "lang", "state"] as const).map((c) => (
                <th key={c}>{t(`cols.${c}`)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={4} className="empty">
                  {tCommon("loading")}
                </td>
              </tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="empty">
                  {t("empty")} {notConnected ? "" : t("emptyHint")}
                </td>
              </tr>
            )}
            {rows.map((r) => {
              const mappable = (r.language === "ar" || r.language === "fr") && r.source !== "campaign";
              return (
                <tr key={r.id} aria-selected={r.id === openId} onClick={() => setOpenId(r.id)} className={`r ${r.id === openId ? "peek" : ""}`}>
                  <td>
                    <code className="tpl" dir="ltr">
                      {r.name}
                    </code>
                    {r.header_format === "IMAGE" && (
                      <span className="tag" style={{ marginInlineStart: 6, verticalAlign: "middle" }} title={t("imageHeader")}>
                        <ImageIcon className="ic" aria-label={t("imageHeader")} />
                      </span>
                    )}
                  </td>
                  <td style={{ fontWeight: 600 }} onClick={(e) => !readOnly && mappable && e.stopPropagation()}>
                    {readOnly || !mappable ? (
                      eventLabel(r)
                    ) : (
                      <select aria-label={t("eventAria", { name: r.name, lang: r.language })} value={r.event_key ?? ""} onChange={(e) => setEvent(r, e.target.value)} className="evsel">
                        <option value="">{t("event.none")}</option>
                        {LIFECYCLE_EVENT_KEYS.map((k) => (
                          <option key={k} value={k}>
                            {t(`event.${k}`)}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="meta">{L.lang(r.language)}</td>
                  <td>
                    <span className={`st ${STATE_CLASS[r.status] ?? "imp"}`}>
                      <i />
                      {L.status(r.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {open && (
        <TemplateDrawer
          row={open}
          sender={sender}
          readOnly={readOnly}
          canDelete={canDelete}
          busy={busy === "catalogue"}
          onClose={closeDrawer}
          onResubmit={() => post("catalogue")}
          onDelete={() => remove(open)}
        />
      )}
    </section>
  );
}
