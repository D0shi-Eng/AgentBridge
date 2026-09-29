/** حل A وAAAA مع إلغاء DNS ضمن deadline المستدعي؛ أي خطأ غير غياب السجل يرفض. */
import { Resolver } from "node:dns/promises";
import { isIP } from "node:net";
import { jwksFailure } from "./policy.js";

export interface Destination { readonly address: string; readonly family: 4 | 6 }
export type ResolveDestination = (hostname: string, signal: AbortSignal) => Promise<readonly Destination[]>;

export const resolveDestination: ResolveDestination = async (hostname, signal) => {
  signal.throwIfAborted();
  const family = isIP(hostname);
  if (family === 4 || family === 6) return [{ address: hostname, family }];
  // RFC 6761: "localhost" حلقة محلية دائماً — لا DNS له أصلاً، ومحلل
  // c-ares لا يقرأ hosts file فيرفضه ظلماً. تثبيته هنا يمنع حتى هجوم
  // rebinding على هذا الاسم تحديداً (لا استعلام يُرسل أصلاً).
  if (hostname === "localhost") return [{ address: "127.0.0.1", family: 4 }];
  const resolver = new Resolver();
  const abort = (): void => resolver.cancel();
  signal.addEventListener("abort", abort, { once: true });
  try {
    const results = await Promise.allSettled([resolver.resolve4(hostname), resolver.resolve6(hostname)]);
    signal.throwIfAborted();
    const addresses: Destination[] = [];
    for (const [index, result] of results.entries()) {
      if (result.status === "fulfilled") {
        addresses.push(...result.value.map((address) => ({ address, family: index === 0 ? 4 as const : 6 as const })));
      } else {
        const failure: unknown = result.reason;
        if (!(failure instanceof Error) || !("code" in failure) || failure.code !== "ENODATA") throw jwksFailure();
      }
    }
    return addresses;
  } finally { signal.removeEventListener("abort", abort); }
};
