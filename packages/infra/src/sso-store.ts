/**
 * عقد مخزن SSO — CAS مركب إلزامي.
 *
 * القواعد الملزمة:
 *  - create يولد instance ID من الخادم حصراً — العميل لا يختاره ولا يمرره.
 *  - update لا يغير instance ID إطلاقاً، ويقارن (الهوية + الإصدار) معاً.
 *  - delete يقبل توقعاً مركباً اختيارياً؛ غياب السجل معنى منفصل عن التعارض.
 *  - التعارض SSO_CONFIG_CONFLICT (409) وغياب السجل SSO_CONFIG_NOT_FOUND (404)
 *    خطآن منفصلان — لا خلط بينهما.
 *  - InMemory هنا يطبق المعنى نفسه الذي يطبقه محول Prisma في sso-prisma-store.
 */
import type { SsoConfig } from "@agentbridge/shared";
import { randomUUID } from "node:crypto";

/** توقع CAS مركب — ممنوع الاكتفاء بالإصدار وحده (جذر ثغرة ABA التاريخية) */
export interface SsoCasExpectation {
  readonly expectedInstanceId: string;
  readonly expectedVersion: number;
}

/** مدخل الكتابة (إنشاء/تحديث): بلا هوية دورة ولا إصدار — قرارات خادم.
 * المغلف الداخلي يمرر صراحة: غيابه في التحديث يفرغ السر،
 * وإبقاؤه يتكفل به المسار عبر إعادة الختم لا بحمل مغلف قديم. */
export type SsoConfigWriteInput = Omit<SsoConfig, "configInstanceId" | "configVersion" | "clientSecretConfigured"> & {
  readonly clientSecretEnvelope?: string;
};

/** الشكل الداخلي المخزن: هوية وإصدار مطلوبان + المغلف (لا يُعاد عاماً) */
export interface StoredSsoConfig extends SsoConfig {
  readonly configInstanceId: string;
  readonly configVersion: number;
  readonly clientSecretEnvelope?: string;
}

/** تعارض CAS — ترجمة المسار 409 برسالة واسم ثابتين */
export class SsoConfigConflictError extends Error {
  constructor() {
    super("SSO_CONFIG_CONFLICT: تعارض تحديث إعداد SSO — الهوية أو الإصدار لم يعودا يطابقان التوقع");
    this.name = "SSO_CONFIG_CONFLICT";
  }
}

/** غياب السجل — ترجمة المسار 404، منفصل عن التعارض بنيوياً */
export class SsoConfigNotFoundError extends Error {
  constructor() {
    super("SSO_CONFIG_NOT_FOUND: لا يوجد إعداد SSO لهذا المستأجر");
    this.name = "SSO_CONFIG_NOT_FOUND";
  }
}

/** هوية دورة جديدة من الخادم — hex 32 بلا شرطات (نطاق منفصل عن الشواهد القديمة) */
export function generateConfigInstanceId(): string {
  return randomUUID().replaceAll("-", "");
}

export interface SsoStore {
  get(tenantId: string): Promise<SsoConfig | null>;
  getPrivate(tenantId: string): Promise<StoredSsoConfig | null>;
  create(config: SsoConfigWriteInput): Promise<PublicSsoConfig>;
  update(config: SsoConfigWriteInput, expectation: SsoCasExpectation): Promise<PublicSsoConfig>;
  /** يعيد false عند غياب السجل — التعارض يرمي، فلا يختلط الفضلات بالتعارض */
  delete(tenantId: string, expectation?: SsoCasExpectation): Promise<boolean>;
}

/** الشكل العام المرجع بعد الكتابة: هوية وإصدار مضمونان بلا مغلف */
export type PublicSsoConfig = Omit<StoredSsoConfig, "clientSecretEnvelope"> & { readonly clientSecretConfigured: boolean };

/** يعيد الخصائص العامة فقط — المغلف لا يغادر المخزن أبداً */
export function publicConfig(config: StoredSsoConfig): PublicSsoConfig {
  const { clientSecretEnvelope: _secret, ...visible } = config;
  return { ...visible, clientSecretConfigured: _secret !== undefined };
}

// محول داخل الذاكرة — نفس دلالات Prisma حرفياً للتطوير والاختبارات بلا بنية
export function createInMemorySsoStore(): SsoStore {
  const map = new Map<string, StoredSsoConfig>();
  return {
    async get(tenantId) {
      const config = map.get(tenantId);
      return config === undefined ? null : publicConfig(config);
    },
    async getPrivate(tenantId) {
      return map.get(tenantId) ?? null;
    },
    async create(config) {
      if (map.has(config.tenantId)) throw new SsoConfigConflictError();
      const stored: StoredSsoConfig = {
        ...config, configVersion: 1, configInstanceId: generateConfigInstanceId(),
      };
      map.set(config.tenantId, stored);
      return publicConfig(stored);
    },
    async update(config, expectation) {
      const current = map.get(config.tenantId);
      if (current === undefined) throw new SsoConfigNotFoundError();
      if (current.configInstanceId !== expectation.expectedInstanceId ||
          current.configVersion !== expectation.expectedVersion) {
        throw new SsoConfigConflictError();
      }
      const stored: StoredSsoConfig = {
        ...config, configInstanceId: current.configInstanceId,
        configVersion: current.configVersion + 1,
      };
      map.set(config.tenantId, stored);
      return publicConfig(stored);
    },
    async delete(tenantId, expectation) {
      const current = map.get(tenantId);
      if (current === undefined) return false;
      if (expectation !== undefined &&
          (current.configInstanceId !== expectation.expectedInstanceId ||
           current.configVersion !== expectation.expectedVersion)) {
        throw new SsoConfigConflictError();
      }
      map.delete(tenantId);
      return true;
    },
  };
}
