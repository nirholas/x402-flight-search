/**
 * Agent client example: search flights, confirm a price, and run a fare-watch
 * poll — paying per query with x402.
 *
 * This service is dual-rail: every 402 quotes USDC on **Base** and on **Solana**,
 * and the client picks. `x402-fetch` settles the EVM rail, which is what this
 * example uses; the commented section at the bottom shows the Solana form, and
 * examples/curl.md has the raw wire format for both.
 *
 * Usage:
 *   export PRIVATE_KEY=0x…                  # testnet wallet with Base Sepolia USDC
 *   export BASE_URL=http://localhost:4021   # optional
 *   npm run client
 *
 * Free testnet USDC on Base Sepolia: https://faucet.circle.com
 */
import { wrapFetchWithPayment, decodeXPaymentResponse } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4021";
const pk = process.env.PRIVATE_KEY;
if (!pk) {
  console.error(
    "Set PRIVATE_KEY to a funded Base Sepolia wallet key (free USDC: https://faucet.circle.com)",
  );
  process.exit(1);
}

const account = privateKeyToAccount(pk as `0x${string}`);
// Third argument caps spend at 100000 atomic USDC units = $0.10 per call.
const payFetch = wrapFetchWithPayment(fetch, account, 100_000n);

// 1. Free: which data source is this deployment on?
const health = await (await fetch(`${BASE_URL}/health`)).json();
console.log(`Service: ${health.service}  data source: ${health.source}  rails: ${health.rails}`);
if (health.source === "fixture") {
  console.log("(fixtures — set AMADEUS_CLIENT_ID/SECRET on the server for live fares)");
}

// 2. Free: inspect the unpaid 402 to see both rails and the exact price.
const route = "origin=JFK&destination=LAX&date=2026-09-15&max=3";
const quote = await (await fetch(`${BASE_URL}/search?${route}`)).json();
console.log("\n402 quote — accepted rails:");
for (const a of quote.accepts ?? []) {
  console.log(
    `  ${String(a.network).padEnd(14)} ${String(a.maxAmountRequired).padStart(8)} atomic USDC → ${a.payTo}`,
  );
}

// 3. Paid ($0.005): search.
console.log("\nSearching JFK → LAX …");
const searchRes = await payFetch(`${BASE_URL}/search?${route}`);
if (!searchRes.ok) {
  console.error(`Search failed: ${searchRes.status}`, await searchRes.text());
  process.exit(1);
}
const search = await searchRes.json();
console.log(`Source: ${search.source}  offers: ${search.offers.length}`);
for (const o of search.offers) {
  const seg = o.segments[0];
  console.log(
    `  ${o.offerId.padEnd(30)} ${(o.price.total + " " + o.price.currency).padStart(11)}  ` +
      `${o.validatingCarrier} ${seg.flightNumber}  ${o.segments.length} segment(s)`,
  );
}

const receipt = searchRes.headers.get("x-payment-response");
if (receipt) {
  console.log("\nX-PAYMENT-RESPONSE (settlement receipt):");
  console.log(JSON.stringify(decodeXPaymentResponse(receipt), null, 2));
}

// 4. Paid ($0.003): confirm the price of the cheapest offer.
const cheapest = search.offers[0];
console.log(`\nConfirming price for ${cheapest.offerId} …`);
const priced = await (await payFetch(`${BASE_URL}/price/${cheapest.offerId}`)).json();
console.log(`Confirmed ${priced.offer.price.total} ${priced.offer.price.currency}`);
console.log(`  ${priced.priceGuarantee}`);

// 5. Paid ($0.002): one fare-watch poll, using the price we just saw as the cursor.
//    Repeat this call on your own schedule — each poll is a fresh snapshot plus
//    the delta. Nothing accrues on the server between calls.
console.log("\nFare check against our last observed price …");
const check = await (
  await payFetch(`${BASE_URL}/check?${route}&previousPrice=${cheapest.price.total}`)
).json();
console.log(
  `  now ${check.snapshot.lowestTotal} ${check.snapshot.currency} on ${check.snapshot.carrier} — ` +
    `${check.delta.verdict}` +
    (check.delta.change === null ? "" : ` (${check.delta.change >= 0 ? "+" : ""}${check.delta.change}, ${check.delta.changePct}%)`),
);

console.log("\nTotal spent this run: $0.010 (search $0.005 + price $0.003 + check $0.002)");

// ————— Paying on the Solana rail instead —————
//
// Same routes, same prices, same artifacts — only the signature differs. Pick
// the Solana entry out of `accepts`, sign an SPL USDC transfer for it, and send
// the envelope in X-PAYMENT:
//
//   const unpaid = await fetch(`${BASE_URL}/search?${route}`);
//   const { accepts } = await unpaid.json();
//   const sol = accepts.find((a) => String(a.network).startsWith("solana"));
//   //   sol.asset             → the USDC SPL mint
//   //   sol.payTo             → the operator's Solana address
//   //   sol.maxAmountRequired → atomic USDC (6 decimals), e.g. "5000" = $0.005
//   //   sol.extra?.feePayer   → sponsor paying the SOL network fee, if offered
//
//   // Build + sign the SPL transfer with your Solana wallet or @solana/kit,
//   // then base64-wrap it:
//   const header = Buffer.from(JSON.stringify({
//     x402Version: 1,
//     scheme: "exact",
//     network: sol.network,
//     payload: { transaction: signedTxBase64 },
//   })).toString("base64");
//
//   const res = await fetch(`${BASE_URL}/search?${route}`, { headers: { "X-PAYMENT": header } });
//   const offers = await res.json();   // identical shape to the EVM path
