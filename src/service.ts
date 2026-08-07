/**
 * Flight search domain logic. Live Amadeus when keys are present, deterministic
 * fixtures otherwise. Every response carries `source: "amadeus" | "fixture"`.
 */
import { amadeusEnabled, amadeusGet, amadeusPost } from "./amadeus.js";
import {
  fixtureOffers,
  fixtureOfferById,
  type FlightOffer,
  type SearchParams,
} from "./fixtures.js";

export class BadRequestError extends Error {}
export class NotFoundError extends Error {}

const IATA = /^[A-Z0-9]{3}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseSearchParams(q: Record<string, unknown>): SearchParams {
  const origin = String(q.origin ?? "").toUpperCase();
  const destination = String(q.destination ?? "").toUpperCase();
  const date = String(q.date ?? "");
  const adults = Math.max(1, Math.min(9, Number(q.adults ?? 1) || 1));
  const max = Math.max(1, Math.min(20, Number(q.max ?? 5) || 5));
  if (!IATA.test(origin)) throw new BadRequestError("origin must be a 3-letter IATA code, e.g. JFK");
  if (!IATA.test(destination)) throw new BadRequestError("destination must be a 3-letter IATA code, e.g. LAX");
  if (!ISO_DATE.test(date)) throw new BadRequestError("date must be YYYY-MM-DD");
  return { origin, destination, date, adults, max };
}

/** Live offers from /search are cached so /price/:offerId can re-price them. */
const liveOfferCache = new Map<string, unknown>();
const LIVE_CACHE_MAX = 500;

function cacheLiveOffer(id: string, offer: unknown): void {
  if (liveOfferCache.size >= LIVE_CACHE_MAX) {
    const first = liveOfferCache.keys().next().value;
    if (first !== undefined) liveOfferCache.delete(first);
  }
  liveOfferCache.set(id, offer);
}

interface AmadeusOffer {
  id: string;
  price?: { grandTotal?: string; total?: string; currency?: string };
  validatingAirlineCodes?: string[];
  numberOfBookableSeats?: number;
  itineraries?: Array<{
    duration?: string;
    segments?: Array<{
      departure?: { iataCode?: string; at?: string };
      arrival?: { iataCode?: string; at?: string };
      carrierCode?: string;
      number?: string;
      duration?: string;
    }>;
  }>;
  travelerPricings?: Array<{ fareDetailsBySegment?: Array<{ cabin?: string }> }>;
}

function isoDurationToMinutes(d?: string): number {
  if (!d) return 0;
  const m = d.match(/PT(?:(\d+)H)?(?:(\d+)M)?/);
  return m ? Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0) : 0;
}

function normalizeAmadeusOffer(raw: AmadeusOffer): FlightOffer {
  const segments = (raw.itineraries?.[0]?.segments ?? []).map((s) => ({
    from: s.departure?.iataCode ?? "???",
    to: s.arrival?.iataCode ?? "???",
    departure: s.departure?.at ?? "",
    arrival: s.arrival?.at ?? "",
    carrierCode: s.carrierCode ?? "??",
    flightNumber: `${s.carrierCode ?? ""}${s.number ?? ""}`,
    durationMinutes: isoDurationToMinutes(s.duration),
  }));
  return {
    offerId: `am-${raw.id}`,
    source: "amadeus",
    price: {
      total: raw.price?.grandTotal ?? raw.price?.total ?? "0",
      currency: raw.price?.currency ?? "USD",
    },
    validatingCarrier: raw.validatingAirlineCodes?.[0] ?? segments[0]?.carrierCode ?? "??",
    seatsRemaining: raw.numberOfBookableSeats ?? 0,
    cabin: raw.travelerPricings?.[0]?.fareDetailsBySegment?.[0]?.cabin ?? "ECONOMY",
    segments,
  };
}

export interface SearchResult {
  source: "amadeus" | "fixture";
  query: SearchParams;
  currency: string;
  offers: FlightOffer[];
  retrievedAt: string;
}

