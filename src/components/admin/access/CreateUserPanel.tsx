"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Box, Eye, EyeOff, IdCard, MapPin, Plus } from "lucide-react";
import { LY_MARKET_ID, TN_MARKET_ID, marketIdToCode, type MarketCode } from "@/lib/markets";
import { identifierFromUsername } from "@/lib/users/access-view";
import { useWarehouseSites } from "@/hooks/useWarehouseSites";
import type { Role } from "@/types";
import { buttonClass, ROLE_ICON, TONE } from "./parts";
import { CloseButton, FormError, SidePanel } from "./layers";

export interface CreateUserPayload {
  username: string;
  password: string;
  role: string;
  market_id?: string;
  /** The building, for a warehouse agent only. Libya has two, one per Darb account. */
  warehouse_id?: string;
}

const SUPER_ADMIN_CREATABLE: Role[] = ["agent", "warehouse_agent", "market_manager", "investor"];
const MANAGER_CREATABLE: Role[] = ["agent", "warehouse_agent"];
const MARKET_ID: Record<MarketCode, string> = { tn: TN_MARKET_ID, ly: LY_MARKET_ID };

function Step({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <section className="acx-sec acx-step">
      <h3 className="acx-step-h">
        <span aria-hidden="true" className="acx-num">
          {n}
        </span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Create an account in three steps — identity, role, attachment — with the
 * login it will have shown before it exists. Same fields and payload as before;
 * the panel mounts fresh each time it opens, so nothing survives a cancel.
 */
export function CreateUserPanel({
  actorRole,
  actorMarketId,
  takenEmails,
  onClose,
  onCreate,
}: {
  actorRole: Role;
  actorMarketId: string | null;
  takenEmails: Set<string>;
  onClose: () => void;
  onCreate: (payload: CreateUserPayload) => Promise<void>;
}) {
  const t = useTranslations("users");
  const admin = actorRole === "super_admin";
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);
  const [role, setRole] = useState<Role | "">("");
  const [market, setMarket] = useState<MarketCode | "">("");
  const [warehouseId, setWarehouseId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const marketId = admin ? (market ? MARKET_ID[market] : null) : actorMarketId;
  const isWarehouse = role === "warehouse_agent";
  const { sites } = useWarehouseSites(isWarehouse && marketId ? marketId : null);
  const identifier = identifierFromUsername(username);
  const taken = identifier !== "" && takenEmails.has(`${identifier}@oms.local`);
  const ready = identifier !== "" && password !== "" && role !== "" && (!admin || market !== "") && !taken && !busy;
  const ownMarket = marketIdToCode(actorMarketId);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    const payload: CreateUserPayload = { username, password, role };
    if (admin && marketId) payload.market_id = marketId;
    // Only ever sent for a warehouse agent: a building on any other role is a
    // fact nothing in the system honours.
    if (isWarehouse && warehouseId) payload.warehouse_id = warehouseId;
    setBusy(true);
    setError(null);
    try {
      await onCreate(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("error"));
      setBusy(false);
    }
  }

  return (
    <SidePanel labelledBy="access-create-title" onClose={onClose} tone={role ? TONE[role] : "tone-all"}>
      <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
        <div className="acx-ch">
          <div className="min-w-0 flex-1">
            <h2 id="access-create-title">{t("createPanel.title")}</h2>
            <p>{t("createPanel.subtitle")}</p>
          </div>
          <CloseButton label={t("drawer.close")} onClick={onClose} />
        </div>

        <div className="acx-db">
          <Step n={1} title={t("createPanel.identity")}>
            <label htmlFor="access-create-username" className="acx-label">
              {t("createPanel.username")}
            </label>
            <input
              id="access-create-username"
              dir="auto"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t("createPanel.usernamePlaceholder")}
              autoComplete="off"
              autoFocus
              aria-describedby="access-create-identifier"
              className="acx-field"
            />
            <div id="access-create-identifier" role="status">
              {identifier && (
                <div className={`acx-idbox${taken ? " taken" : ""}`}>
                  <span aria-hidden="true" className="acx-idbox-ic">
                    {taken ? <AlertTriangle size={15} /> : <IdCard size={15} />}
                  </span>
                  <span>
                    {t("createPanel.identifier")}{" "}
                    <code>
                      <bdi>{identifier}</bdi>
                    </code>
                    <small>{taken ? t("createPanel.identifierTaken") : t("createPanel.identifierHint")}</small>
                  </span>
                </div>
              )}
            </div>

            <label htmlFor="access-create-password" className="acx-label gap">
              {t("createPanel.password")}
            </label>
            <div className="acx-pw">
              <input id="access-create-password" type={show ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" className="acx-field peek" />
              <button type="button" aria-pressed={show} onClick={() => setShow((s) => !s)} className="acx-peek">
                {show ? <EyeOff size={14} aria-hidden="true" /> : <Eye size={14} aria-hidden="true" />}
                {show ? t("createPanel.hide") : t("createPanel.show")}
              </button>
            </div>
          </Step>

          <fieldset className="acx-sec acx-step">
            <legend className="acx-step-h">
              <span aria-hidden="true" className="acx-num">
                2
              </span>
              {t("createPanel.role")}
            </legend>
            <div className="acx-roleopts">
              {(admin ? SUPER_ADMIN_CREATABLE : MANAGER_CREATABLE).map((r) => {
                const Icon = ROLE_ICON[r];
                return (
                  <label key={r} className={`${TONE[r]} acx-opt`}>
                    <input
                      type="radio"
                      name="access-create-role"
                      value={r}
                      checked={role === r}
                      onChange={() => {
                        setRole(r);
                        // A building belongs to the warehouse role alone.
                        if (r !== "warehouse_agent") setWarehouseId("");
                      }}
                    />
                    <span aria-hidden="true" className="acx-opt-ic">
                      <Icon size={17} />
                    </span>
                    <span className="acx-opt-t">
                      {t(`role.${r}`)}
                      <small>{t(`roleDescription.${r as "agent"}`)}</small>
                    </span>
                    <span aria-hidden="true" className="acx-radio" />
                  </label>
                );
              })}
            </div>
          </fieldset>

          <Step n={3} title={t("createPanel.attach")}>
            {admin ? (
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="acx-label">{t("createPanel.market")}</legend>
                <div className="acx-mktseg">
                  {(["tn", "ly"] as const).map((m) => (
                    <label key={m}>
                      <input
                        type="radio"
                        name="access-create-market"
                        value={m}
                        checked={market === m}
                        onChange={() => {
                          setMarket(m);
                          // Buildings are per market; the old choice cannot survive.
                          setWarehouseId("");
                        }}
                      />
                      {t(`market.${m}`)}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : (
              <p className="acx-fixed">
                <MapPin size={14} aria-hidden="true" />
                {t("createPanel.marketFixed", { market: ownMarket ? t(`market.${ownMarket}`) : "" })}
              </p>
            )}

            {isWarehouse && marketId && (
              <fieldset className="m-0 mt-[14px] min-w-0 border-0 p-0">
                <legend className="acx-label">{t("createPanel.warehouse")}</legend>
                <div className="tone-warehouse acx-sites">
                  {sites.map((s) => (
                    <label key={s.id} className="acx-opt">
                      <input type="radio" name="access-create-site" value={s.id} checked={warehouseId === s.id} onChange={() => setWarehouseId(s.id)} />
                      <span aria-hidden="true" className="acx-opt-ic">
                        <Box size={15} />
                      </span>
                      {s.name}
                    </label>
                  ))}
                </div>
                {warehouseId ? (
                  <p className="acx-hint">{t("warehouse.hint")}</p>
                ) : (
                  <div className="acx-warnline">
                    <AlertTriangle size={14} aria-hidden="true" />
                    {t("warehouse.warn")}
                  </div>
                )}
              </fieldset>
            )}
          </Step>

          <FormError message={error} />
        </div>

        <div className="acx-df acx-cf">
          <button type="button" onClick={onClose} className={buttonClass("neutral")}>
            {t("createPanel.cancel")}
          </button>
          <button type="submit" disabled={!ready} className={buttonClass("primary")}>
            <Plus size={16} aria-hidden="true" />
            {busy ? t("createPanel.creating") : t("createPanel.submit")}
          </button>
        </div>
      </form>
    </SidePanel>
  );
}
