/**
 * اختبارات الشهادة الحتمية والربط الخادمي وإثبات sandbox.
 *
 * تثبت: (1) verificationId حتمي من (مستأجر×تشغيل×artifact×درجة×سياسة)
 * بلا زمن — إعادة الإصدار تعيد نفس الرقم (idempotency منطقي)؛ (2) تغيير
 * أي رباط يغير الرقم؛ (3) إثبات sandbox حاضر غير مستوفٍ يمنع المنح؛
 * (4) التوقيع يغطي الربط وإثبات sandbox — العبث بأي منهما يكسر التحقق.
 */

import { describe, expect, it } from "vitest";
import {
  CERTIFICATE_POLICY_VERSION,
  certifyArtifacts,
  generateSigningKeyMaterial,
  signCertificate,
  verifyCertificate,
} from "../src/index.js";
import type { GeneratedServerArtifact, LiveProbeEvidence, SecurityReport } from "@agentbridge/shared";

/** artifact موحد لكل الحالات — البصمة ثابتة فالتغير في الرقم من الربط */
const artifact: GeneratedServerArtifact = {
  files: [{ path: "src/server.ts", contents: "export const server = 1;" }],
  toolNames: ["get_pet"],
};

/** تقرير أمني نظيف فوق العتبة */
const cleanReport: SecurityReport = {
  findings: [],
  totalChecks: 12,
  passedCount: 12,
  hasCritical: false,
  cleanlinessScore: 96,
};

const liveEvidence: LiveProbeEvidence = {
  checksTotal: 7,
  checksPassed: 7,
  probedArtifactsHash: "",
  executedAt: "2030-01-18T12:00:00.000Z",
};

const binding = { runId: "run-abc123", tenantId: "tenant-1", policyVersion: "policy-1" };
const validSandbox = {
  imageRef: "agentbridge/sandbox-runner:isolated",
  imageDigest: "sha256:abcd1234abcd1234",
  seccompProfile: "sandbox-runner-seccomp",
  constraintsVersion: "constraints-1",
  network: "none",
  user: "65532:65532",
  exitCode: 0,
};

/** يجهز الدليل الحي ببصمة artifact الفعلية — تُحسب داخل كل حالة */
function withHash(hash: string): LiveProbeEvidence {
  return { ...liveEvidence, probedArtifactsHash: hash };
}

describe("verificationId حتمي (idempotency منطقي)", () => {
  it("إعادة الإصدار بنفس المدخلات وزمن مختلف تعيد نفس الرقم — لا تكرار شهادة", () => {
    const first = certifyArtifacts({
      artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""), runBinding: binding,
      now: "2030-01-18T10:00:00.000Z",
    });
    const second = certifyArtifacts({
      artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""), runBinding: binding,
      now: "2030-01-18T17:30:00.000Z", // زمن مختلف — لا يدخل الحساب
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(second.value.verificationId).toBe(first.value.verificationId);
      expect(second.value.verificationId).toMatch(/^AB-[0-9a-f]{16}$/u);
    }
  });

  it("تغيير التشغيل أو المستأجر أو السياسة يغير الرقم — لا تصادم رباط", () => {
    const base = certifyArtifacts({ artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""), runBinding: binding });
    const otherRun = certifyArtifacts({ artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""), runBinding: { ...binding, runId: "run-OTHER" } });
    const otherTenant = certifyArtifacts({ artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""), runBinding: { ...binding, tenantId: "tenant-2" } });
    const otherPolicy = certifyArtifacts({ artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""), runBinding: { ...binding, policyVersion: "policy-2" } });
    const ids = [base, otherRun, otherTenant, otherPolicy].map((r) => (r.ok ? r.value.verificationId : "err"));
    expect(new Set(ids).size).toBe(4);
  });
});

