/**
 * Amadeus Self-Service API adapter — env-gated.
 * Real calls when AMADEUS_CLIENT_ID + AMADEUS_CLIENT_SECRET are set
 * (free sandbox keys: https://developers.amadeus.com), deterministic
 * fixtures otherwise.
 */

const HOST = process.env.AMADEUS_HOST ?? "https://test.api.amadeus.com";

export function amadeusEnabled(): boolean {
  return Boolean(process.env.AMADEUS_CLIENT_ID && process.env.AMADEUS_CLIENT_SECRET);
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const res = await fetch(`${HOST}/v1/security/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: process.env.AMADEUS_CLIENT_ID!,
      client_secret: process.env.AMADEUS_CLIENT_SECRET!,
    }),
  });
  if (!res.ok) {
    throw new UpstreamError(`Amadeus auth failed: HTTP ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.token;
}

export async function amadeusGet(path: string, params: Record<string, string>): Promise<unknown> {
  const token = await accessToken();
  const url = `${HOST}${path}?${new URLSearchParams(params)}`;
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    throw new UpstreamError(`Amadeus GET ${path} failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export async function amadeusPost(path: string, body: unknown): Promise<unknown> {
  const token = await accessToken();
  const res = await fetch(`${HOST}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new UpstreamError(`Amadeus POST ${path} failed: HTTP ${res.status} ${await res.text()}`);
  }
  return res.json();
}

export class UpstreamError extends Error {}
