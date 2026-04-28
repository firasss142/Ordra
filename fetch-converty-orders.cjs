const fs = require("fs");
const path = require("path");

const TOKEN = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiI2NmY5ZGE2NjhlMWI2NThiMGUxZmU0NmIiLCJ1c2VyIjoiZmlyYXNoYWRqYW1ldXJAZ21haWwuY29tIiwic3RvcmUiOiI2OTYxNzRkZTEzMDg3YTZhZGZkNjY3YmQiLCJjbGllbnRJZCI6IjY5ZDU0MjJhZjM5MWZkYmViMTc2NTYzMiIsInNjb3BlcyI6WyJyZWFkLWhvb2tzIiwiY3JlYXRlLWhvb2tzIiwiZGVsZXRlLWhvb2tzIiwicmVhZC1vcmRlcnMiLCJjcmVhdGUtb3JkZXJzIiwiZGVsZXRlLW9yZGVycyIsInVwZGF0ZS1vcmRlcnMiLCJyZWFkLXByb2R1Y3RzIiwiY3JlYXRlLXByb2R1Y3RzIiwiZGVsZXRlLXByb2R1Y3RzIiwidXBkYXRlLXByb2R1Y3RzIiwicmVhZC1jYXRlZ29yaWVzIiwiY3JlYXRlLWNhdGVnb3JpZXMiLCJkZWxldGUtY2F0ZWdvcmllcyIsInVwZGF0ZS1jYXRlZ29yaWVzIiwicmVhZC1zdGFmZiIsImNyZWF0ZS1zdGFmZiIsImRlbGV0ZS1zdGFmZiIsInVwZGF0ZS1zdGFmZiIsInJlYWQtY3VzdG9tZXJzIiwiY3JlYXRlLWN1c3RvbWVycyIsImRlbGV0ZS1jdXN0b21lcnMiLCJ1cGRhdGUtY3VzdG9tZXJzIiwicmVhZC1zdG9yZXMiLCJ1cGRhdGUtc3RvcmVzIl0sInR5cGUiOiJhY2Nlc3MiLCJpYXQiOjE3NzcwNTQ2NTgsImV4cCI6MTc3ODM1MDY1OH0.DxRWpS1upi76ruJQOMoDzYG5we1ExDi3-wwC8RRptzg";

const BASE_URL = "https://api.converty.shop/api/v1/orders";
const OUTPUT_PATH = path.join(__dirname, "converty-orders-full.json");
const CHECKPOINT_PATH = path.join(__dirname, "converty-orders-checkpoint.json");

const MAX_RETRIES = 6;
const MIN_LIMIT = 10;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchWithLimit(offset, limit) {
  // Converty paginates by page number, page = Math.floor(offset/limit) + 1
  const page = Math.floor(offset / limit) + 1;
  const url = new URL(BASE_URL);
  url.searchParams.set("includeAllOrders", "true");
  url.searchParams.set("page", String(page));
  url.searchParams.set("limit", String(limit));

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      const response = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${TOKEN}`, Accept: "application/json" },
      });
      if (response.ok) return response.json();
      const details = await response.text();
      const transient = response.status >= 500 || response.status === 429;
      const message = `offset=${offset} limit=${limit} failed (${response.status}): ${details.slice(0, 120)}`;
      if (!transient) throw new Error(message);
      lastError = new Error(message);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
    if (attempt < MAX_RETRIES) {
      const delay = Math.min(30000, 1000 * 2 ** (attempt - 1));
      console.log(`  retry ${attempt}/${MAX_RETRIES - 1} — ${lastError.message.split("\n")[0]} (wait ${delay}ms)`);
      await sleep(delay);
    }
  }
  throw lastError;
}

// Fetch a chunk starting at `offset` using an adaptive limit (halves on persistent 5xx)
async function fetchChunk(offset, limit) {
  try {
    const payload = await fetchWithLimit(offset, limit);
    const rows = Array.isArray(payload.data) ? payload.data : [];
    const count = payload.count !== undefined ? Number(payload.count) : null;
    return { rows, count, limit };
  } catch (err) {
    if (limit <= MIN_LIMIT) throw err;
    const half = Math.max(MIN_LIMIT, Math.floor(limit / 2));
    console.log(`  halving limit ${limit} → ${half} for offset ${offset}`);
    // Fetch two sub-chunks to cover the same range as the failed chunk
    const a = await fetchChunk(offset, half);
    const b = await fetchChunk(offset + a.rows.length, half);
    return {
      rows: [...a.rows, ...b.rows],
      count: a.count ?? b.count,
      limit,
    };
  }
}

function loadCheckpoint() {
  if (!fs.existsSync(CHECKPOINT_PATH)) return { orders: [], offset: 0, apiCount: null };
  try {
    const raw = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8"));
    console.log(`Resuming from checkpoint: ${raw.orders.length} orders already fetched (offset ${raw.offset})`);
    return raw;
  } catch {
    return { orders: [], offset: 0, apiCount: null };
  }
}

function saveCheckpoint(orders, offset, apiCount) {
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify({ orders, offset, apiCount }, null, 0), "utf8");
}

async function main() {
  const checkpoint = loadCheckpoint();
  const allOrders = checkpoint.orders;
  let offset = checkpoint.offset;
  let apiCount = checkpoint.apiCount;
  let limit = 100;

  while (true) {
    const { rows, count, limit: usedLimit } = await fetchChunk(offset, limit);
    limit = usedLimit; // track adaptive limit

    if (apiCount === null && count !== null) apiCount = count;

    allOrders.push(...rows);
    offset += rows.length;
    console.log(`fetched ${rows.length} orders (total so far: ${allOrders.length}${apiCount ? "/" + apiCount : ""})`);

    saveCheckpoint(allOrders, offset, apiCount);

    if (rows.length === 0 || rows.length < limit) break;
  }

  const distinctIds = new Set(
    allOrders.map((o) => o?._id).filter((v) => typeof v === "string" && v.length > 0)
  ).size;
  const testOrders = allOrders.filter((o) => o?.isTest === true).length;

  const output = {
    fetchedAt: new Date().toISOString(),
    apiCount,
    fetchedRows: allOrders.length,
    distinctIds,
    testOrders,
    data: allOrders,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2), "utf8");
  // Clean up checkpoint on success
  if (fs.existsSync(CHECKPOINT_PATH)) fs.unlinkSync(CHECKPOINT_PATH);

  console.log("");
  console.log(`Saved to: ${OUTPUT_PATH}`);
  console.log(`API count: ${apiCount ?? "unknown"}`);
  console.log(`Fetched rows: ${allOrders.length}`);
  console.log(`Distinct _id values: ${distinctIds}`);
  console.log(`Orders with isTest=true: ${testOrders}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
