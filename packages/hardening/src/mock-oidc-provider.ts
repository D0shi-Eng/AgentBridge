/**
 * مزود OIDC مزيف للتجارب الحية — خادم JWKS محلي فقط (HD-08).
 *
 * ماهيته: يولّد زوج RSA ويكشف /.well-known/jwks.json و /token بتوقيع RS256.
 * وظيفته: تمكين HD-08 من التحقق أن توكن بـ iss خاطئ يُرفض 401 قبل upstream.
 * كيف: http.createServer + generateKeyPairSync + JWK export حتمي — localhost فقط.
 */

import { createServer, type Server } from "node:http";
import { generateKeyPairSync } from "node:crypto";

export interface MockOidcProvider {
  readonly server: Server;
  readonly baseUrl: string;
  readonly issuer: string;
  readonly jwksUrl: string;
  readonly clientId: string;
  readonly kid: string;
  readonly publicJwk: Record<string, unknown>;
  readonly privateJwk: Record<string, unknown>;
  close(): void;
}

export async function startMockOidcProvider(clientId = "test-client"): Promise<MockOidcProvider> {
  const kid = "mock-kid-1";
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicJwk = publicKey.export({ format: "jwk" }) as Record<string, unknown>;
  const privateJwk = privateKey.export({ format: "jwk" }) as Record<string, unknown>;
  const pub = { ...publicJwk, kid, alg: "RS256", use: "sig" };
  const priv = { ...privateJwk, kid, alg: "RS256" };

  const server = createServer((req, res) => {
    if (req.url === "/.well-known/jwks.json" || req.url === "/jwks.json") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ keys: [pub] }));
      return;
    }
    res.writeHead(404); res.end("not found");
  });

  await new Promise<void>((resolve) => { server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address() as { port: number };
  const baseUrl = `http://127.0.0.1:${String(address.port)}`;
  const issuer = `${baseUrl}`;
  const jwksUrl = `${baseUrl}/.well-known/jwks.json`;
  return { server, baseUrl, issuer, jwksUrl, clientId, kid, publicJwk: pub, privateJwk: priv, close: () => { server.closeAllConnections(); server.close(); } };
}
