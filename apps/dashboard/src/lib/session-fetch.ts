/** حد نقل المتصفح: cookies فقط، مع CSRF مزدوج الربط للطلبات المعدلة. */
function readCsrfCookie(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const entry = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith("ab_csrf="));
  return entry === undefined ? undefined : decodeURIComponent(entry.slice("ab_csrf=".length));
}

export function sessionFetch(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const method = (init.method ?? "GET").toUpperCase();
  const headers = new Headers(init.headers);
  if (method !== "GET" && method !== "HEAD" && method !== "OPTIONS") {
    const csrf = readCsrfCookie();
    if (csrf !== undefined) headers.set("x-csrf-token", csrf);
  }
  return fetch(input, { ...init, headers, credentials: "include", cache: "no-store" });
}
