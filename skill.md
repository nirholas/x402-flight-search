# x402-flight-search — agent skill

Pay-per-query flight search. Ask for offers on a route and date, re-price a
specific offer against the carrier, or poll a fare and get the change since your
last look — each as a single paid HTTP call with the answer in the response
body. No account, no API key, no booking funnel: you pay fractions of a cent in
USDC per query over the x402 protocol.

Data comes from the **Amadeus Self-Service API** when the operator has keys set,
and from deterministic fixtures otherwise. **Every response carries a `source`
field (`"amadeus"` or `"fixture"`)** — always read it before trusting a price.

**Base URL**: `{BASE_URL}` (e.g. `http://localhost:4022` when self-hosted)

Machine-readable price sheet: `{BASE_URL}/.well-known/x402`

## Endpoints

### GET /search — $0.005
Flight offers for one route and date.

| Param | Required | Notes |
| --- | --- | --- |
| `origin` | yes | 3-letter IATA, e.g. `JFK` |
| `destination` | yes | 3-letter IATA, e.g. `LAX` |
| `date` | yes | `YYYY-MM-DD` departure date |
| `adults` | no | 1–9, default 1 |
| `max` | no | 1–20 offers, default 5 |

```
GET /search?origin=JFK&destination=LAX&date=2026-09-15&max=3
```

```json
{
  "source": "fixture",
  "query": { "origin": "JFK", "destination": "LAX", "date": "2026-09-15", "adults": 1, "max": 3 },
  "currency": "USD",
  "offers": [
    {
      "offerId": "fx-JFK-LAX-2026-09-15-1-0",
      "source": "fixture",
      "price": { "total": "120.40", "currency": "USD" },
      "validatingCarrier": "B6",
      "seatsRemaining": 2,
      "cabin": "ECONOMY",
      "segments": [
        { "from": "JFK", "to": "LAX", "departure": "2026-09-15T16:45:00",
          "arrival": "2026-09-15T21:11:00", "carrierCode": "B6",
          "flightNumber": "B63597", "durationMinutes": 266 }
      ]
    }
  ],
  "retrievedAt": "2026-08-07T02:38:20.402Z"
}
```

Offers are sorted cheapest first. Keep `offerId` if you want to re-price it.

### GET /price/:offerId — $0.003
Re-prices one offer against the carrier and returns the confirmed fare.

```
GET /price/fx-JFK-LAX-2026-09-15-1-0
```

```json
{
  "source": "fixture",
  "offerId": "fx-JFK-LAX-2026-09-15-1-0",
  "confirmed": true,
  "offer": { "offerId": "…", "price": { "total": "120.40", "currency": "USD" }, "segments": [] },
  "priceGuarantee": "Fixture mode — deterministic price, stable for identical queries.",
  "pricedAt": "2026-08-07T02:38:20.463Z"
}
```

**Live (`am-…`) offer ids are session-scoped**: Amadeus requires the original
offer object to re-price, so an `am-` id only works against the same server
process that produced it. If you get a 404, run `/search` again and use the fresh
id. Fixture (`fx-…`) ids encode their own query and are stateless forever.

### GET /check — $0.002
Pay-per-poll fare watching. Returns the current cheapest fare **and** the delta
against a price you supply — so you own the watch loop and pay only per look.
There is no subscription and no server-side state.

| Param | Required | Notes |
| --- | --- | --- |
| `origin`, `destination`, `date` | yes | Same as `/search` |
| `adults` | no | Default 1 |
| `previousPrice` | no | Your last observed price. Omit on the first poll. |

```
GET /check?origin=JFK&destination=LAX&date=2026-09-15&previousPrice=300
```

```json
{
  "source": "fixture",
  "query": { "origin": "JFK", "destination": "LAX", "date": "2026-09-15", "adults": 1, "max": 5 },
  "snapshot": {
    "lowestTotal": "120.40", "currency": "USD",
    "offerId": "fx-JFK-LAX-2026-09-15-1-0", "carrier": "B6",
    "retrievedAt": "2026-08-07T02:38:20.465Z"
  },
  "delta": {
    "previousPrice": 300, "currentPrice": 120.4,
    "change": -179.6, "changePct": -59.87, "verdict": "dropped"
  }
}
```

`verdict` is `dropped` | `rose` | `unchanged` | `no-cursor` (no `previousPrice`
was given). Carry `delta.currentPrice` into your next poll as `previousPrice`.

### GET /health, GET /airports — free
`/health` reports whether the server is on live Amadeus data or fixtures.
`/airports` lists IATA codes the fixture data covers well.

## Payment

**Pay in USDC on Base or Solana — your client picks the rail.**

- Protocol: **x402** (HTTP 402 → signed USDC authorization → retry with `X-PAYMENT`)
- Asset: **USDC** on both rails
- Facilitators are rail-specific: `https://x402.org/facilitator` settles the EVM
  rail (override: `FACILITATOR_URL`), `https://facilitator.payai.network` settles
  the Solana rail (override: `SOLANA_FACILITATOR_URL`)

| Rail | Network | payTo |
| --- | --- | --- |
| EVM | `base-sepolia` (default) or `base` via `NETWORK=base` | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana` (default) or `solana-devnet` via `SOLANA_NETWORK=devnet` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

The first unpaid request returns `402` with an `accepts[]` array holding **one
entry per rail**. Pick either, sign for that network, and retry with
`X-PAYMENT: <base64 payload>`:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header required — pay in USDC on Base or Solana, your pick.",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "5000",
      "resource": "http://localhost:4022/search", "mimeType": "application/json" },
    { "scheme": "exact", "network": "solana", "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "5000",
      "resource": "http://localhost:4022/search", "mimeType": "application/json" }
  ]
}
```

`maxAmountRequired` is atomic USDC (6 decimals): `5000` = $0.005. The settlement
receipt — including which rail settled it — arrives in the `X-PAYMENT-RESPONSE`
response header.

## Errors

| Status | Meaning |
| --- | --- |
| 400 | Bad params — IATA code not 3 letters, date not `YYYY-MM-DD`, `previousPrice` not numeric |
| 402 | Payment required or payment invalid — body carries `accepts[]` for both rails |
| 404 | Unknown `offerId`, or no offers for that route/date |
| 502 | Amadeus upstream error (only possible in live mode) |

## Budgeting notes for agents

- A full "find and confirm" costs $0.008: one `/search` + one `/price/:offerId`.
- Watching a fare costs $0.002 per look; nothing accrues between polls.
- Prices are quoted per request in the 402 — read `maxAmountRequired` rather than
  hardcoding, so an operator's repricing never surprises you.

Discovery: this file (`skill.md`, also served at `{BASE_URL}/skill.md`) +
[`/.well-known/x402`]({BASE_URL}/.well-known/x402) + `openapi.json`.

Contact: nichxbt@gmail.com
