/**
 * أنواع DTO للوحة — العقد الظاهر للمكوّنات منفصل عن نفق الطلبات.
 * كل حقل محسن للقراءة فقط حفاظاً على عدالة الحالة.
 */

export interface ProjectDto {
  projectId: string;
  name: string;
}
export interface RunListItemDto {
  runId: string;
  status: string;
  createdAt: string;
}
export interface StatusDto {
  runId: string;
  status: string;
  stoppedAt?: string;
  repairCyclesUsed: number;
}
export interface ToolDto {
  name: string;
  description: string;
  endpointIds: string[];
  parameters: string[];
}
export interface CertificateDto {
  verificationId: string;
  artifactsHash: string;
  finalScore: number;
  granted: boolean;
  issuedAt: string;
  /** سبب عدم المنح كما يصدره الخادم — لا يُعرض خام؛ يُترجم من الرمز  */
  notGrantedReason?: string;
  /** الرمز الهيكلي للسبب — مصدر الترجمة الوحيد في الواجهة */
  notGrantedReasonCode?: string;
}

/** بطاقات إحصاء المستأجر — مصدرها GET /stats في الخادم */
export interface TenantStatsDto {
  totalRuns: number;
  activeRuns: number;
  grantedCertificates: number;
  avgFinalScore: number | null;
  lastRunAt: string | null;
}
