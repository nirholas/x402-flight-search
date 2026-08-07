// Fixture data — used when AMADEUS_CLIENT_ID / AMADEUS_CLIENT_SECRET are unset.
// Deterministic: the same query always produces the same offers, so agents can
// test delta/pricing flows without an Amadeus account.

export interface FlightSegment {
  from: string;
  to: string;
  departure: string;
  arrival: string;
  carrierCode: string;
  flightNumber: string;
  durationMinutes: number;
}

export interface FlightOffer {
  offerId: string;
  source: "fixture" | "amadeus";
  price: { total: string; currency: string };
  validatingCarrier: string;
  seatsRemaining: number;
  cabin: string;
  segments: FlightSegment[];
}

const CARRIERS = [
  { code: "UA", name: "United" },
  { code: "DL", name: "Delta" },
  { code: "AA", name: "American" },
  { code: "B6", name: "JetBlue" },
  { code: "AS", name: "Alaska" },
  { code: "F9", name: "Frontier" },
];

/** FNV-1a 32-bit — stable, dependency-free string hash. */
export function hash(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Deterministic PRNG (mulberry32) seeded from the query. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export interface SearchParams {
  origin: string;
  destination: string;
  date: string;
  adults: number;
  max: number;
}

/** Generate deterministic fixture offers for a query. */
export function fixtureOffers(params: SearchParams): FlightOffer[] {
  const { origin, destination, date, adults, max } = params;
  const seed = hash(`${origin}|${destination}|${date}`);
  const rand = rng(seed);
  const count = Math.min(max, 3 + Math.floor(rand() * 3)); // 3–5 offers
  const offers: FlightOffer[] = [];

  for (let i = 0; i < count; i++) {
    const carrier = CARRIERS[Math.floor(rand() * CARRIERS.length)];
    const depHour = 6 + Math.floor(rand() * 15);
    const depMin = [0, 10, 15, 30, 40, 45][Math.floor(rand() * 6)];
    const durationMinutes = 90 + Math.floor(rand() * 360);
    const stops = rand() < 0.55 ? 0 : 1;
    const basePerAdult = 79 + rand() * 420 + stops * -25;
    const total = (basePerAdult * adults).toFixed(2);

    const dep = `${date}T${pad(depHour)}:${pad(depMin)}:00`;
    const arrMinutes = depHour * 60 + depMin + durationMinutes;
    const arrDay = arrMinutes >= 1440 ? nextDay(date) : date;
    const arr = `${arrDay}T${pad(Math.floor(arrMinutes / 60) % 24)}:${pad(arrMinutes % 60)}:00`;

    const segments: FlightSegment[] = [];
    if (stops === 0) {
      segments.push({
        from: origin,
        to: destination,
        departure: dep,
        arrival: arr,
        carrierCode: carrier.code,
        flightNumber: `${carrier.code}${100 + Math.floor(rand() * 4800)}`,
        durationMinutes,
      });
    } else {
      const hub = ["DEN", "ORD", "DFW", "CLT", "PHX"][Math.floor(rand() * 5)];
      const legOne = Math.floor(durationMinutes * 0.45);
      const layover = 45 + Math.floor(rand() * 90);
      const midMinutes = depHour * 60 + depMin + legOne;
      const mid = `${date}T${pad(Math.floor(midMinutes / 60) % 24)}:${pad(midMinutes % 60)}:00`;
      const mid2Minutes = midMinutes + layover;
      const mid2 = `${date}T${pad(Math.floor(mid2Minutes / 60) % 24)}:${pad(mid2Minutes % 60)}:00`;
      segments.push(
        {
          from: origin,
          to: hub,
          departure: dep,
          arrival: mid,
          carrierCode: carrier.code,
          flightNumber: `${carrier.code}${100 + Math.floor(rand() * 4800)}`,
          durationMinutes: legOne,
        },
        {
          from: hub,
          to: destination,
          departure: mid2,
          arrival: arr,
          carrierCode: carrier.code,
          flightNumber: `${carrier.code}${100 + Math.floor(rand() * 4800)}`,
          durationMinutes: durationMinutes - legOne - layover,
        },
      );
    }

    offers.push({
      // Params are encoded in the id so /price/:offerId is stateless in fixture mode.
      offerId: `fx-${origin}-${destination}-${date}-${adults}-${i}`,
      source: "fixture",
      price: { total, currency: "USD" },
      validatingCarrier: carrier.code,
      seatsRemaining: 1 + Math.floor(rand() * 8),
      cabin: "ECONOMY",
      segments,
    });
  }

  return offers.sort((a, b) => Number(a.price.total) - Number(b.price.total));
}

/** Re-derive a single fixture offer from its id (fixture pricing is stateless). */
export function fixtureOfferById(offerId: string): FlightOffer | undefined {
  const m = offerId.match(/^fx-([A-Z0-9]{3})-([A-Z0-9]{3})-(\d{4}-\d{2}-\d{2})-(\d+)-(\d+)$/);
  if (!m) return undefined;
  const offers = fixtureOffers({
    origin: m[1],
    destination: m[2],
    date: m[3],
    adults: Number(m[4]),
    max: 10,
  });
  return offers.find((o) => o.offerId === offerId);
}

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
