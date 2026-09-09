/**
 * Darb Assabil sandbox — a stand-in for v2.sabil.ly on 127.0.0.1:4545.
 *
 * The warehouse scan-out route binds the pre-printed sticker AT THE CARRIER
 * before committing anything locally, so an end-to-end test of the Libyan
 * bench needs a Darb that (a) knows the test shipments, (b) can be told to
 * refuse, disappear, or stall, and (c) records exactly what was bound so the
 * DB can be checked against it. Real Darb must never see test parcels.
 *
 * Only the endpoints the bench uses are emulated:
 *   GET   /api/local/shipments?reference=SH…&limit=1&offset=0
 *   GET   /api/local/shipments/:_id             — the bind VERIFICATION read
 *   PATCH /api/local/shipments/reference/:_id   { reference }
 *
 * Plus a control surface:
 *   GET  /__sandbox/state          binds, request log, mode, shipments
 *   POST /__sandbox/mode {mode}    ok | refuse | down | slow | silent | reref
 *   POST /__sandbox/reset          reload the manifest, clear binds and log
 *
 * Modes apply to the PATCH only, so a failure can be pinned on the bind step.
 * `slow` waits 20 s and THEN still applies the bind: that is the shape of a
 * real timeout — the OMS gives up at 15 s while Darb completes anyway, and the
 * next scan must rebind idempotently rather than treat the sticker as free.
 *
 * Two modes reproduce what live Darb actually did on 2026-09-08, and both are
 * invisible without the verification read:
 *   `silent` answers `status: true` and does NOT apply the bind — the shipment
 *     keeps its SH… reference. One real parcel (sticker 1633019) shipped this
 *     way, carrying a number the carrier had never heard of.
 *   `reref`  applies the bind, then immediately replaces the reference with a
 *     number of Darb's own, the way their reception re-stickers at booking.
 *     Seven of nineteen parcels that day.
 *
 * Headers are checked the way the vendor's silent failures would punish a
 * regression: wrong or missing Authorization / X-API-VERSION / X-ACCOUNT-ID
 * gets `{status:false}` with HTTP 200, exactly like the real API.
 *
 *   node scripts/darb-sandbox.mjs [--port=4545]
 */
import http from "node:http";
import { SCENARIOS, SANDBOX } from "./wh-test-scenarios.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const PORT = Number(arg("port", SANDBOX.port));
const HOST = SANDBOX.host;
const SLOW_MS = 20_000;
const MODES = new Set(["ok", "refuse", "down", "slow", "silent", "reref"]);

/** A plausible Darb-issued reference, for `reref`. */
let rerefCounter = 11865430;

const state = {
  mode: "ok",
  shipments: new Map(),
  binds: [],
  requests: [],
  startedAt: new Date().toISOString(),
};

function loadShipments() {
  state.shipments.clear();
  for (const s of SCENARIOS) {
    if (!s.sandbox) continue;
    state.shipments.set(s.sandbox._id, {
      _id: s.sandbox._id,
      reference: s.tracking,
      originalReference: s.tracking,
      toBranchGroup: s.sandbox.toBranchGroup,
      status: s.sandbox.status,
      scenario: s.key,
    });
  }
}

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data));
  });
}

function send(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(text);
  return status;
}

/** null when the three vendor headers are right, otherwise what is wrong. */
function headerProblem(req) {
  const h = req.headers;
  const problems = [];
  if (h.authorization !== `apikey ${SANDBOX.apiKey}`) problems.push(`authorization=${JSON.stringify(h.authorization ?? null)}`);
  if (h["x-api-version"] !== "1.0.0") problems.push(`x-api-version=${JSON.stringify(h["x-api-version"] ?? null)}`);
  if (h["x-account-id"] !== SANDBOX.accountId) problems.push(`x-account-id=${JSON.stringify(h["x-account-id"] ?? null)}`);
  return problems.length ? problems.join(" ") : null;
}

function log(entry) {
  state.requests.push(entry);
  if (state.requests.length > 200) state.requests.shift();
  const note = entry.note ? ` · ${entry.note}` : "";
  console.log(`${entry.at.slice(11, 19)} ${entry.method} ${entry.path} → ${entry.status}${note}`);
}

