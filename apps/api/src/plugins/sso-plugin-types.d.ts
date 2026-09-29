/**
 * تعريفات الأنواع لإضافة SSO — توسيع FastifyRequest بـ ssoUser.
 */
export {};

declare module "fastify" {
  interface FastifyRequest {
    /** حقل legacy لم يُعد ملؤه؛ يُحذف بعد ترحيل المستهلكين. */
    ssoUser?: never;
  }
}
