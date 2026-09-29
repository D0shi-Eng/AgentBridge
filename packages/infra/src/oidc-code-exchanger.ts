/**
 * تبادل authorization code عبر قناة HTTPS مثبتة إلى IP مفحوص.
 * لا redirects أو proxy أو pooling، ولا يغادر clientSecret إلى origin آخر.
 */
import { request } from "node:https";
import { isIP } from "node:net";
import { z } from "zod";
import { isPublicAddress } from "./jwks/ip-policy.js";
import { allowedJwksUrl, isLoopbackHost, JwksHostsSchema, JWKS_LIMITS, loopbackAllowed } from "./jwks/policy.js";
import { resolveDestination } from "./jwks/resolver.js";
import { pinnedLookup } from "./jwks/transport.js";

const TokenResponseSchema = z.object({ id_token: z.string().min(1).max(16 * 1024) }).passthrough();
let active = 0;

export interface OidcCodeExchange {
  readonly tokenEndpoint: string;
  readonly clientId: string;
  readonly clientSecret?: string;
  readonly code: string;
  readonly verifier: string;
  readonly redirectUri: string;
}

export type OidcCodeExchanger = (input: OidcCodeExchange) => Promise<string>;

function postToken(url: URL, destination: { address: string; family: 4 | 6 }, body: Buffer, authorization: string | undefined, signal: AbortSignal): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    const req = request(url, {
      method: "POST", agent: false, lookup: pinnedLookup(destination), family: destination.family,
      servername: isIP(hostname) ? "" : hostname, rejectUnauthorized: true, signal,
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json", "accept-encoding": "identity", "content-length": String(body.length), ...(authorization !== undefined ? { authorization } : {}) },
    }, (response) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      const fail = (): void => { response.destroy(); req.destroy(); reject(new Error("OIDC_TOKEN_EXCHANGE_FAILED")); };
      if (response.statusCode !== 200 || response.headers.location !== undefined || response.headers["content-encoding"] !== undefined) return fail();
      response.on("data", (chunk: Buffer) => { bytes += chunk.length; if (bytes > 64 * 1024) fail(); else chunks.push(chunk); });
      response.once("end", () => resolve(Buffer.concat(chunks, bytes)));
      response.once("error", fail);
      response.once("aborted", fail);
    });
    req.once("error", reject);
    req.end(body);
  });
}

export const exchangeAuthorizationCode: OidcCodeExchanger = async (input) => {
  if (active >= JWKS_LIMITS.maxConcurrent) throw new Error("OIDC_TOKEN_EXCHANGE_BUSY");
  active += 1;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JWKS_LIMITS.timeoutMs);
  try {
    const hosts = JwksHostsSchema.parse(process.env.JWKS_ALLOWED_HOSTS);
    const url = allowedJwksUrl(input.tokenEndpoint, hosts);
    const addresses = await resolveDestination(url.hostname.replace(/^\[|\]$/gu, ""), controller.signal);
    // قبول العام دائماً؛ الloopback تحت الاستثناء المحلي المحصور فقط (سياسة policy.ts)
    const destinationAccepted = (item: { address: string }): boolean =>
      isPublicAddress(item.address) || (loopbackAllowed() && isLoopbackHost(item.address));
    if (addresses.length === 0 || addresses.some((item) => isIP(item.address) !== item.family || !destinationAccepted(item))) throw new Error("OIDC_TOKEN_DESTINATION_REJECTED");
    const destination = addresses[0];
    if (destination === undefined) throw new Error("OIDC_TOKEN_DESTINATION_REJECTED");
    const form = new URLSearchParams({ grant_type: "authorization_code", code: input.code, code_verifier: input.verifier, redirect_uri: input.redirectUri });
    const authorization = input.clientSecret === undefined ? undefined : `Basic ${Buffer.from(`${input.clientId}:${input.clientSecret}`, "utf8").toString("base64")}`;
    if (authorization === undefined) form.set("client_id", input.clientId);
    const response = await postToken(url, destination, Buffer.from(form.toString(), "utf8"), authorization, controller.signal);
    return TokenResponseSchema.parse(JSON.parse(response.toString("utf8"))).id_token;
  } finally { clearTimeout(timer); controller.abort(); active -= 1; }
};
