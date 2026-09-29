/** الجلب المحمي: deadline واحد يشمل DNS/TLS/body وحد تزامن للعملية؛ لا صف انتظار. */
import { isIP } from "node:net";
import { allowedJwksUrl, JwksHostsSchema, JWKS_LIMITS, jwksFailure, loopbackAllowed, isLoopbackHost } from "./policy.js";
import { isPublicAddress } from "./ip-policy.js";
import { resolveDestination, type ResolveDestination } from "./resolver.js";
import { requestJwks, type JwksTransport } from "./transport.js";
import { JwksSchema, type JwksResponse } from "./schema.js";

/** قبول عنوان محلول: عام، أو loopback تحت الاستثناء المحلي المحصور فقط */
function addressAccepted(address: string): boolean {
  if (isPublicAddress(address)) return true;
  return loopbackAllowed() && isLoopbackHost(address);
}

/** منافذ داخلية للاختبار؛ لا تصدر من infra/index ولا تُقرأ من إعدادات tenant. */
export function createJwksClient(resolve: ResolveDestination, transport: JwksTransport) {
  let active = 0;
  return async (rawUrl: string, hosts: readonly string[], external?: AbortSignal): Promise<JwksResponse> => {
    if (active >= JWKS_LIMITS.maxConcurrent) throw jwksFailure();
    active += 1;
    const controller = new AbortController();
    const abort = (): void => controller.abort(jwksFailure());
    const timer = setTimeout(abort, JWKS_LIMITS.timeoutMs);
    external?.addEventListener("abort", abort, { once: true });
    if (external?.aborted) abort();
    const { signal } = controller;
    let rejectAbort: (() => void) | undefined;
    try {
      const aborted = new Promise<never>((_resolve, reject) => {
        rejectAbort = () => reject(jwksFailure());
        signal.addEventListener("abort", rejectAbort, { once: true });
        if (signal.aborted) rejectAbort();
      });
      const work = async (): Promise<JwksResponse> => {
        signal.throwIfAborted();
        const url = allowedJwksUrl(rawUrl, hosts);
        const addresses = await resolve(url.hostname.replace(/^\[|\]$/gu, ""), signal);
        signal.throwIfAborted();
        if (addresses.length === 0 || addresses.length > 64 || addresses.some((item) =>
          isIP(item.address) !== item.family || !addressAccepted(item.address))) throw jwksFailure();
        const address = addresses[0];
        if (address === undefined) throw jwksFailure();
        const body = await transport(url, address, signal, JWKS_LIMITS.maxBytes);
        signal.throwIfAborted();
        if (body.length > JWKS_LIMITS.maxBytes) throw jwksFailure();
        return JwksSchema.parse(JSON.parse(body.toString("utf8")));
      };
      return await Promise.race([work(), aborted]);
    } catch { throw jwksFailure(); }
    finally {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
      if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
      controller.abort();
      active -= 1;
    }
  };
}

const productionClient = createJwksClient(
  (hostname, signal) => resolveDestination(hostname, signal),
  (url, address, signal, maxBytes) => requestJwks(url, address, signal, maxBytes),
);
/** المصدر الوحيد للقائمة هو بيئة المشغل؛ الغياب يمنع الاتصال حتى للإعدادات المحفوظة قديمًا. */
export async function fetchJwks(url: string): Promise<JwksResponse> {
  try {
    const hosts = JwksHostsSchema.parse(process.env.JWKS_ALLOWED_HOSTS);
    return await productionClient(url, hosts);
  } catch { throw jwksFailure(); }
}
