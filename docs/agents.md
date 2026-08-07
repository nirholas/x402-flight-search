# For AI agents

How an autonomous agent discovers this service, pays, and what it gets back.

## Discovery

Three artifacts are published for machines:

1. **[`skill.md`](https://github.com/nirholas/x402-flight-search/blob/main/skill.md)**
   (repo root, also served at `{BASE_URL}/skill.md`) — plain-language
   instructions an LLM can read directly: endpoints, prices, params, response
   schemas, error codes, and budgeting notes.
2. **`{BASE_URL}/.well-known/x402`** — the machine-readable price sheet
   (`x402Version`, `resources[]` with price/networks/asset/input+outputSchema).
   Each resource carries an `accepts[]` array listing **both rails**, so a
   budgeting agent knows before it spends whether it can pay from its Base
   balance, its Solana balance, or either. Registries like
   [x402scan.com](https://x402scan.com), the **x402 Bazaar**, and
   [agentic.market](https://agentic.market) index this format — submit your
   deployment URL there so agents find you without prior knowledge.
3. **`openapi.json`** (OpenAPI 3.1, including the 402 response schema) for
   codegen-style clients.

## Paying — two rails, your pick

Every paid route answers an unpaid request with a 402 whose `accepts[]` array
holds one payment-requirements object per rail:

| Rail | Network | Asset | payTo |
| --- | --- | --- | --- |
| EVM | `base-sepolia` (or `base`) | USDC | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana` (or `solana-devnet`) | USDC | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

Match on `network`, sign for that chain, and retry with `X-PAYMENT`. The price,
the route, and the returned artifact are identical either way.

### EVM with `x402-fetch`

```ts
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const payFetch = wrapFetchWithPayment(fetch, privateKeyToAccount(process.env.PRIVATE_KEY), 50_000n);
const res = await payFetch("https://flights.example.com/search?origin=JFK&destination=LAX&date=2026-09-15");
const { source, offers } = await res.json();   // offers delivered now, not queued
```

The wrapper handles 402 → sign EIP-3009 USDC authorization → retry. The third
argument caps spend in atomic units: `50_000n` refuses anything over $0.05.

### Solana

```ts
const res = await fetch(url);                        // 402
const { accepts } = await res.json();
const sol = accepts.find(a => a.network.startsWith("solana"));

// Build an SPL USDC transfer of `sol.maxAmountRequired` (atomic, 6 decimals)
// to `sol.payTo` for the mint in `sol.asset`, sign it, and wrap it:
const header = Buffer.from(JSON.stringify({
  x402Version: 1, scheme: "exact", network: sol.network,
  payload: { transaction: signedTxBase64 },
})).toString("base64");

const paid = await fetch(url, { headers: { "X-PAYMENT": header } });
const artifact = await paid.json();
```

If `extra.feePayer` is present on the Solana accept, that sponsor account pays
the SOL network fee — the caller needs only USDC.

## What you get back

- **`/search`** — the offers themselves: `offerId`, price, validating carrier,
  seats remaining, cabin, and every segment with times and flight numbers.
  Sorted cheapest first.
- **`/price/:offerId`** — a confirmed fare with a `priceGuarantee` string
  spelling out how firm it is.
- **`/check`** — a snapshot *and* a computed delta, so one paid call answers
  "what is it now, and did it move?" without you storing anything.
- The USDC settlement receipt is in the `X-PAYMENT-RESPONSE` response header —
  base64 JSON with `rail` (`evm` | `solana`), `network`, `transaction`, and
  `payer`. Decode with `decodeXPaymentResponse` from `x402-fetch`, or
  `JSON.parse(atob(header))`.

Nothing here is a job you come back for. Every paid response contains the thing
you bought.

## Always read `source`

Every paid response carries `source: "amadeus" | "fixture"`. `"fixture"` means
the operator has no Amadeus keys configured and the numbers are deterministic
synthetic data. They are stable and useful for building against — and wrong as
real fares. If you surface prices to a user, surface the source with them.
`GET /health` answers the same question for free before you spend anything.

## Budgeting

- Find-and-confirm: `$0.005` + `$0.003` = **$0.008** per candidate itinerary.
- Fare watching: **$0.002** per look, nothing between looks. Bound your poll
  loop in the agent — the per-call cap won't stop a tight loop.
- Read `maxAmountRequired` from the 402 rather than hardcoding prices, so an
  operator's repricing never surprises you.

## MCP integration

To give Claude these abilities as tools (`search_flights`, `price_offer`,
`check_fare`, plus a free `service_info`), see
[`examples/mcp-tool.md`](https://github.com/nirholas/x402-flight-search/blob/main/examples/mcp-tool.md) —
a complete MCP server plus the `claude_desktop_config.json` entry.

## Operator checklist for agent traffic

- Keep `/.well-known/x402` accurate — agents budget from it before paying, and it
  must list both rails if you accept both.
- Keep both `PAY_TO_ADDRESS` and `SOLANA_PAY_TO_ADDRESS` set unless you mean to
  turn a rail off; dropping one halves the wallets that can pay you.
- Set `PUBLIC_BASE_URL` in production so the `resource` in your 402 matches your
  real URL.
- If you run on live Amadeus, price your routes above your per-call cost.
- List the deployment on x402scan.com / the x402 Bazaar / agentic.market.

Questions or listing help: **nichxbt@gmail.com**
