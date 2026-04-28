"use client";

import { useEffect, useRef, useState } from "react";
import FocusTrap from "focus-trap-react";
import { useTranslations } from "next-intl";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Lock,
  Plug,
  Settings as SettingsIcon,
  TrendingUp,
  Wrench,
  X,
} from "lucide-react";

interface CredentialField {
  key: string;
  label: string;
  placeholder?: string;
  secret: boolean;
}

interface AdapterDescriptor {
  code: string;
  label: string;
  description: string;
  defaultEndpoint?: string;
  credentialFields: CredentialField[];
  markets?: string[];
}

interface IntegrationGuidePanelProps {
  adapters: AdapterDescriptor[];
  onClose: () => void;
  onAddCarrier?: () => void;
}

type SectionId =
  | "overview"
  | "adapters"
  | "newAdapter"
  | "rotation"
  | "performance"
  | "troubleshooting";

const SECTION_ORDER: SectionId[] = [
  "overview",
  "adapters",
  "newAdapter",
  "rotation",
  "performance",
  "troubleshooting",
];

const SECTION_ICON: Record<SectionId, typeof Plug> = {
  overview: Plug,
  adapters: SettingsIcon,
  newAdapter: Wrench,
  rotation: Lock,
  performance: TrendingUp,
  troubleshooting: AlertTriangle,
};

