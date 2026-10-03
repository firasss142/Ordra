// The edit page's « Par livraison » rail: a WHAT-IF on the values being typed.
//
// The averages (Darb's invoice, units, parcels, confirmations and ads per
// delivery over the last 30 days) are computed on the server and handed over;
// this only subtracts what the author types from what the author types, so the
// rail moves under the cursor without a round trip — the same arithmetic the
// previous edit form ran for its live margin. Nothing here is stored or reported.

export interface PreviewInputs {
  price: number;
  cogs: number;
  packing: number;
  processing: number;
}

/** Server averages per delivery (last 30 days). */
export interface PreviewBasis {
  carrier: number;
  units: number;
  parcels: number;
  confirmed: number;
  ads: number;
}

export function previewDelivery(v: PreviewInputs, b: PreviewBasis) {
  const cogs = v.cogs * b.units;
  const packing = v.packing * b.parcels;
  const processing = v.processing * b.confirmed;
  const before = v.price - b.carrier - cogs - packing - processing;
  const net = before - b.ads;
  const parts: [string, number][] = [
    ["carrier", b.carrier],
    ["cogs", cogs],
    ["packing", packing],
    ["processing", processing],
    ["ads", b.ads],
    ["profit", Math.max(net, 0)],
  ];
  const total = Math.max(v.price, b.carrier + cogs + packing + processing + b.ads + Math.max(net, 0));
  return {
    price: v.price,
    carrier: b.carrier,
    cogs,
    packing,
    processing,
    before,
    ads: b.ads,
    net,
    parcels: b.parcels,
    shares: parts.map(([key, amount]) => ({ key, share: total > 0 ? amount / total : 0 })),
  };
}
