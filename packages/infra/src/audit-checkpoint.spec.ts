/**
 * اختبارات مرساة رأس سلسلة التدقيق الموقعة.
 *
 * تثبت: (1) توقيع المرساة يتحقق بالرأس المطابق؛ (2) أي قص/إعادة ترتيب/
 * إعادة كتابة بعد التوقيع تُكتشف بعدم تطابق الرأس؛ (3) مرساة مزورة
 * (محتوى عدل بلا إعادة توقيع) ترفض بتوقيع باطل؛ (4) مفتاح آخر لا يتحقق
 * مرساة ليست له — مستوى التحقيق موثق: كشف إعادة كتابة القاعدة، لا
 * ادعاء tamper-proof أمام من يملك المفتاح والقاعدة معاً.
 */

import { describe, expect, it } from "vitest";
import {
  generateCheckpointMaterial,
  loadCheckpointMaterial,
  signCheckpoint,
  verifyCheckpoint,
  type AuditCheckpoint,
} from "../src/audit-checkpoint.js";

const material = generateCheckpointMaterial();

const headAtSigning: AuditCheckpoint = {
  tenantId: "tenant-1",
  seq: 42,
  headHash: "a".repeat(64),
  at: "2026-09-18T12:00:00.000Z",
};

describe("مرساة checkpoint الموقعة", () => {
  it("رأس مطابق بعد التوقيع يتحقق matchesHead=true", () => {
    const signed = signCheckpoint(headAtSigning, material);
    const verdict = verifyCheckpoint(signed, {
      publicKey: material.publicKey,
      currentHead: headAtSigning,
    });
    expect(verdict.ok && verdict.value.matchesHead).toBe(true);
  });

  it("قص/إعادة كتابة بعد التوقيع (رأس أقدم أو مختلف) يكشف بعدم التطابق", () => {
    const signed = signCheckpoint(headAtSigning, material);
    // إعادة كتابة السلسلة لاحقاً غيّرت الرأس: hash جديد
    const rewritten = verifyCheckpoint(signed, {
      publicKey: material.publicKey,
      currentHead: { ...headAtSigning, seq: 10, headHash: "b".repeat(64), at: "2026-09-18T13:00:00.000Z" },
    });
    expect(rewritten.ok && rewritten.value.matchesHead).toBe(false);
    // قص الذيل: نفس hash لكن seq أقل
    const truncated = verifyCheckpoint(signed, {
      publicKey: material.publicKey,
      currentHead: { ...headAtSigning, seq: 20 },
    });
    expect(truncated.ok && truncated.value.matchesHead).toBe(false);
  });

  it("مرساة معدلة بلا إعادة توقيع ترفض AUDIT_CHECKPOINT_BAD_SIGNATURE", () => {
    const signed = signCheckpoint(headAtSigning, material);
    const forged = {
      ...signed,
      checkpoint: { ...signed.checkpoint, seq: 999 },
    };
    const verdict = verifyCheckpoint(forged, {
      publicKey: material.publicKey,
      currentHead: headAtSigning,
    });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.error.code).toBe("AUDIT_CHECKPOINT_BAD_SIGNATURE");
  });

  it("مفتاح مرساة آخر لا يتحقق توقيعاً ليس له — العزل المفتاحي", () => {
    const signed = signCheckpoint(headAtSigning, material);
    const other = generateCheckpointMaterial();
    const verdict = verifyCheckpoint(signed, {
      publicKey: other.publicKey,
      currentHead: headAtSigning,
    });
    expect(verdict.ok).toBe(false);
  });

  it("مفتاح من PKCS8 فاسد يرفض التحميل — لا مفتاح بديل صامت", () => {
    // الدالة نقية تعيد Result — الحاوية ترمي الخطأ قبل الإقلاع
    const result = loadCheckpointMaterial("AAAA");
    expect(result.ok).toBe(false);
  });
});
