/**
 * x402-flight-search — pay-per-query flight search over the Amadeus API.
 *
 * Free routes:  GET /health, GET /airports, GET /.well-known/x402
 * Paid routes:  GET /search        $0.005  flight offers
 *               GET /price/:id     $0.003  confirmed priced offer
 *               GET /check         $0.002  fare snapshot + delta vs your last price
 *
 * Every paid route returns the purchased artifact in the 200 body — there are no
 * jobs to poll and no state to come back for. `/check` is the pay-per-poll form
 * of a fare watch: each call is a fresh snapshot plus the delta against the price
 * you pass in, so an agent owns the whole watch loop and pays only per look.
 */
import "dotenv/config";
import express from "express";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildRails, describeRails, paywall, type RoutePrices } from "./payments.js";
import { ROUTE_SCHEMAS } from "./schemas.js";
import { amadeusEnabled, UpstreamError } from "./amadeus.js";
import {
  BadRequestError,
  NotFoundError,
  fareCheck,
  parseSearchParams,
  priceOffer,
  searchFlights,
} from "./service.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const rails = buildRails();

const PRICES = { search: "$0.005", price: "$0.003", check: "$0.002" } as const;

/**
 * Every paid route publishes its request and response schema inside the 402
 * challenge, so an agent that has never seen this API can read one 402 and know
 * how to call the route and what it will get back. `ROUTE_SCHEMAS` is generated
 * from `public/openapi.json` (`npm run schemas`), which is what keeps the
 * challenge and the published OpenAPI document from drifting apart.
 */
const routePrices: RoutePrices = {
  "GET /search": {
    price: PRICES.search,
    description: "Flight offers for a route and date — carriers, segments, cabin, total fare",
    mimeType: "application/json",
    outputSchema: ROUTE_SCHEMAS["GET /search"],
  },
  "GET /price/:offerId": {
    price: PRICES.price,
    description: "Confirmed priced offer — re-priced against the carrier at request time",
    mimeType: "application/json",
    outputSchema: ROUTE_SCHEMAS["GET /price/:offerId"],
  },
  "GET /check": {
    price: PRICES.check,
    description:
      "Current cheapest fare snapshot plus the delta versus a caller-supplied previous price",
    mimeType: "application/json",
    outputSchema: ROUTE_SCHEMAS["GET /check"],
  },
};

const app = express();
app.use(express.json());

/** Dual-rail paywall — pay in USDC on Base or Solana, the client picks. */
app.use(paywall(routePrices, rails));

// ————— Free routes —————

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "x402-flight-search",
    source: amadeusEnabled() ? "amadeus" : "fixture",
    rails: rails.map((r) => r.network),
  });
});

/** A few IATA codes the fixture data covers well, so a caller can try the API blind. */
app.get("/airports", (_req, res) => {
  res.json({
    note: "Any 3-letter IATA code works. These are handy for trying the fixture data.",
    source: amadeusEnabled() ? "amadeus" : "fixture",
    airports: [
      { code: "JFK", city: "New York" },
      { code: "LAX", city: "Los Angeles" },
      { code: "SFO", city: "San Francisco" },
      { code: "ORD", city: "Chicago" },
      { code: "LHR", city: "London" },
      { code: "CDG", city: "Paris" },
      { code: "NRT", city: "Tokyo" },
      { code: "SIN", city: "Singapore" },
    ],
  });
});

// ————— Paid routes —————

app.get("/search", async (req, res) => {
  try {
    const params = parseSearchParams(req.query as Record<string, unknown>);
    res.json(await searchFlights(params));
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/price/:offerId", async (req, res) => {
  try {
    res.json(await priceOffer(req.params.offerId));
  } catch (err) {
    handleError(err, res);
  }
});

app.get("/check", async (req, res) => {
  try {
    const params = parseSearchParams(req.query as Record<string, unknown>);
    const raw = req.query.previousPrice;
    const prev = raw === undefined || raw === "" ? null : Number(raw);
    if (prev !== null && !Number.isFinite(prev)) {
      throw new BadRequestError("previousPrice must be a number, e.g. previousPrice=412.30");
    }
    res.json(await fareCheck(params, prev));
  } catch (err) {
    handleError(err, res);
  }
});

// ————— Discovery —————

app.get("/.well-known/x402", (_req, res) => {
  res.type("application/json").sendFile(join(ROOT, "public", ".well-known", "x402"));
});
app.get("/skill.md", (_req, res) => {
  res.type("text/markdown").sendFile(join(ROOT, "skill.md"));
});
app.use(express.static(join(ROOT, "public")));

function handleError(err: unknown, res: express.Response): void {
  if (err instanceof BadRequestError) {
    res.status(400).json({ error: "bad_request", message: err.message });
  } else if (err instanceof NotFoundError) {
    res.status(404).json({ error: "not_found", message: err.message });
  } else if (err instanceof UpstreamError) {
    console.error(err);
    res.status(502).json({ error: "upstream_error", message: err.message });
  } else {
    console.error(err);
    res.status(500).json({ error: "internal_error" });
  }
}

const port = Number(process.env.PORT ?? 4022);
app.listen(port, () => {
  console.log(`\nx402-flight-search listening on http://localhost:${port}\n`);
  console.log("  Payment rails (USDC — the client picks):");
  for (const line of describeRails(rails)) console.log(`    ${line}`);
  console.log(
    `\n  Data source: ${
      amadeusEnabled()
        ? "Amadeus (live) — AMADEUS_CLIENT_ID/SECRET detected"
        : 'fixtures (deterministic) — set AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET for live data; responses are labelled source:"fixture"'
    }\n`,
  );
  console.log("  Free routes:");
  console.log("    GET /health              service + data source");
  console.log("    GET /airports            handy IATA codes");
  console.log("    GET /.well-known/x402    machine-readable price sheet");
  console.log("    GET /skill.md            agent instructions\n");
  console.log("  Paid routes (x402, USDC on Base or Solana):");
  console.log(`    GET /search              ${PRICES.search}  flight offers`);
  console.log(`    GET /price/:offerId      ${PRICES.price}  confirmed priced offer`);
  console.log(`    GET /check               ${PRICES.check}  fare snapshot + delta\n`);
});
