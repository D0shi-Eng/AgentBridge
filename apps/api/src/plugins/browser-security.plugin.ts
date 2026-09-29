/**
 * ترويسات حدود المتصفح — تمنع التخزين المشترك والـframing والتخمين النوعي.
 * HSTS لا يظهر إلا في نمط الإنتاج الذي يفرض cookie Secure.
 */
import type { FastifyInstance } from "fastify";
import type { AppConfig } from "@agentbridge/infra";

export function registerBrowserSecurity(app: FastifyInstance, config: AppConfig): void {
  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "private, no-store, max-age=0");
    reply.header("pragma", "no-cache");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");
    reply.header("x-frame-options", "DENY");
    reply.header("vary", "Origin, Cookie");
    if (config.nodeEnv === "production" || config.stagingHttps === true) {
      // HSTS في الإنتاج وفي بيئة HTTPS التدريبية التي تثبت أمان الكوكيز حياً
      reply.header("strict-transport-security", "max-age=31536000; includeSubDomains");
    }
    return payload;
  });
}
