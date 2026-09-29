/**
 * توسيع Fastify بعقد المصادقة المركزي وmetadata صريحة للسطوح العامة.
 * ملف وحدة فعلي (export {}) ليُستورد .js و.mts وvite بصيغة واحدة.
 */
import type { Principal } from "@agentbridge/shared";
import type { SessionRecord } from "@agentbridge/memory";

declare module "fastify" {
  interface FastifyContextConfig { auth?: "public" | "protected" }
  interface FastifyRequest {
    principal?: Principal;
    authSession?: SessionRecord;
  }
}

export {};
