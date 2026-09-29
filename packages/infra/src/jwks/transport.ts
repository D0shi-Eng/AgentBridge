/** HTTPS مباشر بلا proxy أو pool؛ lookup يعيد IP المفحوص مع إبقاء hostname/TLS/SNI. */
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import type { Destination } from "./resolver.js";
import { jwksFailure } from "./policy.js";

export type JwksTransport = (url: URL, destination: Destination, signal: AbortSignal, maxBytes: number) => Promise<Buffer>;

export function pinnedLookup(destination: Destination): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) callback(null, [destination]);
    else callback(null, destination.address, destination.family);
  };
}

export const requestJwks: JwksTransport = (url, destination, signal, maxBytes) => new Promise((resolve, reject) => {
  const hostname = url.hostname.replace(/^\[|\]$/gu, "");
  const req = request(url, {
    agent: false, lookup: pinnedLookup(destination), family: destination.family,
    servername: isIP(hostname) ? "" : hostname, rejectUnauthorized: true, signal,
    headers: { Accept: "application/json", "Accept-Encoding": "identity" },
  }, (response) => {
    const fail = (): void => { response.destroy(); req.destroy(); reject(jwksFailure()); };
    const encoding = response.headers["content-encoding"];
    const length = response.headers["content-length"];
    if (response.statusCode !== 200 || (encoding !== undefined && encoding !== "identity") ||
        (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maxBytes))) {
      fail();
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxBytes) { fail(); return; }
      chunks.push(chunk);
    });
    response.once("end", () => resolve(Buffer.concat(chunks, bytes)));
    response.once("error", () => reject(jwksFailure()));
    response.once("aborted", () => reject(jwksFailure()));
  });
  req.once("error", () => reject(jwksFailure()));
  req.end();
});
