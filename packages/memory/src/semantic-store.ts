/**
 * الذاكرة الدلالية L2 — منفذ SemanticStore ومحوله داخل الذاكرة (وثيقة memory.md §L2).
 *
 * هذا مصدر الحقيقة الوحيد: المستأجرون، المشاريع، المواصفات، التشغيلات،
 * الشهادات، وسجل التدقيق. فرض نطاق المستأجر على مستوى المنفذ نفسه:
 * كل دالة (عدا البحث بالمفتاح الطبيعي للمصادقة) تستقبل tenantId معلمةً
 * أولى فلا وجود لاستعلام بلا نطاق مستأجر (وثيقة security.md §8).
 *
 * المحول الفعلي فوق PostgreSQL/Prisma في packages/infra؛ هذا المحول
 * داخل الذاكرة كامل الوظائف للتطوير والاختبارات.
 */

import type { AuditTrailEntry } from "@agentbridge/shared";
import { semanticLifecycleOver, type SemanticTenantLifecycle } from "./tenant-lifecycle.js";

export interface TenantRecord {
  readonly tenantId: string;
  readonly name: string;
  /** hash scrypt للمفتاح الخام — لا يُخزن المفتاح أبداً (وثيقة security.md §2) */
  readonly apiKeyHash: string;
  /** دور مسؤول المستأجر لإدارة SSO — افتراضي false */
  readonly isAdmin?: boolean;
  readonly createdAt: string;
  /**
   * FC — قبر المستأجر بعد اكتمال الحذف: توقيت ISO يمنع أي وصول أو إعادة
   * استخدام للمعرف، ويبقى الصف مرساة لسجل التدقيق وأرقام الإبطال العامة.
   */
  readonly deletedAt?: string;
  /** FC — حجز قانوني حتى توقيت ISO: يمنع سير الحذف كلياً ما دام نافذاً */
  readonly legalHoldUntil?: string;
}

export interface ProjectRecord {
  readonly projectId: string;
  readonly tenantId: string;
  readonly name: string;
  readonly createdAt: string;
}

export interface SpecRecord {
  readonly specId: string;
  readonly tenantId: string;
  readonly projectId: string;
  /** نص OpenAPI كما رُفع — JSON أو YAML */
  readonly content: string;
  readonly createdAt: string;
}

export interface PipelineRecord {
  readonly runId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly specId: string;
  /** running | completed | failed | needs_human | suspended */
  readonly status: string;
  readonly stoppedAt?: string;
  readonly repairCyclesUsed: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CertificateRecord {
  readonly runId: string;
  readonly tenantId: string;
  readonly finalScore: number;
  readonly granted: boolean;
  readonly verificationId: string;
  readonly certificateJson: string;
  readonly issuedAt: string;
}

/** صف إبطال شهادة — قرار نهائي غير قابل للتعديل أو الحذف */
export interface CertificateRevocationRecord {
  readonly tenantId: string;
  readonly runId: string;
  readonly verificationId: string;
  /** سبب الإبطال الموثق (يظهر في /verify كحالة revoked) */
  readonly reason: string;
  readonly revokedAt: string;
}

/** حزمة الخادم المولد المحفوظة للتنزيل اللاحق */
export interface ArtifactRecord {
  readonly runId: string;
  readonly tenantId: string;
  /** JSON كامل لـGeneratedServerArtifact {files, toolNames} */
  readonly artifactJson: string;
  readonly createdAt: string;
}

/** حوض صفوف سجل التدقيق — تستهلكه سلسلة الهاش في infra بنيوياً */
export interface AuditSink {
  lastAuditEntry(tenantId: string): Promise<AuditTrailEntry | null>;
  appendAuditEntry(entry: AuditTrailEntry): Promise<void>;
  listAuditEntries(tenantId: string): Promise<readonly AuditTrailEntry[]>;
}

export interface SemanticStore extends AuditSink {
  createTenant(record: TenantRecord): Promise<void>;
  getTenant(tenantId: string): Promise<TenantRecord | null>;

  createProject(record: ProjectRecord): Promise<void>;
  getProject(tenantId: string, projectId: string): Promise<ProjectRecord | null>;
  listProjects(tenantId: string): Promise<readonly ProjectRecord[]>;

  createSpec(record: SpecRecord): Promise<void>;
  getSpec(tenantId: string, specId: string): Promise<SpecRecord | null>;

  upsertPipeline(record: PipelineRecord): Promise<void>;
  getPipeline(tenantId: string, runId: string): Promise<PipelineRecord | null>;
  listPipelines(tenantId: string): Promise<readonly PipelineRecord[]>;

  saveCertificate(record: CertificateRecord): Promise<void>;
  getCertificate(tenantId: string, runId: string): Promise<CertificateRecord | null>;
  /** كل شهادات المستأجر — لتغذية إحصاءات النظرة العامة */
  listCertificates(tenantId: string): Promise<readonly CertificateRecord[]>;
  /**
   * بحث عام برقم التحقق — الاستثناء الثاني الوحيد عن نطاق المستأجر بعد
   * getTenant: رقم التحقق مفتاح طبيعي عالمي فريد تتحقق به أطراف ثالثة
   * عبر صفحة /verify العامة، ولا يكشف سوى قرار الشهادة نفسها (وثيقة security.md §9).
   */
  getCertificateByVerificationId(verificationId: string): Promise<CertificateRecord | null>;

  /**
   * تسجيل إبطال شهادة داخل نطاق مستأجرها. الإلحاق فقط —
   * الإبطال نهائي ولا تحديث ولا حذف (قرار حتمي يوثق في سجل التدقيق أيضاً).
   */
  revokeCertificate(record: CertificateRevocationRecord): Promise<void>;
  /**
   * الاستثناء الثالث الضيق (pre-auth): /verify يقرأ صف الإبطال برقم التحقق
   * حصراً — وجود صف = الشهادة ملغاة بغض النظر عن granted المخزنة.
   */
  getRevocationByVerificationId(verificationId: string): Promise<CertificateRevocationRecord | null>;

