# Exposing x402-flight-search as an MCP tool for Claude

Any MCP server can wrap this service so Claude (or another MCP client) can shop
flights with a funded wallet. The pattern: one tool per route, `x402-fetch` for
payment, the artifact returned as the tool result.

The service is dual-rail — every 402 quotes USDC on **Base** and on **Solana**.
`x402-fetch` settles the EVM rail, which is what this server uses; swap in a
Solana x402 client if your agent's wallet holds USDC there instead. Nothing else
changes: same routes, same prices, same artifacts.

## Minimal MCP server (TypeScript)

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { wrapFetchWithPayment } from "x402-fetch";
import { privateKeyToAccount } from "viem/accounts";

const BASE_URL = process.env.FLIGHT_SEARCH_URL ?? "http://localhost:4021";
const account = privateKeyToAccount(process.env.PRIVATE_KEY as `0x${string}`);
// Cap each call at $0.05 so a tool loop can never run away.
const payFetch = wrapFetchWithPayment(fetch, account, 50_000n);

const server = new McpServer({ name: "x402-flight-search", version: "0.1.0" });

server.tool(
  "search_flights",
  "Search flight offers for a route and date. Costs $0.005 in USDC.",
  {
    origin: z.string().length(3).describe("3-letter IATA origin, e.g. JFK"),
    destination: z.string().length(3).describe("3-letter IATA destination, e.g. LAX"),
    date: z.string().describe("Departure date, YYYY-MM-DD"),
    adults: z.number().int().min(1).max(9).optional(),
    max: z.number().int().min(1).max(20).optional(),
  },
  async ({ origin, destination, date, adults, max }) => {
    const qs = new URLSearchParams({ origin, destination, date });
    if (adults) qs.set("adults", String(adults));
    if (max) qs.set("max", String(max));
    const r = await payFetch(`${BASE_URL}/search?${qs}`);
    return { content: [{ type: "text", text: await r.text() }] };
  },
);

server.tool(
  "price_offer",
  "Re-price a specific offer against the carrier and get the confirmed fare. Costs $0.003 in USDC.",
  { offerId: z.string().describe("An offerId returned by search_flights") },
  async ({ offerId }) => {
    const r = await payFetch(`${BASE_URL}/price/${encodeURIComponent(offerId)}`);
    return { content: [{ type: "text", text: await r.text() }] };
  },
);

server.tool(
  "check_fare",
  "Current cheapest fare plus the change since a price you already observed. Costs $0.002 in USDC per look.",
  {
    origin: z.string().length(3),
    destination: z.string().length(3),
    date: z.string(),
    previousPrice: z.number().optional().describe("Your last observed price; omit on the first poll"),
  },
  async ({ origin, destination, date, previousPrice }) => {
    const qs = new URLSearchParams({ origin, destination, date });
    if (previousPrice !== undefined) qs.set("previousPrice", String(previousPrice));
    const r = await payFetch(`${BASE_URL}/check?${qs}`);
    return { content: [{ type: "text", text: await r.text() }] };
  },
);

// Free — let the model see the data source and rails before it spends.
server.tool("service_info", "Data source and accepted payment rails (free)", {}, async () => {
  const r = await fetch(`${BASE_URL}/health`);
  return { content: [{ type: "text", text: await r.text() }] };
});

await server.connect(new StdioServerTransport());
```

## claude_desktop_config.json

```json
{
  "mcpServers": {
    "x402-flight-search": {
      "command": "npx",
      "args": ["tsx", "/path/to/mcp-server.ts"],
      "env": {
        "FLIGHT_SEARCH_URL": "http://localhost:4021",
        "PRIVATE_KEY": "0x… funded Base Sepolia key"
      }
    }
  }
}
```

## Telling the model about fixtures

`service_info` returns `{"source": "fixture"}` when the operator has no Amadeus
keys set. Surface that in your system prompt — a model quoting fixture fares as
real prices is the one genuinely bad failure mode here. Every paid response also
carries its own `source` field, so the model can check per call.

## Spending safety

`wrapFetchWithPayment(fetch, account, 50_000n)` refuses any single call above
$0.05. A fare-watch loop is the case to watch: `check_fare` is cheap but easy to
call repeatedly, so bound the loop in your agent, not just per call. For budgets,
per-merchant caps, and approval thresholds see the x402-agent-wallet pattern in
the [x402 Suite](https://github.com/nirholas/x402-suite).