export function IntegrationGuidePanel({
  adapters,
  onClose,
  onAddCarrier,
}: IntegrationGuidePanelProps) {
  const t = useTranslations("settings.carriers.onboarding");
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [activeSection, setActiveSection] = useState<SectionId>("overview");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const scrollTo = (id: SectionId) => {
    setActiveSection(id);
    const el = scrollRef.current?.querySelector<HTMLElement>(
      `[data-section="${id}"]`,
    );
    if (el && scrollRef.current) {
      scrollRef.current.scrollTo({
        top: el.offsetTop - 12,
        behavior: "smooth",
      });
    }
  };

  return (
    <>
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-[rgba(26,26,26,0.5)]"
      />
      <FocusTrap
        focusTrapOptions={{
          escapeDeactivates: false,
          allowOutsideClick: true,
          initialFocus: () => closeButtonRef.current ?? undefined,
        }}
      >
        <aside
          role="dialog"
          aria-modal="true"
          aria-label={t("dialogLabel")}
          className="fixed inset-y-0 z-50 flex w-[min(640px,100vw)] flex-col border-s border-line bg-surface-card shadow-floating end-0"
        >
          <header className="flex items-start gap-3 border-b border-line-subtle px-6 py-4">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[12px] font-medium uppercase tracking-wider text-ink-secondary">
                <Plug size={12} />
                {t("eyebrow")}
              </div>
              <h2 className="mt-1 text-[18px] font-semibold text-ink-primary">
                {t("title")}
              </h2>
              <p className="mt-1 text-[13px] text-ink-secondary">
                {t("subtitle")}
              </p>
            </div>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="rounded p-1.5 text-ink-secondary hover:bg-surface-hover"
            >
              <X size={18} />
            </button>
          </header>

          <nav
            aria-label={t("tocLabel")}
            className="flex shrink-0 gap-1 overflow-x-auto border-b border-line-subtle bg-surface-page px-4 py-2"
          >
            {SECTION_ORDER.map((id) => {
              const Icon = SECTION_ICON[id];
              const active = activeSection === id;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => scrollTo(id)}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12px] font-medium transition-colors duration-fast ${
                    active
                      ? "bg-surface-card text-ink-primary shadow-hover-row"
                      : "text-ink-secondary hover:text-ink-primary"
                  }`}
                >
                  <Icon size={12} />
                  {t(`sections.${id}.tab`)}
                </button>
              );
            })}
          </nav>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-6 py-5 text-[14px] leading-relaxed text-ink-primary"
          >
            <Section id="overview" title={t("sections.overview.title")}>
              <p className="m-0">{t("sections.overview.body")}</p>
              <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                <Stat
                  label={t("sections.overview.stat1Label")}
                  value={t("sections.overview.stat1Value", {
                    count: adapters.length,
                  })}
                />
                <Stat
                  label={t("sections.overview.stat2Label")}
                  value={t("sections.overview.stat2Value")}
                />
                <Stat
                  label={t("sections.overview.stat3Label")}
                  value={t("sections.overview.stat3Value")}
                />
              </ul>
            </Section>

            <Section id="adapters" title={t("sections.adapters.title")}>
              <p className="m-0 text-ink-secondary">
                {t("sections.adapters.body")}
              </p>
              {adapters.length === 0 ? (
                <div className="mt-3 rounded-card border border-dashed border-line bg-surface-page p-4 text-[13px] text-ink-secondary">
                  {t("sections.adapters.empty")}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-3">
                  {adapters.map((a) => (
                    <AdapterCard key={a.code} adapter={a} />
                  ))}
                </div>
              )}
            </Section>

            <Section id="newAdapter" title={t("sections.newAdapter.title")}>
              <p className="m-0 text-ink-secondary">
                {t("sections.newAdapter.body")}
              </p>
              <ol className="mt-3 flex flex-col gap-3">
                <Step n={1} title={t("sections.newAdapter.step1Title")}>
                  <p className="m-0">{t("sections.newAdapter.step1Body")}</p>
                  <CodeBlock
                    text="src/lib/carriers/<code>-adapter.ts"
                    label={t("copyPath")}
                  />
                </Step>
                <Step n={2} title={t("sections.newAdapter.step2Title")}>
                  <p className="m-0">{t("sections.newAdapter.step2Body")}</p>
                  <CodeBlock
                    text="src/lib/carriers/adapter-registry.ts"
                    label={t("copyPath")}
                  />
                </Step>
                <Step n={3} title={t("sections.newAdapter.step3Title")}>
                  <p className="m-0">{t("sections.newAdapter.step3Body")}</p>
                </Step>
                <Step n={4} title={t("sections.newAdapter.step4Title")}>
                  <p className="m-0">{t("sections.newAdapter.step4Body")}</p>
                </Step>
                <Step n={5} title={t("sections.newAdapter.step5Title")}>
                  <p className="m-0">{t("sections.newAdapter.step5Body")}</p>
                </Step>
              </ol>
            </Section>

            <Section id="rotation" title={t("sections.rotation.title")}>
              <p className="m-0">{t("sections.rotation.body")}</p>
              <div className="mt-3 rounded-card border border-line-subtle bg-surface-page p-3 text-[13px] text-ink-secondary">
                <div className="font-medium text-ink-primary">
                  {t("sections.rotation.tipTitle")}
                </div>
                <p className="m-0 mt-1">{t("sections.rotation.tipBody")}</p>
              </div>
            </Section>

            <Section id="performance" title={t("sections.performance.title")}>
              <p className="m-0">{t("sections.performance.body")}</p>
              <ul className="mt-3 flex flex-col gap-2">
                <HealthRow
                  state="healthy"
                  label={t("sections.performance.healthy")}
                />
                <HealthRow
                  state="degraded"
                  label={t("sections.performance.degraded")}
                />
                <HealthRow
                  state="critical"
                  label={t("sections.performance.critical")}
                />
              </ul>
            </Section>

            <Section
              id="troubleshooting"
              title={t("sections.troubleshooting.title")}
            >
              <div className="flex flex-col gap-3">
                <TroubleshootRow
                  title={t("sections.troubleshooting.ping.title")}
                  body={t("sections.troubleshooting.ping.body")}
                />
                <TroubleshootRow
                  title={t("sections.troubleshooting.dryRun.title")}
                  body={t("sections.troubleshooting.dryRun.body")}
                />
                <TroubleshootRow
                  title={t("sections.troubleshooting.lowDelivery.title")}
                  body={t("sections.troubleshooting.lowDelivery.body")}
                />
                <TroubleshootRow
                  title={t("sections.troubleshooting.unknownAdapter.title")}
                  body={t("sections.troubleshooting.unknownAdapter.body")}
                />
              </div>
            </Section>
          </div>

          <footer className="flex items-center justify-between border-t border-line-subtle px-6 py-3">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line bg-surface-card px-3 py-2 text-[13px] font-medium text-ink-primary hover:bg-surface-hover"
            >
              {t("close")}
            </button>
            {onAddCarrier && (
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onAddCarrier();
                }}
                className="inline-flex items-center gap-1.5 rounded-md bg-ink-primary px-3.5 py-2 text-[13px] font-medium text-white hover:opacity-90"
              >
                {t("addCarrier")}
                <ChevronRight size={14} />
              </button>
            )}
          </footer>
        </aside>
      </FocusTrap>
    </>
  );
}

function Section({
  id,
  title,
  children,
}: {
  id: SectionId;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section
      data-section={id}
      className="mb-8 scroll-mt-3"
      aria-labelledby={`section-${id}-heading`}
    >
      <h3
        id={`section-${id}-heading`}
        className="m-0 mb-2 text-[15px] font-semibold text-ink-primary"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <li className="rounded-card border border-line-subtle bg-surface-page p-3">
      <div className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
        {label}
      </div>
      <div className="mt-1 text-[14px] font-semibold tabular-nums text-ink-primary">
        {value}
      </div>
    </li>
  );
}

function Step({
  n,
  title,
  children,
}: {
  n: number;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex gap-3 rounded-card border border-line-subtle bg-surface-card p-3">
      <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-page text-[12px] font-semibold tabular-nums text-ink-primary">
        {n}
      </div>
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-medium text-ink-primary">{title}</div>
        <div className="mt-1 text-ink-secondary">{children}</div>
      </div>
    </li>
  );
}

function AdapterCard({ adapter }: { adapter: AdapterDescriptor }) {
  const t = useTranslations("settings.carriers.onboarding");
  return (
    <article className="rounded-card border border-line-subtle bg-surface-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="m-0 text-[14px] font-semibold text-ink-primary">
            {adapter.label}
          </h4>
          <code className="rounded bg-surface-page px-1.5 py-0.5 font-mono text-[12px] text-ink-secondary">
            {adapter.code}
          </code>
        </div>
        {adapter.markets && adapter.markets.length > 0 && (
          <div className="flex gap-1">
            {adapter.markets.map((m) => (
              <span
                key={m}
                className="inline-block rounded-pill bg-status-neutralBg px-2 py-0.5 text-[11px] font-medium uppercase text-status-neutral"
              >
                {m}
              </span>
            ))}
          </div>
        )}
      </div>
      <p className="m-0 mt-1 text-[13px] text-ink-secondary">
        {adapter.description}
      </p>

      {adapter.defaultEndpoint && (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
            {t("adapter.endpoint")}
          </div>
          <CodeBlock
            text={adapter.defaultEndpoint}
            label={t("copyEndpoint")}
            tight
          />
        </div>
      )}

      {adapter.credentialFields.length > 0 && (
        <div className="mt-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-ink-secondary">
            {t("adapter.credentials")}
          </div>
          <ul className="mt-1 flex flex-col gap-1">
            {adapter.credentialFields.map((f) => (
              <li
                key={f.key}
                className="flex items-center justify-between gap-2 rounded-md bg-surface-page px-2.5 py-1.5"
              >
                <div className="min-w-0">
                  <span className="text-[13px] font-medium text-ink-primary">
                    {f.label}
                  </span>
                  <code className="ms-2 font-mono text-[12px] text-ink-secondary">
                    {f.key}
                  </code>
                </div>
                {f.secret && (
                  <span className="inline-flex items-center gap-1 rounded-pill bg-status-warningBg px-2 py-0.5 text-[11px] font-medium text-status-warning">
                    <Lock size={10} />
                    {t("adapter.secret")}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function CodeBlock({
  text,
  label,
  tight = false,
}: {
  text: string;
  label: string;
  tight?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-md border border-line-subtle bg-surface-page px-2.5 py-1.5 ${
        tight ? "mt-1" : "mt-2"
      }`}
    >
      <code className="overflow-hidden text-ellipsis whitespace-nowrap font-mono text-[12px] text-ink-primary">
        {text}
      </code>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={label}
        className="inline-flex shrink-0 items-center gap-1 rounded border border-line bg-surface-card px-1.5 py-0.5 text-[11px] font-medium text-ink-secondary hover:bg-surface-hover"
      >
        {copied ? <Check size={11} /> : <Copy size={11} />}
        {copied ? "✓" : label}
      </button>
    </div>
  );
}

function HealthRow({
  state,
  label,
}: {
  state: "healthy" | "degraded" | "critical";
  label: string;
}) {
  const dotClass =
    state === "healthy"
      ? "bg-status-success"
      : state === "degraded"
        ? "bg-status-warning"
        : "bg-status-critical";
  return (
    <li className="flex items-start gap-3 text-[13px]">
      <span
        className={`mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full ${dotClass}`}
        aria-hidden
      />
      <span className="text-ink-primary">{label}</span>
    </li>
  );
}

function TroubleshootRow({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex gap-3 rounded-card border border-line-subtle bg-surface-card p-3">
      <ExternalLink
        size={14}
        className="mt-0.5 shrink-0 text-ink-secondary"
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-[13px]">
        <div className="font-medium text-ink-primary">{title}</div>
        <p className="m-0 mt-1 text-ink-secondary">{body}</p>
      </div>
    </div>
  );
}
