# Raw x402 flow with curl

Exactly what happens on the wire: 402 → pay → 200.

## 1. Free routes first

```bash
curl -s http://localhost:4022/health | jq
curl -s http://localhost:4022/airports | jq '.airports[].code'
```

`health.source` tells you whether this deployment is on live Amadeus data or
deterministic fixtures.

## 2. Hit a paid route without payment → HTTP 402

```bash
curl -si "http://localhost:4022/search?origin=JFK&destination=LAX&date=2026-09-15" | head -40
```

You get `402 Payment Required` and a JSON body with **one payment-requirements
object per rail** — Base and Solana:

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header required — pay in USDC on Base or Solana, your pick.",
  "accepts": [
    {
      "scheme": "exact",
      "network": "base-sepolia",
      "maxAmountRequired": "5000",
      "resource": "http://localhost:4022/search",
      "description": "Flight offers for a route and date — carriers, segments, cabin, total fare",
      "mimeType": "application/json",
      "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402",
      "maxTimeoutSeconds": 60,
      "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      "extra": { "name": "USDC", "version": "2" }
    },
    {
      "scheme": "exact",
      "network": "solana",
      "maxAmountRequired": "5000",
      "resource": "http://localhost:4022/search",
      "description": "Flight offers for a route and date — carriers, segments, cabin, total fare",
      "mimeType": "application/json",
      "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW",
      "maxTimeoutSeconds": 60,
      "asset": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
      "extra": { "name": "USDC", "decimals": 6 }
    }
  ]
}
```

`maxAmountRequired` is atomic USDC (6 decimals): `5000` = $0.005 — the same price
on either rail. Filter to the rail you can pay:

```bash
curl -s "http://localhost:4022/search?origin=JFK&destination=LAX&date=2026-09-15" \
  | jq '.accepts[] | select(.network | startswith("solana"))'
```

## 3. Pay

The `X-PAYMENT` header is base64 JSON wrapping a signature for the rail you
picked — an EIP-3009 USDC transfer authorization on Base, or a signed SPL USDC
transfer on Solana. Neither is practical to produce with curl alone, so use the
bundled client, which does the 402 → sign → retry loop for you (EVM rail):

```bash
export PRIVATE_KEY=0x…   # funded Base Sepolia wallet (https://faucet.circle.com)
npm run client
```

Under the hood it re-sends the same request as:

```bash
curl -s "http://localhost:4022/search?origin=JFK&destination=LAX&date=2026-09-15" \
  -H "X-PAYMENT: <base64 signed payment payload>"
```

The envelope it base64-encodes looks like this — swap `network` and the payload
shape to settle on Solana instead:

```json
{ "x402Version": 1, "scheme": "exact", "network": "base-sepolia",
  "payload": { "signature": "0x…", "authorization": { "from": "0x…", "to": "0x40252C…", "value": "5000", "…": "…" } } }
```

```json
{ "x402Version": 1, "scheme": "exact", "network": "solana",
  "payload": { "transaction": "<base64 signed SPL transfer>" } }
```

The server reads `network`, matches it to the rail you were quoted, then verifies
and settles through the facilitator.

## 4. HTTP 200 with the artifact and settlement receipt

The 200 body is the flight offers themselves — the thing you paid for, delivered
in the response. The `X-PAYMENT-RESPONSE` header is the base64 settlement receipt:

```bash
curl -si … | grep -i x-payment-response | cut -d' ' -f2 | base64 -d | jq
```

```json
{ "success": true, "rail": "solana", "network": "solana",
  "transaction": "5v8…", "payer": "9xQ…" }
```

`rail` tells you which chain settled it.

## 5. Confirm a price ($0.003)

Take an `offerId` from the search result:

```bash
curl -s "http://localhost:4022/price/fx-JFK-LAX-2026-09-15-1-0" \
  -H "X-PAYMENT: <base64 payload>" | jq '{offerId, confirmed, total: .offer.price.total, priceGuarantee}'
```

Live `am-…` ids are session-scoped (Amadeus needs the original offer object to
re-price). If you get a 404, re-run `/search` for a fresh id. Fixture `fx-…` ids
encode their own query and never expire.

## 6. Watch a fare, pay per look ($0.002)

```bash
curl -s "http://localhost:4022/check?origin=JFK&destination=LAX&date=2026-09-15&previousPrice=300" \
  -H "X-PAYMENT: <base64 payload>" | jq '{lowest: .snapshot.lowestTotal, delta}'
```

```json
{
  "lowest": "120.40",
  "delta": { "previousPrice": 300, "currentPrice": 120.4, "change": -179.6, "changePct": -59.87, "verdict": "dropped" }
}
```

Carry `delta.currentPrice` into the next poll as `previousPrice`. There is no
subscription and no server-side watch state — you own the loop and pay per look.
