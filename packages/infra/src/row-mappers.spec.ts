/**
 * اختبارات مبدئو صفوف L2 — دورات كاملة سجل↔سجلة بلا فقدان ولا انحراف.
 */
import { describe, expect, it } from "vitest";
import {
  auditEntryFromRow,
  auditEntryToRow,
  certificateFromRow,
  certificateToRow,
  pipelineFromRow,
  pipelineToRow,
  projectFromRow,
  projectToRow,
  specFromRow,
  specToRow,
} from "./row-mappers.js";

describe("مبدئو الصفوف", () => {
  it("مشروع: دورة كاملة تحفظ الحقول وتحوّل الزمن إلى Date وعكسها", () => {
    const record = { projectId: "p1", tenantId: "t1", name: "عيادات", createdAt: "2026-08-24T10:00:00.000Z" };
    const row = projectToRow(record);
    expect(row.tenant_id).toBe("t1");
    expect(row.created_at).toBeInstanceOf(Date);
    expect(projectFromRow(row)).toEqual(record);
  });

  it("مواصفة: النص الخام يمر كما هو", () => {
    const record = { specId: "s1", tenantId: "t1", projectId: "p1", content: "openapi: 3.0.3", createdAt: "2026-01-01T00:00:00.000Z" };
    expect(specFromRow(specToRow(record))).toEqual(record);
  });

  it("تشغيل: stoppedAt اختياري يعالج null في الاتجاهين", () => {
    const base = {
      runId: "r1",
      tenantId: "t1",
      projectId: "p1",
      specId: "s1",
      status: "completed",
      repairCyclesUsed: 2,
      createdAt: "2026-08-24T10:00:00.000Z",
      updatedAt: "2026-08-24T11:00:00.000Z",
    };
    expect(pipelineFromRow(pipelineToRow(base))).toEqual(base);

    // stoppedAt دلالته اسم المرحلة لا طابع زمني — كما ينتجه المنسق فعلاً
    const suspended = { ...base, status: "suspended", stoppedAt: "evaluate" };
    expect(pipelineFromRow(pipelineToRow(suspended))).toEqual(suspended);
    expect(pipelineToRow(base).stopped_at).toBeNull();
  });

  it("شهادة: الدرجة والقرار ونص الشهابة الكامل تمر دون تغيير", () => {
    const record = {
      runId: "r1",
      tenantId: "t1",
      finalScore: 96,
      granted: true,
      verificationId: "AB-abcdef0123456789",
      certificateJson: '{"granted":true}',
      issuedAt: "2026-08-24T12:00:00.000Z",
    };
    expect(certificateFromRow(certificateToRow(record))).toEqual(record);
  });

  it("صف تدقيق: زمن ISO ↔ Date والحقول الثمانية الأخرى ثابتة", () => {
    const entry = {
      seq: 7,
      tenantId: "t1",
      runId: "r1",
      stage: "certify" as const,
      decision: "completed",
      abstractedPayload: "ملخص مجرد",
      at: "2026-08-24T13:00:00.000Z",
      prevHash: "a".repeat(64),
      hash: "b".repeat(64),
    };
    const row = auditEntryToRow(entry);
    expect(row.at).toBeInstanceOf(Date);
    expect(auditEntryFromRow(row)).toEqual(entry);
  });
});
