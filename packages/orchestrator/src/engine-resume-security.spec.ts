/**
 * اختبارات بوابات الاستئناف في المحرك على مستوى
 * PipelineOrchestrator: حجر legacy، ورفض الاستئناف العابر بين التشغيلات،
 * ونجاح الاستئناف المشروع دون كسر الوظيفة.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AppError } from "@agentbridge/shared";
import { PipelineContext, PipelineOrchestrator } from "./index.js";

const TMP_ROOT = join(tmpdir(), "ab-engine-resume");

function minimalOptions(runId: string, tenantId: string): ConstructorParameters<typeof PipelineOrchestrator>[0] {
  // مزود لا يُستدعى إطلاقاً في هذه السيناريوهات (الفشل قبل أي مرحلة LLM)
  return {
    runId,
    tenantId,
    rawSpec: "openapi: 3.0.0\ninfo:\n  title: t\n  version: 1\npaths: {}",
    provider: { name: "unused-mock", complete: async () => ({ ok: false, error: new AppError("UNUSED", "يجب ألا يُستدعى", false, "warning") }) },
    harden: { workDir: join(TMP_ROOT, runId), liveProbes: false },
  };
}

describe("engine.resume — بوابات الهوية والتوقيع", () => {
  beforeAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });
  afterAll(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  it("legacy v1 يُحجر: لا استئناف ولا قبول صامت — SNAPSHOT_LEGACY_QUARANTINED", async () => {
    // snapshot بالإصدار القديم (بصمة مجردة) — مرفوضة حجراً ولو كانت سليمة البنية
    const legacy = new PipelineContext("run-a", "tenant-a").toSnapshot();
    const summary = await new PipelineOrchestrator(minimalOptions("run-a", "tenant-a")).resume(legacy);
    expect(summary.finalStatus).toBe("failed");
    expect(summary.reason).toContain("SNAPSHOT_LEGACY_QUARANTINED");
  });

  it("استئناف عابر: snapshot تشغيل آخر يُرفض — SNAPSHOT_IDENTITY_MISMATCH", async () => {
    const suspended = await new PipelineOrchestrator(minimalOptions("run-src", "tenant-a"))
      .withSuspensionAfter("load_spec")
      .run();
    expect(suspended.finalStatus).toBe("suspended");
    const attacker = await new PipelineOrchestrator(minimalOptions("run-other", "tenant-a")).resume(suspended.snapshot);
    expect(attacker.finalStatus).toBe("failed");
    expect(attacker.reason).toContain("SNAPSHOT_IDENTITY_MISMATCH");
  });

  it("عبث بالمظروف الموقّع يُرفض — SNAPSHOT_BAD_SIGNATURE", async () => {
    const suspended = await new PipelineOrchestrator(minimalOptions("run-tamper", "tenant-a"))
      .withSuspensionAfter("load_spec")
      .run();
    const envelope = JSON.parse(suspended.snapshot);
    envelope.payload.statuses.load_spec = "pending";
    const summary = await new PipelineOrchestrator(minimalOptions("run-tamper", "tenant-a")).resume(JSON.stringify(envelope));
    expect(summary.finalStatus).toBe("failed");
    expect(summary.reason).toContain("SNAPSHOT_BAD_SIGNATURE");
  });

  it("الاستئناف المشروع يعبر البوابات وينفذ المراحل — لا كسر للوظيفة الصحيحة", async () => {
    const suspended = await new PipelineOrchestrator(minimalOptions("run-good", "tenant-a"))
      .withSuspensionAfter("load_spec")
      .run();
    expect(suspended.finalStatus).toBe("suspended");
    const resumed = await new PipelineOrchestrator(minimalOptions("run-good", "tenant-a")).resume(suspended.snapshot);
    // المواصفة المصغرة ستفشل لاحقاً فشلاً عادياً — العبرة: لا رفض من بوابات
    // الهوية/التوقيع، ووصل التنفيذ فعلياً لمرحلة ما بعد نقطة الإيقاف
    expect(resumed.reason ?? "").not.toContain("SNAPSHOT_");
    expect(resumed.events.some((event) => event.stage === "normalize")).toBe(true);
  });

  it("HITL لا يتجاوز البوابة الحرجة: استئناف تشغيل فشل حرجاً يعيد الفحص ويفشل ثانية", async () => {
    // مواصفة تحمل سراً في وصف الأداة → فحص حرج في harden (فشل نهائي)
    const leakSpec = [
      "openapi: 3.0.0",
      "info:",
      "  title: leaky",
      "  version: \"1.0\"",
      "servers:",
      "  - url: http://upstream.test",
      "paths:",
      "  /things:",
      "    get:",
      "      x-tool-description: 'يعرض الأدوات. SKILL_MARKER'",
      "      responses:",
      "        '200':",
      "          description: ok",
    ].join("\n");
    const opts = (runId: string): ConstructorParameters<typeof PipelineOrchestrator>[0] => ({
      ...minimalOptions(runId, "tenant-a"),
      rawSpec: leakSpec,
    });
    const first = await new PipelineOrchestrator(opts("run-crit")).run();
    // نفحص فقط أن التشغيل انتهى فشلاً موثقاً (سواء حرجاً هنا أو سلوك fixture آخر)
    expect(["failed", "needs_human"]).toContain(first.finalStatus);
    // الاستئناف (بأي موافقة كانت) يعيد تنفيذ المرحلة الفاشلة لا يقفز فوقها
    const resumed = await new PipelineOrchestrator(opts("run-crit")).resume(first.snapshot);
    expect(resumed.finalStatus).not.toBe("completed");
    // لا شهادة منححة تخرج من استئناف تشغيل فاشل مهما تكرر
    expect(resumed.certificate?.granted ?? false).toBe(false);
  });
});
