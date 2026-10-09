"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowRight, Link2, MessageCircle, Send, ShieldCheck, Sparkles } from "lucide-react";

const WILL = [
  { key: "write", Icon: MessageCircle },
  { key: "attach", Icon: Link2 },
  { key: "auto", Icon: Send },
] as const;
const STEPS = ["meta", "link", "test"] as const;

/**
 * The page while the market's number is not connected (prototype `dormant()`):
 * what the page will do once it is, the three steps to get there, and the way
 * to Connexions — a link for a super_admin, who alone can connect; a manager
 * reads who can.
 */
export function DormantCard({ locale, canConnect }: { locale: string; canConnect: boolean }) {
  const t = useTranslations("whatsappAdmin.dormant");
  return (
    <section className="card dorm" data-testid="messages-dormant">
      <div>
        <div className="waic">
          <MessageCircle className="ic" strokeWidth={1.9} aria-hidden />
        </div>
        <h2>{t("title")}</h2>
        <p className="lead">{t("lead")}</p>
        <div className="eyebrow" style={{ marginTop: 26 }}>
          <Sparkles className="ic" strokeWidth={1.9} aria-hidden />
          {t("willTitle")}
        </div>
        <ul className="will">
          {WILL.map(({ key, Icon }) => (
            <li key={key}>
              <span className="n">
                <Icon className="ic" strokeWidth={1.9} aria-hidden />
              </span>
              <div>
                <b>{t(`will.${key}.title`)}</b>
                <span>{t(`will.${key}.sub`)}</span>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className="eyebrow">
          <ShieldCheck className="ic" strokeWidth={1.9} aria-hidden />
          {t("stepsTitle")}
        </div>
        <ol className="steps">
          {STEPS.map((key, i) => (
            <li key={key}>
              <span className="c num">{i + 1}</span>
              <div>
                <b>{t(`steps.${key}.title`)}</b>
                <span>{t(`steps.${key}.sub`)}</span>
              </div>
            </li>
          ))}
        </ol>
        <div className="cta">
          {canConnect && (
            <Link href={`/${locale}/system/settings/whatsapp`} className="btn pri">
              {t("openConn")}
              <ArrowRight className="ic flip" strokeWidth={1.9} aria-hidden />
            </Link>
          )}
          <span className="meta">{t("onlySa")}</span>
        </div>
      </div>
    </section>
  );
}
