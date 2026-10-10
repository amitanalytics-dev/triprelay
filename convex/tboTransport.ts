"use node";

import { ProxyAgent, fetch as proxyFetch } from "undici";

// Closed endpoint list: there are deliberately no booking or ticketing methods.
const endpoints = {
  hotelSearch: "https://affiliate.tektravels.com/HotelAPI/Search",
  hotelRecheck: "https://affiliate.tektravels.com/HotelAPI/PreBook",
  flightAuth: "https://api.travelboutiqueonline.com/SharedAPI/SharedData.svc/rest/Authenticate",
  flightSearch: "https://tboapi.travelboutiqueonline.com/AirAPI_V10/AirService.svc/rest/Search",
  flightRecheck: "https://tboapi.travelboutiqueonline.com/AirAPI_V10/AirService.svc/rest/FareQuote",
  flightRules: "https://tboapi.travelboutiqueonline.com/AirAPI_V10/AirService.svc/rest/FareRule",
} as const;
export type TboMethod = keyof typeof endpoints;
export type WireObject = Record<string, unknown>;
export function object(value: unknown): WireObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("TBO returned an unexpected response format.");
  return value as WireObject;
}
export function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
export function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
export function string(value: unknown): string { return typeof value === "string" ? value : ""; }

const common = ["TBO_MODE", "TBO_END_USER_IP", "TBO_PROXY_URL"];
const hotelKeys = ["TBO_USERNAME", "TBO_PASSWORD"];
const flightKeys = ["TBO_AIR_USERNAME", "TBO_AIR_PASSWORD", "TBO_AIR_CLIENT_ID"];
export function readiness(product: "hotels" | "flights") {
  const missing = [...common, ...(product === "hotels" ? hotelKeys : flightKeys)]
    .filter((key) => !process.env[key]?.trim());
  if (process.env.TBO_MODE && process.env.TBO_MODE !== "live") missing.push("TBO_MODE must be live");
  const proxy = process.env.TBO_PROXY_URL;
  if (proxy) {
    try { const url = new URL(proxy); if (!["http:", "https:"].includes(url.protocol)) missing.push("Valid TBO_PROXY_URL required"); }
    catch { missing.push("Valid TBO_PROXY_URL required"); }
  }
  const ip = process.env.TBO_END_USER_IP;
  if (ip && (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip) || ip.split(".").some((part) => Number(part) > 255))) {
    missing.push("Valid TBO_END_USER_IP required");
  }
  return { ready: missing.length === 0, missing, transport: "existing_fixed_ip_proxy" as const,
    liveVerified: false as const };
}
export function requireReady(product: "hotels" | "flights") {
  const state = readiness(product);
  if (!state.ready) throw new Error(`TBO ${product} connection unavailable: ${state.missing.join(", ")}.`);
}

export async function post(method: TboMethod, payload: WireObject): Promise<WireObject> {
  const product = method.startsWith("hotel") ? "hotels" : "flights";
  requireReady(product);
  let proxy: ProxyAgent;
  try { proxy = new ProxyAgent(process.env.TBO_PROXY_URL!); }
  catch { throw new Error("TBO proxy configuration could not be loaded. Check the approved proxy settings."); }
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (product === "hotels") headers.Authorization = `Basic ${Buffer.from(`${process.env.TBO_USERNAME}:${process.env.TBO_PASSWORD}`).toString("base64")}`;
  try {
    const response = await proxyFetch(endpoints[method], {
      method: "POST", headers, body: JSON.stringify(payload), dispatcher: proxy,
      signal: AbortSignal.timeout(60_000), redirect: "error",
    });
    if (!response.ok) throw new Error(`TBO ${method} failed with HTTP ${response.status}.`);
    try { return object(await response.json()); }
    catch { throw new Error(`TBO ${method} returned an invalid response.`); }
  } catch (error) {
    // Never propagate raw supplier/network messages: they may contain credentials,
    // proxy URLs, tokens or the complete request payload.
    if (error instanceof Error && /^TBO \w+ (failed with HTTP \d+\.|returned an invalid response\.)$/.test(error.message)) throw error;
    throw new Error(`TBO ${method} request failed. Check connection access and the approved proxy.`);
  } finally { await proxy.close().catch(() => undefined); }
}

export async function flightToken() {
  requireReady("flights");
  // Mint per action; never assume a token survives the next IST midnight.
  const response = await post("flightAuth", { ClientId: process.env.TBO_AIR_CLIENT_ID,
    UserName: process.env.TBO_AIR_USERNAME, Password: process.env.TBO_AIR_PASSWORD,
    EndUserIp: process.env.TBO_END_USER_IP });
  if (response.Status !== 1 || !string(response.TokenId)) throw new Error("TBO flight authentication was rejected.");
  return string(response.TokenId);
}
