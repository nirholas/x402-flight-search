# x402-flight-search

[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![x402](https://img.shields.io/badge/payments-x402-0052ff.svg)](https://x402.org)
[![USDC on Base + Solana](https://img.shields.io/badge/USDC-Base%20%2B%20Solana-2775ca.svg)](https://x402.org)

Pay-per-query flight search over the **Amadeus Self-Service API** — offers,
confirmed pricing, and fare-drop checks, priced per call for AI agents.

**Pay in USDC on Base or Solana — your client picks the rail.**

## Why x402 for this

Flight data is metered, expensive, and normally gated behind a sales call: an
API key, a contract, a monthly minimum. An agent that wants to check one route
once shouldn't need any of that. x402 makes the price part of the HTTP
conversation — the server quotes half a cent in the 402, the client signs a USDC
transfer and retries, and the 200 body **is** the search result. No account, no
key, no subscription that outlives the question.

It also fixes fare *watching*. A subscription-shaped watcher bills you for
silence; here `/check` is a pay-per-poll snapshot that returns the current fare
and the delta against your last one, so you pay per look and own the loop.

## Quickstart

```bash
git clone https://github.com/nirholas/x402-flight-search
cd x402-flight-search && npm install
cp .env.example .env            # ships with working payTo addresses — edit to get paid yourself
npm run dev                     # service at http://localhost:4022
```

No API keys needed to run it — see [Real backend](#real-backend--api-keys) below.

First 402, no wallet needed:

```bash
curl -s "http://localhost:4022/search?origin=JFK&destination=LAX&date=2026-09-15" \
  | jq '.accepts[] | {network, payTo, maxAmountRequired}'
```

```json
{ "network": "base-sepolia", "payTo": "0x40252CFDF8B20Ed757D61ff157719F33Ec332402", "maxAmountRequired": "5000" }
{ "network": "solana",       "payTo": "WwwuGbqHrwF5RG89KhUbmRWEvjnRH9k5kVM5p7T3WwW", "maxAmountRequired": "5000" }
```

Two rails in one challenge — pay whichever you hold.

Full paid flow (funded Base Sepolia wallet — free USDC at [faucet.circle.com](https://faucet.circle.com)):

```bash
export PRIVATE_KEY=0x…
npm run client
```

## API

| Route | Price | What you get back |
| --- | --- | --- |
| `GET /search` | $0.005 | Flight offers for a route and date — carriers, segments, cabin, total fare |
| `GET /price/:offerId` | $0.003 | Confirmed priced offer, re-priced against the carrier |
| `GET /check` | $0.002 | Cheapest-fare snapshot + delta vs the price you pass in |
| `GET /health` | free | Service status and which data source is live |
| `GET /airports` | free | IATA codes the fixture data covers well |
| `GET /.well-known/x402` | free | Machine-readable price sheet, both rails |
| `GET /skill.md` | free | Agent-facing instructions |

A full "find and confirm" is **$0.008**. Watching a fare is **$0.002 per look**,
and nothing accrues between polls.

Full details: [docs/api.md](docs/api.md).

## How x402 works

1. `GET /search` with no payment → **402** + an `accepts[]` array with **one entry per rail** (price, network, payTo, USDC mint/contract).
2. The client picks a rail and signs for it — an EIP-3009 USDC transfer authorization on Base, or an SPL USDC transfer on Solana.
3. Retry with `X-PAYMENT: <base64 signed payload>`.
4. The server verifies + settles through the facilitator and answers **200** with the flight offers. The settlement receipt — tx hash plus which rail settled it — rides in the `X-PAYMENT-RESPONSE` header.

```
GET /search?…                    402  accepts: [ base-sepolia USDC , solana USDC ]
GET /search?…  X-PAYMENT: …      200  { source, offers: [...] }   +  X-PAYMENT-RESPONSE
```

### Dual-rail configuration

| Rail | Default network | Mainnet switch | payTo env |
| --- | --- | --- | --- |
| EVM (Base) | `base-sepolia` | `NETWORK=base` | `PAY_TO_ADDRESS` |
| Solana | `solana` | already mainnet; `SOLANA_NETWORK=devnet` for testing | `SOLANA_PAY_TO_ADDRESS` |

Both default to the x402 Suite's public receive addresses so the demo runs with
zero setup — set your own to receive funds. A rail with a missing or malformed
address is dropped from `accepts` with a warning; the other keeps working.

## Real backend / API keys

Amadeus is a keyed API, so this service is **env-gated**:

| Env | Effect |
| --- | --- |
| `AMADEUS_CLIENT_ID` + `AMADEUS_CLIENT_SECRET` | Live Amadeus Self-Service API. Responses carry `source: "amadeus"`. |
| *(unset — the default)* | Deterministic fixtures. Responses carry `source: "fixture"`. |
| `AMADEUS_HOST` | `https://test.api.amadeus.com` (free sandbox, default) or `https://api.amadeus.com` |

Free sandbox keys, no card required, at
[developers.amadeus.com](https://developers.amadeus.com).

**Being honest about fixtures:** without keys, the offers are generated — stable
and realistic-looking, deterministic for a given query, and *not real fares*.
Every response and `GET /health` carry the `source` field so a caller is never
guessing. Never quote a fixture price to a user as a real one. The point of the
fallback is that the demo, the tests, and an agent's integration work all run
without anyone needing a paid account.

Live `/price` has one real constraint worth knowing: Amadeus needs the original
offer object to re-price, so live `am-…` offer ids are scoped to the server
process that produced them. Fixture `fx-…` ids encode their own query and never
expire.

## For AI agents

- **[skill.md](skill.md)** — agent-readable instructions for every endpoint, plus budgeting notes.
- **[/.well-known/x402](public/.well-known/x402)** — machine-readable price sheet with both rails and full input/output schemas, indexable by [x402scan.com](https://x402scan.com), the x402 Bazaar, and [agentic.market](https://agentic.market). List your deployment there so agents can find it.
- **[examples/mcp-tool.md](examples/mcp-tool.md)** — expose the service as MCP tools for Claude.
- **[examples/agent-client.ts](examples/agent-client.ts)** — full search → price → fare-check flow with `x402-fetch`.
- **[docs/agents.md](docs/agents.md)** — discovery, both payment rails, and what each artifact contains.

## Docs

Site: **https://nirholas.github.io/x402-flight-search/** —
[tutorial](docs/tutorial.md) · [API reference](docs/api.md) · [for agents](docs/agents.md)

Part of the [x402 Suite](https://github.com/nirholas/x402-suite).

## Support

Questions, bugs, or listing requests: **nichxbt@gmail.com**

## License

[Apache-2.0](LICENSE)