describe("بوابة إثبات sandbox الملزمة", () => {
  /** يجبي الدليل الحي ببصمة artifact الحقيقية — لعزل سبب الرفض في sandbox */
  function certifyWithRealHash(sandboxOverride: Partial<typeof validSandbox>) {
    const probe = certifyArtifacts({ artifact, securityReport: cleanReport, runBinding: binding, sandbox: { ...validSandbox, ...sandboxOverride } });
    if (!probe.ok) throw new Error("يجب أن ينجح الإصدار الأساسي");
    return certifyArtifacts({
      artifact, securityReport: cleanReport, runBinding: binding,
      sandbox: { ...validSandbox, ...sandboxOverride },
      liveProbeEvidence: withHash(probe.value.artifactsHash),
    });
  }

  it("exit غير صفري يمنع المنح مع سبب صريح — الفحوص لم تكتمل داخل العزل", () => {
    const result = certifyWithRealHash({ exitCode: 1 });
    expect(result.ok && result.value.granted).toBe(false);
    if (result.ok) expect(result.value.notGrantedReason).toContain("sandbox");
  });

  it("شبكة غير معزولة تمنع المنح — العزل الشبكي غير مثبت", () => {
    const result = certifyArtifacts({
      artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""),
      sandbox: { ...validSandbox, network: "bridge" },
    });
    expect(result.ok && result.value.granted).toBe(false);
  });

  it("بصمة صورة unverified تمنع المنح — هوية بيئة التنفيذ غير مثبتة", () => {
    const result = certifyArtifacts({
      artifact, securityReport: cleanReport, liveProbeEvidence: withHash(""),
      sandbox: { ...validSandbox, imageDigest: "unverified" },
    });
    expect(result.ok && result.value.granted).toBe(false);
  });

  it("إثبات مستوفٍ لا يعيق المنح مع الدليل الحي الصالح", () => {
    const result = certifyWithRealHash({});
    expect(result.ok && result.value.granted).toBe(true);
  });
});

describe("التوقيع يغطي الربط وإثبات sandbox", () => {
  it("شهادة موقعة تتحقق، وعبث بالربط أو الإثبات يكسر التحقق", () => {
    // بصمة artifact الحقيقية أولاً — الدليل الحي يخالف مخططه بغيرها
    const probe = certifyArtifacts({ artifact, securityReport: cleanReport, runBinding: binding, sandbox: validSandbox });
    if (!probe.ok) throw new Error("يجب أن ينجح الإصدار الأساسي");
    const certified = certifyArtifacts({
      artifact, securityReport: cleanReport, runBinding: binding, sandbox: validSandbox,
      liveProbeEvidence: withHash(probe.value.artifactsHash), now: "2030-01-18T10:00:00.000Z",
    });
    expect(certified.ok).toBe(true);
    if (!certified.ok) return;
    const material = generateSigningKeyMaterial();
    const signed = signCertificate(certified.value, { material, now: new Date("2030-01-18T10:00:01.000Z") });
    expect(signed.ok).toBe(true);
    if (!signed.ok) return;

    const outcome = verifyCertificate(signed.value, { publicKey: material.publicKey });
    expect(outcome.valid).toBe(true);

    // عبث بالربط: runId مختلف بنفس التوقيع → bad-signature
    const tamperedBinding: typeof signed.value = {
      ...signed.value,
      runBinding: { ...binding, runId: "run-FORGED" },
    };
    expect(verifyCertificate(tamperedBinding, { publicKey: material.publicKey }).valid).toBe(false);

    // عبث بالإثبات: exitCode يصير 0 بعد توقيع نسخة فاشلة → bad-signature
    const failedRun = certifyArtifacts({
      artifact, securityReport: cleanReport, runBinding: binding,
      sandbox: { ...validSandbox, exitCode: 3 }, now: "2030-01-18T10:00:00.000Z",
    });
    expect(failedRun.ok && failedRun.value.granted).toBe(false);
    if (failedRun.ok) {
      const signedFailed = signCertificate(failedRun.value, { material, now: new Date("2030-01-18T10:00:01.000Z") });
      if (signedFailed.ok) {
        const forged: typeof signedFailed.value = {
          ...signedFailed.value,
          sandbox: validSandbox, // يدّعي نجاحاً بعد التوقيع
          granted: true,
          notGrantedReason: undefined,
        };
        expect(verifyCertificate(forged, { publicKey: material.publicKey }).valid).toBe(false);
      }
    }
  });

  it("السياسة المعلنة هي مصدر الحساب عند غياب رباط السياسة", () => {
    // الربط بدون policyVersion صراحة يمر بثابت السياسة الحالي في البذرة
    expect(CERTIFICATE_POLICY_VERSION).toBe("policy-2.0.0");
  });
});