function applyBind(shipment, reference) {
  const from = shipment.reference;
  shipment.reference = reference;
  state.binds.push({ at: new Date().toISOString(), _id: shipment._id, scenario: shipment.scenario, from, to: reference });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const entry = { at: new Date().toISOString(), method: req.method, path: url.pathname + url.search, status: 0, note: "" };
  const rawBody = await readBody(req);
  let body = null;
  try { body = rawBody ? JSON.parse(rawBody) : null; } catch { body = rawBody; }
  entry.body = body;

  // ── control surface ────────────────────────────────────────────────────
  if (url.pathname === "/__sandbox/state") {
    entry.status = send(res, 200, {
      mode: state.mode,
      startedAt: state.startedAt,
      shipments: [...state.shipments.values()],
      binds: state.binds,
      requests: state.requests.slice(-50),
    });
    return;
  }
  if (url.pathname === "/__sandbox/mode" && req.method === "POST") {
    const mode = body?.mode;
    if (!MODES.has(mode)) { entry.status = send(res, 400, { error: `mode must be one of ${[...MODES].join(", ")}` }); log(entry); return; }
    state.mode = mode;
    entry.note = `mode=${mode}`;
    entry.status = send(res, 200, { mode });
    log(entry);
    return;
  }
  if (url.pathname === "/__sandbox/reset" && req.method === "POST") {
    loadShipments();
    state.binds = [];
    state.requests = [];
    state.mode = "ok";
    entry.status = send(res, 200, { ok: true, shipments: state.shipments.size });
    log(entry);
    return;
  }

  // ── vendor surface ─────────────────────────────────────────────────────
  entry.headers = {
    authorization: req.headers.authorization ?? null,
    "x-api-version": req.headers["x-api-version"] ?? null,
    "x-account-id": req.headers["x-account-id"] ?? null,
  };
  const bad = headerProblem(req);
  if (bad) {
    entry.note = `BAD HEADERS ${bad}`;
    entry.status = send(res, 200, { status: false, messages: [{ message: `Sandbox: bad headers: ${bad}` }] });
    log(entry);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/local/shipments") {
    const refs = url.searchParams.getAll("reference");
    // The documented vendor trap: a comma list is a 400, a repeated param is
    // silently wrong. We make BOTH loud so the OMS never learns to rely on it.
    if (refs.length !== 1 || refs[0].includes(",")) {
      entry.note = "multi-value reference";
      entry.status = send(res, 400, { status: false, messages: [{ message: "Invalid choice!" }] });
      log(entry);
      return;
    }
    const hit = [...state.shipments.values()].find((s) => s.reference === refs[0] || s.originalReference === refs[0]);
    entry.note = hit ? `found ${hit._id}` : "not found";
    entry.status = send(res, 200, {
      status: true,
      data: { results: hit ? [{ _id: hit._id, reference: hit.reference, toBranchGroup: hit.toBranchGroup, status: hit.status }] : [], total: hit ? 1 : 0 },
    });
    log(entry);
    return;
  }

  /*
   * The verification read. `GET /shipments/:id` returns a LIST shape even for
   * one shipment (`data.results[0]`) — a documented vendor quirk, reproduced
   * here so a client that unwraps it wrongly fails in the sandbox too.
   */
  const single = url.pathname.match(/^\/api\/local\/shipments\/([^/]+)$/);
  if (req.method === "GET" && single && single[1] !== "reference") {
    const id = decodeURIComponent(single[1]);
    const hit = state.shipments.get(id);
    entry.note = hit ? `read ${id} → ${hit.reference}` : `unknown _id ${id}`;
    entry.status = send(res, 200, {
      status: true,
      data: {
        results: hit
          ? [{ _id: hit._id, reference: hit.reference, toBranchGroup: hit.toBranchGroup, status: hit.status }]
          : [],
      },
    });
    log(entry);
    return;
  }

  const patch = url.pathname.match(/^\/api\/local\/shipments\/reference\/([^/]+)$/);
  if (req.method === "PATCH" && patch) {
    const id = decodeURIComponent(patch[1]);
    const reference = typeof body?.reference === "string" ? body.reference.trim() : "";
    const shipment = state.shipments.get(id);

    if (state.mode === "down") {
      entry.note = "mode=down · socket destroyed";
      entry.status = 0;
      log(entry);
      req.socket.destroy();
      return;
    }
    if (!shipment) {
      entry.note = `unknown _id ${id}`;
      entry.status = send(res, 200, { status: false, messages: [{ message: "Shipment not found" }] });
      log(entry);
      return;
    }
    if (!reference) {
      entry.status = send(res, 200, { status: false, messages: [{ message: "reference is required" }] });
      log(entry);
      return;
    }
    if (state.mode === "refuse") {
      entry.note = `mode=refuse · ${id} ← ${reference} NOT bound`;
      entry.status = send(res, 200, { status: false, messages: [{ message: "Sandbox: reference refused by carrier" }] });
      log(entry);
      return;
    }
    // Says yes, does nothing. Only the verification read can tell.
    if (state.mode === "silent") {
      entry.note = `mode=silent · ${id} still ${shipment.reference}`;
      entry.status = send(res, 200, { status: true, data: { _id: id, reference: shipment.reference } });
      log(entry);
      return;
    }
    // Binds, then their reception overwrites it with a number of their own.
    if (state.mode === "reref") {
      applyBind(shipment, reference);
      const theirs = String(++rerefCounter);
      applyBind(shipment, theirs);
      entry.note = `mode=reref · ${id} ← ${reference} then re-referenced ${theirs}`;
      entry.status = send(res, 200, { status: true, data: { _id: id, reference: theirs } });
      log(entry);
      return;
    }
    if (state.mode === "slow") {
      entry.note = `mode=slow · ${id} ← ${reference} bound after ${SLOW_MS / 1000}s`;
      await new Promise((r) => setTimeout(r, SLOW_MS));
      applyBind(shipment, reference);
      entry.status = send(res, 200, { status: true, data: { _id: id, reference } });
      log(entry);
      return;
    }
    applyBind(shipment, reference);
    entry.note = `${id} ← ${reference}`;
    entry.status = send(res, 200, { status: true, data: { _id: id, reference } });
    log(entry);
    return;
  }

  entry.status = send(res, 404, { status: false, messages: [{ message: `Sandbox: no route ${req.method} ${url.pathname}` }] });
  log(entry);
});

loadShipments();
server.listen(PORT, HOST, () => {
  console.log(`darb-sandbox listening on http://${HOST}:${PORT} · ${state.shipments.size} shipments · mode=${state.mode}`);
});