  saveArtifact(record: ArtifactRecord): Promise<void>;
  getArtifact(tenantId: string, runId: string): Promise<ArtifactRecord | null>;
}

/**
 * FC — مجموعات التخزين الداخلي مكشوفة كنوع حصري للاختبار ولمحول دورة
 * الحياة: لا يستخدمها أي مسار إنتاج خارج هذا المحول نفسه.
 */
export interface SemanticCollections {
  readonly tenants: Map<string, TenantRecord>;
  readonly projects: Map<string, ProjectRecord>;
  readonly specs: Map<string, SpecRecord>;
  readonly pipelines: Map<string, PipelineRecord>;
  readonly certificates: Map<string, CertificateRecord>;
  readonly certificatesByVerificationId: Map<string, CertificateRecord>;
  readonly revocationsByVerificationId: Map<string, CertificateRevocationRecord>;
  readonly artifacts: Map<string, ArtifactRecord>;
  readonly auditByTenant: Map<string, AuditTrailEntry[]>;
}

export function createSemanticCollections(): SemanticCollections {
  return {
    tenants: new Map(),
    projects: new Map(),
    specs: new Map(),
    pipelines: new Map(),
    certificates: new Map(),
    certificatesByVerificationId: new Map(),
    revocationsByVerificationId: new Map(),
    artifacts: new Map(),
    auditByTenant: new Map(),
  };
}

/** المحول داخل الذاكرة مع عمليات دورة حياة المستأجر */
export type InMemorySemanticStore = SemanticStore & SemanticTenantLifecycle & InMemoryTenantOps;

/** عمليات إدارة داخلية حصراً — التراجع الدقيق عن onboarding الذري */
export interface InMemoryTenantOps {
  /** حذف المستأجر بمعرفه — بوابة التراجع الداخلي لا مسار إنتاج */
  deleteTenant(tenantId: string): Promise<void>;
}

/** محول داخل الذاكرة — مفاتيح مركبة `tenant:id` فالانعزال بنيوي لا اتفاقي */
export function createInMemorySemanticStore(collections: SemanticCollections = createSemanticCollections()): InMemorySemanticStore {
  const { tenants, projects, specs, pipelines, certificates, certificatesByVerificationId, revocationsByVerificationId, artifacts, auditByTenant } = collections;

  return {
    ...semanticLifecycleOver(collections),

    async createTenant(record) {
      tenants.set(record.tenantId, record);
    },
    async getTenant(tenantId) {
      return tenants.get(tenantId) ?? null;
    },
    async deleteTenant(tenantId) {
      tenants.delete(tenantId);
    },

    async createProject(record) {
      projects.set(`${record.tenantId}:${record.projectId}`, record);
    },
    async getProject(tenantId, projectId) {
      return projects.get(`${tenantId}:${projectId}`) ?? null;
    },
    async listProjects(tenantId) {
      return [...projects.values()].filter((project) => project.tenantId === tenantId);
    },

    async createSpec(record) {
      specs.set(`${record.tenantId}:${record.specId}`, record);
    },
    async getSpec(tenantId, specId) {
      return specs.get(`${tenantId}:${specId}`) ?? null;
    },

    async upsertPipeline(record) {
      pipelines.set(`${record.tenantId}:${record.runId}`, record);
    },
    async getPipeline(tenantId, runId) {
      return pipelines.get(`${tenantId}:${runId}`) ?? null;
    },
    async listPipelines(tenantId) {
      return [...pipelines.values()].filter((record) => record.tenantId === tenantId);
    },

    async saveCertificate(record) {
      certificates.set(`${record.tenantId}:${record.runId}`, record);
      certificatesByVerificationId.set(record.verificationId, record);
    },
    async getCertificate(tenantId, runId) {
      return certificates.get(`${tenantId}:${runId}`) ?? null;
    },
    async listCertificates(tenantId) {
      return [...certificates.values()].filter((record) => record.tenantId === tenantId);
    },
    async getCertificateByVerificationId(verificationId) {
      return certificatesByVerificationId.get(verificationId) ?? null;
    },

    async revokeCertificate(record) {
      // الإبطال إلحاق فقط: إبطال مكرر لنفس الرقم يرفض بدل الكتم الصامت
      if (revocationsByVerificationId.has(record.verificationId)) {
        throw new Error(`شهادة ${record.verificationId} ملغاة سابقاً — الإبطال نهائي غير قابل للتكرار`);
      }
      revocationsByVerificationId.set(record.verificationId, record);
    },
    async getRevocationByVerificationId(verificationId) {
      return revocationsByVerificationId.get(verificationId) ?? null;
    },

    async saveArtifact(record) {
      artifacts.set(`${record.tenantId}:${record.runId}`, record);
    },
    async getArtifact(tenantId, runId) {
      return artifacts.get(`${tenantId}:${runId}`) ?? null;
    },

    // ----- سجل التدقيق: إلحاق فقط بترتيب الوصول -----
    async lastAuditEntry(tenantId) {
      const list = auditByTenant.get(tenantId);
      return list !== undefined && list.length > 0 ? (list[list.length - 1] ?? null) : null;
    },
    async appendAuditEntry(entry) {
      const list = auditByTenant.get(entry.tenantId) ?? [];
      list.push(entry);
      auditByTenant.set(entry.tenantId, list);
    },
    async listAuditEntries(tenantId) {
      return [...(auditByTenant.get(tenantId) ?? [])];
    },
  };
}