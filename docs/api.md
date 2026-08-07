# API reference

Base URL: your deployment (default `http://localhost:4021`).
Machine-readable versions: [`openapi.json`](https://github.com/nirholas/x402-flight-search/blob/main/openapi.json) ·
[`/.well-known/x402`](https://github.com/nirholas/x402-flight-search/blob/main/public/.well-known/x402)

Paid routes speak x402: an unpaid request returns **402** with an `accepts[]`
array holding **one entry per payment rail**; retry with a signed `X-PAYMENT`
header to get **200**.

**Pay in USDC on Base or Solana — your client picks the rail.**

| Rail | Network | Asset | payTo |
| --- | --- | --- | --- |
| EVM | `base-sepolia` (default) / `base` | USDC `0x036CbD…F7e` (sepolia) | `0x40252CFDF8B20Ed757D61ff157719F33Ec332402` |
| Solana | `solana` (default) / `solana-devnet` | USDC `EPjFWdd5…Dt1v` | `WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW` |

Every 402 body looks like this (amounts are atomic USDC, 6 decimals):

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header required — pay in USDC on Base or Solana, your pick.",
  "accepts": [
    { "scheme": "exact", "network": "base-sepolia", "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/search",
      "description": "Flight offers for a route and date — carriers, segments, cabin, total fare",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "mimeType": "application/json", "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "version": "2" } },
    { "scheme": "exact", "network": "solana", "maxAmountRequired": "5000",
      "resource": "http://localhost:4021/search",
      "description": "Flight offers for a route and date — carriers, segments, cabin, total fare",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "mimeType": "application/json", "maxTimeoutSeconds": 60,
      "extra": { "name": "USDC", "decimals": 6 } }
  ]
}
```

On success, `X-PAYMENT-RESPONSE` is base64 JSON:
`{ "success": true, "rail": "evm" | "solana", "network", "transaction", "payer" }`.

## Data source

Every paid response carries a **`source`** field:

| Value | Meaning |
| --- | --- |
| `"amadeus"` | Live Amadeus Self-Service API — the operator has `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET` set |
| `"fixture"` | Deterministic generated data — no keys configured. Identical queries always return identical results. |

Check it before acting on a price. `GET /health` reports the same thing for free.

---

## GET /search — paid, $0.005

Flight offers for one route and date, cheapest first.

| Param | In | Required | Notes |
| --- | --- | --- | --- |
| `origin` | query | yes | 3-letter IATA, e.g. `JFK` |
| `destination` | query | yes | 3-letter IATA, e.g. `LAX` |
| `date` | query | yes | `YYYY-MM-DD` departure date |
| `adults` | query | no | 1–9, default 1 |
| `max` | query | no | 1–20 offers, default 5 |

```
GET /search?origin=JFK&destination=LAX&date=2026-09-15&max=3
```

**200**

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
        { "from": "JFK", "to": "LAX",
          "departure": "2026-09-15T16:45:00", "arrival": "2026-09-15T21:11:00",
          "carrierCode": "B6", "flightNumber": "B63597", "durationMinutes": 266 }
      ]
    }
  ],
  "retrievedAt": "2026-08-07T02:38:20.402Z"
}
```

Multi-segment itineraries appear as multiple entries in `segments`; connections
are implied by the gap between one segment's `arrival` and the next's `departure`.

**Errors**

| Status | Case |
| --- | --- |
| 400 | `origin`/`destination` not a 3-character IATA code, or `date` not `YYYY-MM-DD` |
| 402 | No/invalid payment — body carries `accepts[]` for both rails |
| 502 | Amadeus upstream error (live mode only) |

---

## GET /price/:offerId — paid, $0.003

Re-prices one offer against the carrier and returns the confirmed fare.

| Param | In | Required | Notes |
| --- | --- | --- | --- |
| `offerId` | path | yes | An `offerId` from `/search` |

**200**

```json
{
  "source": "fixture",
  "offerId": "fx-JFK-LAX-2026-09-15-1-0",
  "confirmed": true,
  "offer": {
    "offerId": "fx-JFK-LAX-2026-09-15-1-0",
    "price": { "total": "120.40", "currency": "USD" },
    "validatingCarrier": "B6",
    "segments": [ { "from": "JFK", "to": "LAX", "flightNumber": "B63597" } ]
  },
  "priceGuarantee": "Fixture mode — deterministic price, stable for identical queries.",
  "pricedAt": "2026-08-07T02:38:20.463Z"
}
```

`priceGuarantee` states in plain language how firm the number is. In live mode it
reads: *"Confirmed by Amadeus Flight Offers Price at pricedAt; fares can still
change until ticketing."*

> **Live offer ids are session-scoped.** Amadeus requires the original offer
> object to re-price, so an `am-…` id only works against the same server process
> that produced it. On 404, re-run `/search` and use the fresh id. Fixture `fx-…`
> ids encode their own query and are stateless forever.

**Errors**

| Status | Case |
| --- | --- |
| 402 | No/invalid payment |
| 404 | Unknown `offerId`, or a live offer that expired with its session |
| 502 | Amadeus upstream error (live mode only) |

---

## GET /check — paid, $0.002

Pay-per-poll fare watching. Returns the current cheapest fare **and** the delta
against a price you supply. No subscription, no server-side watch state — each
call is a complete artifact.

| Param | In | Required | Notes |
| --- | --- | --- | --- |
| `origin`, `destination`, `date` | query | yes | Same as `/search` |
| `adults` | query | no | Default 1 |
| `previousPrice` | query | no | Your last observed price. Omit on the first poll. |

```
GET /check?origin=JFK&destination=LAX&date=2026-09-15&previousPrice=300
```

**200**

```json
{
  "source": "fixture",
  "query": { "origin": "JFK", "destination": "LAX", "date": "2026-09-15", "adults": 1, "max": 5 },
  "snapshot": {
    "lowestTotal": "120.40",
    "currency": "USD",
    "offerId": "fx-JFK-LAX-2026-09-15-1-0",
    "carrier": "B6",
    "retrievedAt": "2026-08-07T02:38:20.465Z"
  },
  "delta": {
    "previousPrice": 300,
    "currentPrice": 120.4,
    "change": -179.6,
    "changePct": -59.87,
    "verdict": "dropped"
  }
}
```

| `verdict` | Meaning |
| --- | --- |
| `dropped` | Cheaper than `previousPrice` |
| `rose` | More expensive than `previousPrice` |
| `unchanged` | Exactly equal |
| `no-cursor` | You did not send `previousPrice`, so there is nothing to compare |

Carry `delta.currentPrice` into your next poll as `previousPrice`.

**Errors**

| Status | Case |
| --- | --- |
| 400 | Bad params, or `previousPrice` is not a number |
| 402 | No/invalid payment |
| 404 | No offers at all for that route/date |

---

## GET /health — free

```json
{ "ok": true, "service": "x402-flight-search", "source": "fixture", "rails": ["base-sepolia", "solana"] }
```

## GET /airports — free

IATA codes the fixture data covers well, so you can try the API without knowing
a route. Any valid 3-letter code works regardless.

## GET /.well-known/x402 — free

The x402 discovery manifest: every paid resource with its price, both networks,
an `accepts[]` preview of the live challenge, and input/output schemas.
Index-ready for x402scan.com, the x402 Bazaar, and agentic.market.

## GET /skill.md — free

The agent-facing instruction file, served from the running host.
