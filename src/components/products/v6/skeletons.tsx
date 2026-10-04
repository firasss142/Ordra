"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Inbox, Phone, Truck, Wallet, TrendingUp } from "lucide-react";
import { Kpi } from "./atoms";
import "./products-v6.css";

/*
 * LOADING — each products page's own markup, with grey bars where its figures
 * go. The route's loading.tsx and the component's first data wait render the
 * SAME skeleton, so a page goes from one shape to its filled-in self and never
 * through a different layout. Sizes are the real components' (row thumb 46,
 * hero thumb 84, edit thumb 52, KPI value 25px, inputs 40px).
 */

function Bar({ w, h = 12, r, mt }: { w: number | string; h?: number; r?: number; mt?: number }) {
  return <span className="skl" aria-hidden style={{ width: w, height: h, borderRadius: r, marginTop: mt }} />;
}

function Busy({ children }: { children: ReactNode }) {
  const t = useTranslations("products.v6");
  return (
    <div className="pv6 page" role="status" aria-busy="true">
      <span className="sr-only">{t("loading")}</span>
      {children}
    </div>
  );
}

function PeriodBar() {
  return (
    <div className="pbar2">
      <Bar w={330} h={36} r={11} />
      <Bar w={190} h={13} />
    </div>
  );
}

function Kpis() {
  const t = useTranslations("products.v6");
  const kpis = [
    { icon: <Inbox className="ic" aria-hidden />, tone: "t-slate", label: t("k_rec") },
    { icon: <Phone className="ic" aria-hidden />, tone: "t-conf", label: t("k_conf") },
    { icon: <Truck className="ic" aria-hidden />, tone: "t-ok", label: t("k_dlv") },
    { icon: <Wallet className="ic" aria-hidden />, tone: "t-gold", label: t("k_enc") },
    { icon: <TrendingUp className="ic" aria-hidden />, tone: "t-ok", label: t("k_net") },
  ];
  return (
    <div className="kpis">
      {kpis.map((k) => (
        <Kpi
          key={k.tone + k.label}
          icon={k.icon}
          tone={k.tone}
          label={k.label}
          value={<Bar w={110} h={27} r={7} />}
          sub={<Bar w={150} />}
        />
      ))}
    </div>
  );
}

function Crumb() {
  return (
    <div className="crumb">
      <Bar w={180} h={13} />
    </div>
  );
}

function CardBlock({ body }: { body: number }) {
  return (
    <section className="card">
      <Bar w={200} h={16} />
      <Bar w={300} h={13} mt={6} />
      <Bar w="100%" h={body} r={10} mt={14} />
    </section>
  );
}

function RowSkeleton() {
  return (
    <div className="tr" aria-hidden>
      <div>
        <div className="prod">
          <Bar w={46} h={46} r={11} />
          <div className="pn">
            <Bar w={160} h={14} />
            <Bar w={90} mt={7} />
          </div>
        </div>
      </div>
      <div>
        <Bar w={60} h={16} />
        <Bar w={90} mt={6} />
        <Bar w={110} h={5} mt={7} />
      </div>
      <div>
        <div className="ord">
          <div>
            <Bar w={40} h={16} />
            <Bar w={60} mt={6} />
          </div>
          <Bar w={84} h={26} r={7} />
        </div>
      </div>
      <div>
        <Bar w={50} h={16} />
        <Bar w={130} h={6} mt={7} />
        <Bar w={90} mt={6} />
      </div>
      <div>
        <Bar w={50} h={16} />
        <Bar w={160} h={7} mt={7} />
        <Bar w={100} mt={6} />
      </div>
      <div>
        <Bar w={90} h={16} />
        <Bar w={180} h={7} mt={7} />
        <Bar w={60} mt={6} />
      </div>
      <div>
        <Bar w={80} h={16} />
        <Bar w={60} mt={6} />
      </div>
      <div />
    </div>
  );
}

export function ProductsListSkeleton() {
  const t = useTranslations("products.v6");
  return (
    <Busy>
      <div className="ph">
        <div>
          <h1>{t("l_title")}</h1>
          <p className="sub">{t("l_sub")}</p>
        </div>
        <div className="acts">
          <Bar w={120} h={38} r={10} />
          <Bar w={170} h={38} r={10} />
        </div>
      </div>
      <PeriodBar />
      <Kpis />
      <div className="tools">
        <Bar w={260} h={36} r={11} />
        <span className="grow" />
        <Bar w={330} h={36} r={10} />
      </div>
      <div className="tcard">
        <div className="tscroll">
          <div className="tbl">
            <div className="thr">
              {(["h_prod", "h_stock", "h_orders", "h_conf", "h_dlv", "h_money", "h_net"] as const).map((k) => (
                <div key={k}>{t(k)}</div>
              ))}
              <div />
            </div>
            <div>
              {Array.from({ length: 8 }, (_, i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
        <div className="legend">
          <Bar w={420} />
        </div>
      </div>
    </Busy>
  );
}

/** `money` false: the warehouse agent's sheet — the hero and the stock, never the figures. */
export function ProductSheetSkeleton({ money = true }: { money?: boolean }) {
  return (
    <Busy>
      <Crumb />
      <div className="hero">
        <Bar w={84} h={84} r={16} />
        <div className="grow">
          <Bar w={260} h={26} r={7} />
          <div className="chips">
            <Bar w={70} h={22} r={7} />
            <Bar w={64} h={22} r={7} />
            <Bar w={84} h={22} r={7} />
          </div>
          <Bar w={210} mt={10} />
        </div>
        <div className="acts">
          <Bar w={120} h={38} r={10} />
          <Bar w={110} h={38} r={10} />
        </div>
      </div>
      {money ? (
        <>
          <PeriodBar />
          <Kpis />
          <CardBlock body={260} />
          <CardBlock body={200} />
          <CardBlock body={180} />
          <CardBlock body={160} />
        </>
      ) : null}
      <div className="two">
        <CardBlock body={140} />
        <CardBlock body={140} />
      </div>
    </Busy>
  );
}

function FieldSkeleton() {
  return (
    <div className="field">
      <Bar w={90} h={13} />
      <Bar w="100%" h={40} r={10} mt={8} />
    </div>
  );
}

export function ProductEditSkeleton() {
  return (
    <Busy>
      <Crumb />
      <div className="ehead">
        <Bar w={52} h={52} r={12} />
        <div className="grow">
          <Bar w={220} h={22} r={7} />
          <Bar w={140} h={13} mt={7} />
        </div>
        <div className="acts">
          <Bar w={100} h={38} r={10} />
          <Bar w={130} h={38} r={10} />
        </div>
      </div>
      <div className="acts">
        <div className="tabs">
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} w={92} h={36} r={9} />
          ))}
        </div>
      </div>
      <div className="egrid">
        <div className="panel">
          <div className="fg">
            <div>
              <Bar w={150} h={15} />
              <Bar w={260} mt={6} />
            </div>
            <FieldSkeleton />
            <div className="frow">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
            <div className="frow">
              <FieldSkeleton />
              <FieldSkeleton />
            </div>
          </div>
        </div>
        <aside className="rail">
          <div className="card rcard">
            <Bar w={120} h={12} />
            <Bar w="100%" h={150} r={10} mt={12} />
          </div>
        </aside>
      </div>
    </Busy>
  );
}
