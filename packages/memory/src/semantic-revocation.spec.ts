/**
 * اختبارات منفذ الذاكرة الدلالية: إبطال الشهادة
 * إلحاق فقط (تكراره يرفض)، والقراءة بالرقم تعيد الصف حصراً، والانعزال
 * بنيوي بمفاتيح مركبة. يرفع تغطية semantic-store للعمليات الجديدة.
 */

import { describe, expect, it } from "vitest";
import { createInMemorySemanticStore } from "./semantic-store.js";

describe("إبطال الشهادات في المخزن الدلالي", () => {
  const record = {
    tenantId: "t-revoke",
    runId: "run-1",
    verificationId: "AB-0123456789abcdef",
    reason: "سبب اصطناعي للاختبار",
    revokedAt: new Date().toISOString(),
  };

  it("الإبطال يلحق ويعاد قراءته بالرقم حصراً", async () => {
    const store = createInMemorySemanticStore();
    expect(await store.getRevocationByVerificationId(record.verificationId)).toBeNull();
    await store.revokeCertificate(record);
    const loaded = await store.getRevocationByVerificationId(record.verificationId);
    expect(loaded?.tenantId).toBe(record.tenantId);
    expect(loaded?.reason).toBe(record.reason);
    expect(await store.getRevocationByVerificationId("AB-ffffffffffffffff")).toBeNull();
  });

  it("إبطال مكرر يرفض — القرار نهائي غير قابل لإعادة الكتابة", async () => {
    const store = createInMemorySemanticStore();
    await store.revokeCertificate(record);
    await expect(store.revokeCertificate(record)).rejects.toThrow();
    // الصف الأصلي لم يُستبدل
    const loaded = await store.getRevocationByVerificationId(record.verificationId);
    expect(loaded?.revokedAt).toBe(record.revokedAt);
  });
});
