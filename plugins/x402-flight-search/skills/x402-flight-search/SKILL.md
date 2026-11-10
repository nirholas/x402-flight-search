---
name: x402-flight-search
description: Call the x402-flight-search HTTP service to search flight offers, re-price one offer, and snapshot the cheapest fare with a delta against a previous price. Use when an agent shops flights or runs a fare watch.
---

# x402-flight-search

x402-flight-search is an Express service over the Amadeus API. Each paid route returns its artifact in the 200 body, so an agent shops flights without an account or booking session.

## Run it

No package is published and there is no hosted instance, so run it from a clone: `git clone https://github.com/nirholas/x402-flight-search && cd x402-flight-search`, then `npm install`, `cp .env.example .env`, and `npm run dev` (tsx `src/server.ts`). It listens on `PORT`, default 4022. For production use `npm run build` then `npm start`.

Key env vars: `PORT`, `AMADEUS_CLIENT_ID`, `AMADEUS_CLIENT_SECRET` (without both, the service serves labeled fixture data), `AMADEUS_HOST` (default `https://test.api.amadeus.com`), `PAY_TO_ADDRESS`, `SOLANA_PAY_TO_ADDRESS`, `NETWORK`, `SOLANA_NETWORK`.

## Endpoints

- `GET /search` ($0.005). Query: `origin` and `destination` (3-letter IATA codes, for example `JFK`, `LAX`), `date` (`YYYY-MM-DD`), `adults` (1 to 9, default 1), `max` (1 to 20, default 5). Returns flight offers.
- `GET /price/:offerId` ($0.003). Re-prices one offer from `/search` against the carrier at request time.
- `GET /check` ($0.002). Same query as `/search` plus optional `previousPrice` (number). Returns the current cheapest fare snapshot and the delta against `previousPrice`. Call it repeatedly with the last price to run a fare watch.
- `GET /airports`, `GET /health`, `GET /.well-known/x402`, `GET /skill.md` (free).

Bad input returns 400 with a message such as `origin must be a 3-letter IATA code, e.g. JFK`.

Example: `GET {BASE_URL}/search?origin=JFK&destination=LAX&date=2026-12-15&adults=1&max=5`. The response is Amadeus data when credentials are configured; otherwise it is fixture data and says so, and must not be presented as live fares.

## Paying

Every paid route answers an unpaid request with HTTP 402 and a body whose `accepts` array lists two rails: USDC on Base (`base-sepolia` by default, `base` via `NETWORK`) and USDC on Solana (`solana` by default, `solana-devnet` via `SOLANA_NETWORK`). Pick the entry your wallet can sign, sign the USDC payment (EIP-3009 on Base, SPL `transferChecked` on Solana), and retry with the base64 `X-PAYMENT` header. The artifact is in the 200 body and the settlement receipt is in the `X-PAYMENT-RESPONSE` header. On the EVM rail `x402-fetch` with `viem` does this for you; `npm run client` runs `examples/agent-client.ts`, which reads `BASE_URL` and `PRIVATE_KEY`.

Discovery: `GET /.well-known/x402` lists routes, prices and rails, and `GET /skill.md` serves the repo's own reference. Paying moves real USDC on the configured network, so show the user the route, amount and rail first and wait for a yes before any paid call. Use a throwaway wallet on `base-sepolia` or `solana-devnet` for testing.
