# Tutorial: from clone to your first paid flight query

Install → env → run → first 402 → paid call → reading the artifact → mainnet.

## 1. Install

```bash
git clone https://github.com/nirholas/x402-flight-search
cd x402-flight-search
npm install
```

Requires Node 18+.

## 2. Configure

```bash
cp .env.example .env
```

`.env.example` ships with working defaults for **both payment rails**, so the
service runs immediately. Change these two to receive funds yourself:

```
# EVM (Base / Base Sepolia) USDC receive address
PAY_TO_ADDRESS=0x40252CFDF8B20Ed757D61ff157719F33Ec332402
# Solana USDC receive address
SOLANA_PAY_TO_ADDRESS=WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW
```

Every paid route offers both rails and the caller picks. If you only want one,
delete the other address — that rail is dropped from the 402 challenge with a
warning, and the remaining rail keeps working.

### Live flight data (optional)

Amadeus is a keyed API, so it is env-gated. Without keys the server returns
deterministic fixtures and the demo still works end to end:

```
AMADEUS_CLIENT_ID=
AMADEUS_CLIENT_SECRET=
```

Free sandbox keys, no card required: create an app at
[developers.amadeus.com](https://developers.amadeus.com) and copy the key and
secret. With both set, `/search`, `/price` and `/check` hit the real API.

**Every response carries a `source` field** (`"amadeus"` or `"fixture"`) so a
caller always knows which it got. Do not quote a fixture fare as a real price.

## 3. Run the server

```bash
npm run dev
```

The startup banner shows both rails, the active data source, and every paid
route with its price:

```
  Payment rails (USDC — the client picks):
    evm    base-sepolia   USDC → 0x40252CFDF8B20Ed757D61ff157719F33Ec332402  via https://x402.org/facilitator
    solana solana         USDC → WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW  via https://x402.org/facilitator

  Data source: fixtures (deterministic) — set AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET for live data

  Paid routes (x402, USDC on Base or Solana):
    GET /search              $0.005  flight offers
    GET /price/:offerId      $0.003  confirmed priced offer
    GET /check               $0.002  fare snapshot + delta
```

## 4. Your first 402

```bash
curl -s "http://localhost:4021/search?origin=JFK&destination=LAX&date=2026-09-15" \
  | jq '.accepts[] | {network, asset, payTo, maxAmountRequired}'
```

```json
{
  "network": "base-sepolia",
  "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
  "maxAmountRequired": "5000"
}
{
  "network": "solana",
  "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
  "maxAmountRequired": "5000"
}
```

`HTTP/1.1 402 Payment Required` with an `accepts[]` array holding **one entry per
rail** — price in atomic USDC (6 decimals, so `5000` = $0.005), the network, the
`payTo` address, and the USDC contract or mint. The client chooses which rail to
settle on.

## 5. A paid call

### Base (EVM)

You need a wallet with Base Sepolia USDC (free from the
[Circle faucet](https://faucet.circle.com)). Base Sepolia ETH is **not** needed —
x402 uses gasless EIP-3009 transfers.

```bash
export PRIVATE_KEY=0xYourTestKey
npm run client
```

`examples/agent-client.ts` inspects the 402, searches ($0.005), confirms the
cheapest offer's price ($0.003), runs one fare check ($0.002), and prints the
decoded `X-PAYMENT-RESPONSE` settlement receipt. Total: one cent.

### Solana

Pick the `solana` entry from `accepts[]` instead, sign an SPL USDC transfer to
its `payTo`, and send the same base64 `X-PAYMENT` envelope. Any Solana-capable
x402 client does this. Both rails end at the same 200 and the same artifact —
only `X-PAYMENT-RESPONSE` differs, naming the rail that settled.

## 6. Reading the artifacts

`/search` gives you offers, cheapest first:

```json
{
  "source": "fixture",
  "currency": "USD",
  "offers": [
    { "offerId": "fx-JFK-LAX-2026-09-15-1-0",
      "price": { "total": "120.40", "currency": "USD" },
      "validatingCarrier": "B6", "seatsRemaining": 2, "cabin": "ECONOMY",
      "segments": [{ "from": "JFK", "to": "LAX", "flightNumber": "B63597", "durationMinutes": 266 }] }
  ],
  "retrievedAt": "2026-08-07T02:38:20.402Z"
}
```

`/price/:offerId` re-prices one offer against the carrier and returns
`confirmed: true` with a `priceGuarantee` string describing exactly how firm the
number is.

> **Live offer ids are session-scoped.** Amadeus needs the original offer object
> to re-price, so an `am-…` id only works against the server process that
> produced it — re-run `/search` if you get a 404. Fixture `fx-…` ids encode
> their own query and never expire.

`/check` is the pay-per-poll fare watch. Each call returns the current cheapest
fare **and** the delta against a price you supply:

```json
{
  "snapshot": { "lowestTotal": "120.40", "currency": "USD", "carrier": "B6" },
  "delta": { "previousPrice": 300, "currentPrice": 120.4,
             "change": -179.6, "changePct": -59.87, "verdict": "dropped" }
}
```

Carry `delta.currentPrice` into your next poll as `previousPrice`. There is no
subscription and no server-side watch state — you own the loop and pay per look,
which is the whole point: a paid call always hands you the artifact, never a
promise to notify you later.

## 7. Going to mainnet

```
NETWORK=base                     # EVM rail: base-sepolia -> base mainnet
SOLANA_NETWORK=mainnet-beta      # Solana rail (already the default)
FACILITATOR_URL=https://your-mainnet-facilitator.example
PUBLIC_BASE_URL=https://flights.example.com
AMADEUS_HOST=https://api.amadeus.com
```

- Use a facilitator that settles on Base mainnet (e.g. Coinbase CDP's x402
  facilitator). Point `SOLANA_FACILITATOR_URL` at a Solana-capable facilitator if
  it differs.
- `PAY_TO_ADDRESS` and `SOLANA_PAY_TO_ADDRESS` now receive real USDC.
- `PUBLIC_BASE_URL` makes the `resource` field in your 402 quotes match your
  public URL — agents and facilitators check it.
- Swap `AMADEUS_HOST` to the production host once you have production Amadeus
  credentials; the free sandbox host serves cached, non-live inventory.
- Price your routes above your Amadeus cost per call. The defaults assume the
  free tier.

## Where to next

- [API reference](api.md)
- [For AI agents](agents.md) — discovery, MCP, listings
- [examples/curl.md](https://github.com/nirholas/x402-flight-search/blob/main/examples/curl.md) — the raw wire flow