export async function searchFlights(params: SearchParams): Promise<SearchResult> {
  if (amadeusEnabled()) {
    const data = (await amadeusGet("/v2/shopping/flight-offers", {
      originLocationCode: params.origin,
      destinationLocationCode: params.destination,
      departureDate: params.date,
      adults: String(params.adults),
      max: String(params.max),
      currencyCode: "USD",
    })) as { data?: AmadeusOffer[] };
    const rawOffers = data.data ?? [];
    for (const raw of rawOffers) cacheLiveOffer(`am-${raw.id}`, raw);
    return {
      source: "amadeus",
      query: params,
      currency: "USD",
      offers: rawOffers.map(normalizeAmadeusOffer),
      retrievedAt: new Date().toISOString(),
    };
  }
  return {
    source: "fixture",
    query: params,
    currency: "USD",
    offers: fixtureOffers(params),
    retrievedAt: new Date().toISOString(),
  };
}

export interface PricedOffer {
  source: "amadeus" | "fixture";
  offerId: string;
  confirmed: boolean;
  offer: FlightOffer;
  priceGuarantee: string;
  pricedAt: string;
}

export async function priceOffer(offerId: string): Promise<PricedOffer> {
  if (offerId.startsWith("am-")) {
    const raw = liveOfferCache.get(offerId);
    if (!raw) {
      throw new NotFoundError(
        "Unknown offerId — live offers must be re-priced within the same server session as the /search that produced them. Run /search again.",
      );
    }
    const data = (await amadeusPost("/v1/shopping/flight-offers/pricing", {
      data: { type: "flight-offers-pricing", flightOffers: [raw] },
    })) as { data?: { flightOffers?: AmadeusOffer[] } };
    const priced = data.data?.flightOffers?.[0];
    if (!priced) throw new NotFoundError("Amadeus returned no priced offer — it may have expired.");
    return {
      source: "amadeus",
      offerId,
      confirmed: true,
      offer: normalizeAmadeusOffer(priced),
      priceGuarantee: "Confirmed by Amadeus Flight Offers Price at pricedAt; fares can still change until ticketing.",
      pricedAt: new Date().toISOString(),
    };
  }

  const offer = fixtureOfferById(offerId);
  if (!offer) throw new NotFoundError(`Unknown offerId: ${offerId}`);
  return {
    source: "fixture",
    offerId,
    confirmed: true,
    offer,
    priceGuarantee: "Fixture mode — deterministic price, stable for identical queries.",
    pricedAt: new Date().toISOString(),
  };
}

export interface FareCheck {
  source: "amadeus" | "fixture";
  query: SearchParams;
  snapshot: {
    lowestTotal: string;
    currency: string;
    offerId: string;
    carrier: string;
    retrievedAt: string;
  };
  delta: {
    previousPrice: number | null;
    currentPrice: number;
    change: number | null;
    changePct: number | null;
    verdict: "dropped" | "rose" | "unchanged" | "no-cursor";
  };
}

/**
 * Pay-per-poll fare watching: every paid call returns the current cheapest
 * fare (snapshot) plus the delta vs the caller-provided previous price.
 */
export async function fareCheck(params: SearchParams, prevPrice: number | null): Promise<FareCheck> {
  const result = await searchFlights({ ...params, max: 5 });
  if (result.offers.length === 0) {
    throw new NotFoundError("No offers found for this route/date.");
  }
  const cheapest = result.offers.reduce((a, b) =>
    Number(a.price.total) <= Number(b.price.total) ? a : b,
  );
  const current = Number(cheapest.price.total);
  let verdict: FareCheck["delta"]["verdict"] = "no-cursor";
  let change: number | null = null;
  let changePct: number | null = null;
  if (prevPrice !== null) {
    change = Number((current - prevPrice).toFixed(2));
    changePct = prevPrice > 0 ? Number(((change / prevPrice) * 100).toFixed(2)) : null;
    verdict = change < 0 ? "dropped" : change > 0 ? "rose" : "unchanged";
  }
  return {
    source: result.source,
    query: params,
    snapshot: {
      lowestTotal: cheapest.price.total,
      currency: cheapest.price.currency,
      offerId: cheapest.offerId,
      carrier: cheapest.validatingCarrier,
      retrievedAt: result.retrievedAt,
    },
    delta: { previousPrice: prevPrice, currentPrice: current, change, changePct, verdict },
  };
}
