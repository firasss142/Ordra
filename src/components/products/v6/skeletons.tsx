"use client";

import type { ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ChevronRight, Inbox, Phone, Truck, Wallet, TrendingUp } from "lucide-react";
import { Kpi } from "./atoms";
import "@/components/finance/kit/finance-kit.css";
import "./products-v6.css";

/*
 * LOADING — each products page's own markup, with grey bars where its figures
 * go. The route's loading.tsx and the component's first data wait render the
 * SAME skeleton, so a page goes from one shape to its filled-in self and never
 * through a different layout. Sizes are the real components' (row medallion 44,
 * hero 84, edit 52, KPI value 30px, inputs 40px).
 */

function Bar({ w, h = 12, r, mt }: { w: number | string; h?: number; r?: number; mt?: number }) {
  return <span className="skl" aria-hidden style={{ width: w, height: h, borderRadius: r, marginTop: mt }} />;
}

function Busy({ children }: { children: ReactNode }) {
  const t = useTranslations("products.v6");
  return (
    <div className="fin prd">
      <div className="page" role="status" aria-busy="true">
        <span className="sr-only">{t("loading")}</span>
        {children}
      </div>
    </div>
  );
}

function PeriodBar() {
  return (
    <div className="prow">
      <Bar w={360} h={40} r={13} />
      <Bar w={190} h={32} r={99} />
      <Bar w={290} h={32} r={99} />
    </div>
  );
}

function Kpis() {
  const t = useTranslations("products.v6");
  const kpis = [
    { icon: <Inbox className="ic" aria-hidden />, tone: "k-src", label: t("k_rec") },
    { icon: <Phone className="ic" aria-hidden />, tone: "k-up", label: t("k_conf") },
    { icon: <Truck className="ic" aria-hidden />, tone: "k-dlv", label: t("k_dlv") },
    { icon: <Wallet className="ic" aria-hidden />, tone: "k-neu", label: t("k_enc") },
    { icon: <TrendingUp className="ic" aria-hidden />, tone: "k-profit", label: t("k_net") },
  ];
  return (
    <div className="kpis" style={{ ["--n" as string]: 5 }}>
      {kpis.map((k) => (
        <Kpi key={k.tone + k.label} icon={k.icon} tone={k.tone} label={k.label} value={<Bar w={120} h={30} r={8} />} sub={<Bar w={150} />} />
      ))}
    </div>
  );
}

function Crumb() {
  return (
    <div className="crumb">
      <Bar w={220} h={13} />
    </div>
  );
}

function CardBlock({ body }: { body: number }) {
  return (
    <section className="card">
      <div className="chead">
        <div>
          <Bar w={220} h={20} r={7} />
          <Bar w={300} h={13} mt={8} />
        </div>
      </div>
      <div className="cbody">
        <Bar w="100%" h={body} r={14} mt={6} />
      </div>
    </section>
  );
}

function RowSkeleton() {
  return (
    <div className="row" aria-hidden>
      <div>
        <div className="pc">
          <Bar w={44} h={44} r={13} />
          <div className="pn">
            <Bar w={160} h={14} />
            <Bar w={90} mt={7} />
          </div>
        </div>
      </div>
      <div>
        <Bar w={60} h={16} />
        <Bar w={90} mt={6} />
        <Bar w={110} h={6} mt={8} />
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
        <Bar w={120} h={6} mt={8} />
        <Bar w={90} mt={6} />
      </div>
      <div>
        <Bar w={50} h={16} />
        <Bar w={150} h={8} mt={8} />
        <Bar w={100} mt={6} />
      </div>
      <div>
        <Bar w={90} h={16} />
        <Bar w={170} h={8} mt={8} />
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
      <header className="ph">
        <div>
          <div className="crumb">
            {t("crumb_fin")} <ChevronRight className="ic" aria-hidden /> {t("l_title")}
          </div>
          <h1>{t("l_title")}</h1>
          <div className="sub">{t("l_sub")}</div>
        </div>
        <div className="acts">
          <Bar w={130} h={40} r={12} />
          <Bar w={180} h={40} r={12} />
        </div>
      </header>
      <PeriodBar />
      <Kpis />
      <div className="tools">
        <Bar w={260} h={40} r={13} />
        <span className="grow" />
        <Bar w={320} h={38} r={12} />
      </div>
      <section className="card tblc">
        <div className="tscroll">
          <div className="tg">
            <div className="thd">
              {(["h_prod", "h_stock", "h_orders", "h_conf", "h_dlv", "h_money", "h_net"] as const).map((k) => (
                <div key={k}>{t(k)}</div>
              ))}
              <div />
            </div>
            <div className="rows">
              {Array.from({ length: 8 }, (_, i) => (
                <RowSkeleton key={i} />
              ))}
            </div>
          </div>
        </div>
        <div className="lgd">
          <Bar w={420} />
        </div>
      </section>
    </Busy>
  );
}

/** `money` false: the warehouse agent's sheet — the hero and the stock, never the figures. */
export function ProductSheetSkeleton({ money = true }: { money?: boolean }) {
  return (
    <Busy>
      <Crumb />
      <section className="card phero">
        <Bar w={84} h={84} r={24} />
        <div className="grow">
          <Bar w={260} h={30} r={8} />
          <div className="chips">
            <Bar w={70} h={26} r={99} />
            <Bar w={64} h={22} r={6} />
            <Bar w={150} h={26} r={99} />
          </div>
          <Bar w={210} mt={12} />
        </div>
        <div className="acts">
          <Bar w={120} h={40} r={12} />
          <Bar w={150} h={40} r={12} />
        </div>
      </section>
      {money ? (
        <>
          <PeriodBar />
          <Kpis />
          <CardBlock body={300} />
          <CardBlock body={220} />
          <CardBlock body={180} />
          <CardBlock body={160} />
        </>
      ) : null}
      <div className="two">
        <CardBlock body={160} />
        <CardBlock body={160} />
      </div>
    </Busy>
  );
}

function FieldSkeleton() {
  return (
    <div className="field">
      <Bar w={90} h={13} />
      <Bar w="100%" h={40} r={11} mt={8} />
    </div>
  );
}

export function ProductEditSkeleton() {
  return (
    <Busy>
      <Crumb />
      <div className="ehead">
        <Bar w={52} h={52} r={16} />
        <div className="grow">
          <Bar w={240} h={26} r={8} />
          <Bar w={140} h={13} mt={8} />
        </div>
        <div className="acts">
          <Bar w={120} h={40} r={12} />
          <Bar w={130} h={40} r={12} />
        </div>
      </div>
      <div className="tabsrow">
        <div className="seg">
          {Array.from({ length: 5 }, (_, i) => (
            <Bar key={i} w={100} h={32} r={10} />
          ))}
        </div>
      </div>
      <div className="egrid">
        <div className="card panel">
          <div className="fg">
            <div>
              <Bar w={150} h={16} />
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
          <div className="card rc">
            <Bar w={120} h={12} />
            <Bar w="100%" h={150} r={12} mt={12} />
          </div>
        </aside>
      </div>
    </Busy>
  );
}
