"use client";

import Link from "next/link";
import useSWR from "swr";
import { useFormatter, useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";
import { jsonFetcher } from "@/lib/fetchers";
import { isDue } from "@/lib/warehouse/desk";
import type { DayLoopPayload } from "@/lib/warehouse/day-loop-assemble";
import type { PickupSiteState } from "@/app/api/warehouse/pickup/route";
import type { ReturnsStats } from "@/app/api/warehouse/returns/stats/route";
import type { ProjectedPurchaseOrder } from "@/lib/purchases/orders";
import { DeskHeader, DeskPage, Ic, LiveSub, SiteSeg, fnum, type Hue } from "./ui";
import type { IconName } from "./icons";

/**
 * Entrepôt › Aujourd'hui, on the desk (prototypes/entrepot-desk-v1.html).
 *
 * Three things, in reading order: the four jobs of the day — one big number
 * each, and the card IS the door to its screen; what the warehouse cannot
 * settle alone; and one card per building, so a building that has not scanned
 * shows up as a building, not as a missing row.
 *
 * Same assembly as the agent's screen (`day-loop-assemble.ts`), so the two can
 * never disagree on a figure.
 */

const AVATAR: Array<[string, string]> = [
  ["#444CE7", "#3538CD"],
  ["#088AB2", "#0E7090"],
  ["#DD2590", "#C11574"],
  ["#F79009", "#DC6803"],
];

export function TodayDesk({
  data,
  locale,
  dateLabel,
  marketCode,
  marketId,
  today,
}: {
  data: DayLoopPayload;
  locale: string;
  dateLabel: string;
  marketCode: "ly" | "tn" | null;
  marketId: string | null;
  /** The market's local date, YYYY-MM-DD. */
  today: string;
}) {
  const t = useTranslations("warehouse.desk");
  const tt = useTranslations("warehouse.desk.today");
  const format = useFormatter();
  const router = useRouter();
  const pathname = usePathname();
  const { counts, sites, loop } = data;
  const isLy = marketCode === "ly";

  const { data: pickup } = useSWR<{ sites?: PickupSiteState[] }>(isLy ? "/api/warehouse/pickup" : null, jsonFetcher, {
    refreshInterval: 60_000,
  });
  const { data: retStats } = useSWR<ReturnsStats>("/api/warehouse/returns/stats", jsonFetcher);
  const { data: pos } = useSWR<{ orders?: ProjectedPurchaseOrder[] }>(
    marketId ? `/api/purchases/orders?status=open&market_id=${marketId}` : null,
    jsonFetcher,
  );

  const inScope = (w: string | null) => data.focus === null || w === data.focus;
  const due = (pos?.orders ?? []).filter((po) => inScope(po.warehouse_id) && isDue(po, today));
  const suppliers = Array.from(new Set(due.map((po) => po.supplier_name).filter(Boolean))) as string[];

  const done = loop.progress.done;
  const pct = done + counts.toPrepare > 0 ? Math.round((done / (done + counts.toPrepare)) * 100) : 0;
  const href = (p: string) => `/${locale}${p}${data.focus ? `?warehouse_id=${data.focus}` : ""}`;
  const time = (iso: string) => format.dateTime(new Date(iso), { hour: "2-digit", minute: "2-digit" });

  const setSite = (id: string | null) => router.replace(`${pathname}${id ? `?warehouse_id=${id}` : ""}`, { scroll: false });

  const Status = ({ tone, children }: { tone: "w" | "b" | "g" | ""; children: React.ReactNode }) => (
    <div className={`st ${tone}`}>
      <i aria-hidden="true" />
      <span dir="auto">{children}</span>
    </div>
  );

  const oldestDays = data.focus === null && retStats && retStats.oldestDays > 0 ? retStats.oldestDays : null;

  const jobs: Array<{
    key: "out" | "returns" | "receive" | "count";
    hue: Hue;
    icon: IconName;
    n: number;
    unit: string;
    status: React.ReactNode;
    extra?: React.ReactNode;
    path: string;
  }> = [
    {
      key: "out",
      hue: "j-out",
      icon: "out",
      n: counts.toPrepare,
      unit: tt("outUnit", { n: counts.toPrepare }),
      status:
        counts.toPrepare > 0 && counts.oldestHours >= 48 ? (
          <Status tone="w">{tt("outLate", { days: Math.floor(counts.oldestHours / 24) })}</Status>
        ) : (
          <Status tone="g">{counts.toPrepare > 0 ? tt("outFresh") : tt("outNone")}</Status>
        ),
      extra: (
        <>
          <div
            className="bar"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct}
            aria-label={tt("outDone", { n: done })}
          >
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="bar-l">
            <span>{tt.rich("outDoneRich", { n: done, b: (c) => <b>{c}</b> })}</span>
            <span>{pct} %</span>
          </div>
        </>
      ),
      path: "/warehouse/out",
    },
    {
      key: "returns",
      hue: "j-ret",
      icon: "back",
      n: counts.returnsAtCarrier,
      unit: tt("returnsUnit", { n: counts.returnsAtCarrier }),
      status:
        counts.returnsAtCarrier === 0 ? (
          <Status tone="g">{tt("returnsNone")}</Status>
        ) : oldestDays !== null ? (
          <Status tone="b">{tt("returnsOldest", { days: oldestDays })}</Status>
        ) : (
          <Status tone="b">{tt("returnsWaiting")}</Status>
        ),
      extra: <div className="st">{tt("returnsOnWay", { n: counts.returnsOnTheWay })}</div>,
      path: "/warehouse/returns",
    },
    {
      key: "receive",
      hue: "j-rec",
      icon: "dock",
      n: due.length,
      unit: tt("receiveUnit", { n: due.length }),
      status:
        due.length > 0 ? (
          <Status tone="w">{tt("receiveFrom", { suppliers: suppliers.join(", ") || "—" })}</Status>
        ) : (
          <Status tone="g">{tt("receiveNone")}</Status>
        ),
      extra: <div className="st">{tt("receiveToSettle", { n: counts.receptionsOpen })}</div>,
      path: "/warehouse/receive",
    },
    {
      key: "count",
      hue: "j-cnt",
      icon: "count",
      n: counts.neverCounted,
      unit: tt("countUnit", { n: counts.neverCounted }),
      status:
        counts.neverCounted > 0 ? <Status tone="w">{tt("countOff")}</Status> : <Status tone="g">{tt("countAll")}</Status>,
      extra: <div className="st">{tt("countPace")}</div>,
      path: "/warehouse/count",
    },
  ];

  /*
   * « Jamais comptés » is a job card already: repeating it as a decision made
   * the list cry wolf. What stays is what the warehouse cannot settle alone.
   */
  const decisions: Array<{ key: string; hue: Hue; icon: IconName; title: string; hint: string; action: string; to: string }> = [];
  if (counts.setAside > 0)
    decisions.push({
      key: "setAside",
      hue: "h-red",
      icon: "archive",
      title: tt("decSetAside", { n: counts.setAside }),
      hint: tt("decSetAsideHint"),
      action: tt("decSetAsideGo"),
      to: `/${locale}/orders`,
    });
  if (counts.returnsAtCarrier > 0)
    decisions.push({
      key: "returns",
      hue: "h-amber",
      icon: "back",
      title: tt("decReturns", { n: counts.returnsAtCarrier }),
      hint:
        retStats && retStats.queueValue > 0
          ? tt("decReturnsValue", { value: fnum(retStats.queueValue), currency: retStats.currency })
          : tt("decReturnsHint"),
      action: t("see"),
      to: href("/warehouse/returns"),
    });
  if (counts.receptionsOpen > 0)
    decisions.push({
      key: "settle",
      hue: "j-rec",
      icon: "receipt",
      title: tt("decSettle", { n: counts.receptionsOpen }),
      hint: tt("decSettleHint"),
      action: tt("decSettleGo"),
      to: href("/warehouse/receive"),
    });

  const shown = data.focus ? sites.filter((s) => s.id === data.focus) : sites;
  const pickupOf = (id: string) => pickup?.sites?.find((p) => p.warehouseId === id) ?? null;
  // The building in the reader's language, as on every other desk page; the
  // day loop carries only the market's spelling.
  const siteName = (s: { id: string; name: string }) => {
    const p = pickupOf(s.id);
    return (locale === "ar" ? p?.nameAr : p?.nameFr) || s.name;
  };

  return (
    <DeskPage>
      <DeskHeader
        title={tt("title")}
        sub={<LiveSub parts={[marketCode ? t(`market.${marketCode}`) : null, dateLabel]} />}
        acts={<SiteSeg sites={sites.map((s) => ({ id: s.id, name: siteName(s) }))} value={data.focus} onChange={setSite} />}
      />

      <div className="jobs">
        {jobs.map((j, i) => (
          <Link key={j.key} href={href(j.path)} data-job={j.key} className={`job ${j.hue}`} style={{ animationDelay: `${i * 60}ms` }}>
            <div className="job-h">
              <span className="hold">
                <Ic n={j.icon} />
              </span>
              <b>{tt(`job.${j.key}`)}</b>
              <span className="step">{i + 1}/4</span>
            </div>
            <div className="job-n">
              <strong data-testid="job-n">{fnum(j.n)}</strong>
              <span>{j.unit}</span>
            </div>
            {j.status}
            {j.extra}
            <div className="go">
              <span>{tt(`go.${j.key}`)}</span>
              <Ic n="arrowr" className="rtl:-scale-x-100" />
            </div>
          </Link>
        ))}
      </div>

      <div className="two">
        <section className="card dec" aria-labelledby="ent-decide">
          <div className="dec-h">
            <span className="hold h-red" style={{ width: 32, height: 32, borderRadius: 10 }}>
              <Ic n="alert" />
            </span>
            <b id="ent-decide">{tt("decide")}</b>
            <span className="l2" style={{ margin: 0 }}>
              {tt("decideSub")}
            </span>
          </div>
          {decisions.length === 0 ? (
            <div className="di">
              <span className="hold h-green">
                <Ic n="check" />
              </span>
              <div>
                <b>{tt("decideNone")}</b>
              </div>
            </div>
          ) : (
            decisions.map((d) => (
              <div className="di" key={d.key}>
                <span className={`hold ${d.hue}`}>
                  <Ic n={d.icon} />
                </span>
                <div>
                  <b>{d.title}</b>
                  <small dir="auto">{d.hint}</small>
                </div>
                <Link href={d.to} className="btn2 sm">
                  {d.action}
                </Link>
              </div>
            ))
          )}
        </section>

        <div className="blds">
          {shown.map((s) => {
            const idx = sites.findIndex((x) => x.id === s.id);
            const [a5, a7] = AVATAR[(idx < 0 ? 0 : idx) % AVATAR.length];
            const crew = data.team.filter((m) => m.warehouseId === s.id);
            const lead = crew[0] ?? null;
            const last = crew.map((m) => m.lastScanAt).filter(Boolean).sort().pop() ?? null;
            const pk = pickupOf(s.id);
            return (
              <section className="card bld" key={s.id} aria-label={siteName(s)}>
                <div className="bld-h">
                  <span className="av" style={{ "--a5": a5, "--a7": a7 } as React.CSSProperties} aria-hidden="true">
                    {(lead?.name ?? siteName(s)).slice(0, 1)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <b>{siteName(s)}</b>
                    <small dir="auto">
                      {lead ? `${crew.map((m) => m.name).join(", ")} · ` : ""}
                      {last ? tt("lastScan", { time: time(last) }) : tt("noScan")}
                    </small>
                  </div>
                </div>
                <div className="bld-k">
                  <div>
                    <b data-testid="bld-out">{fnum(s.counts.toPrepare)}</b>
                    <small>{tt("bldOut")}</small>
                  </div>
                  <div>
                    <b data-testid="bld-done">{fnum(s.scannedToday)}</b>
                    <small>{tt("bldDone")}</small>
                  </div>
                  <div>
                    <b data-testid="bld-ret">{fnum(s.counts.returnsAtCarrier)}</b>
                    <small>{tt("bldRet")}</small>
                  </div>
                </div>
                {pk ? (
                  pk.disabled && pk.disabledAt ? (
                    <span className="pick ok">
                      <Ic n="truck" />
                      {tt("pickupDone", { time: time(pk.disabledAt) })}
                    </span>
                  ) : (
                    <span className="pick">
                      <Ic n="truck" />
                      {tt("pickupNot")}
                    </span>
                  )
                ) : null}
              </section>
            );
          })}
        </div>
      </div>
    </DeskPage>
  );
}
