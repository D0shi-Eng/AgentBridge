import { describe, expect, it } from "vitest";
import { MockLlmProvider } from "./mock-provider.js";

const requestOf = (content: string) => ({
  system: "نظام",
  messages: [{ role: "user" as const, content }],
});

describe("MockLlmProvider — المحول الحتمي", () => {
  it("يستهلك الطابور بالترتيب", async () => {
    const provider = new MockLlmProvider({ responses: ["أول", "ثانٍ"] });
    const first = await provider.complete(requestOf("س"));
    const second = await provider.complete(requestOf("ص"));

    expect(first.ok && first.value.text).toBe("أول");
    expect(second.ok && second.value.text).toBe("ثانٍ");
  });

  it("يجلب اسم mock في كل استجابة لأغراض التدقيق", async () => {
    const provider = new MockLlmProvider({ responses: ["نص"] });
    const result = await provider.complete(requestOf("س"));
    expect(result.ok && result.value.provider).toBe("mock");
  });

  it("يلجأ لدالة الاستجابة النقية بعد نضوب الطابور", async () => {
    const provider = new MockLlmProvider({
      respond: (req) => `صدى: ${req.messages[0]?.content ?? ""}`,
    });
    const result = await provider.complete(requestOf("مرحى"));
    expect(result.ok && result.value.text).toBe("صدى: مرحى");
  });

  it("يزرع enqueue استجابات لاحقة دون إعادة بناء", async () => {
    const provider = new MockLlmProvider();
    provider.enqueue("متأخرة");
    const result = await provider.complete(requestOf("س"));
    expect(result.ok && result.value.text).toBe("متأخرة");
  });

  it("يفشل خطأً منظماً عندما تنضب كل المصادر", async () => {
    const provider = new MockLlmProvider();
    const result = await provider.complete(requestOf("س"));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("LLM_EMPTY_RESPONSE");
      expect(result.error.retryable).toBe(true);
    }
  });

  it("حتمية كاملة: نفس الطلب على دالة نقية يعطي نفس النص", async () => {
    const provider = new MockLlmProvider({ respond: () => "ثابت" });
    const a = await provider.complete(requestOf("x"));
    const b = await provider.complete(requestOf("y"));
    expect(a.ok && a.value.text).toBe(b.ok && b.value.text);
  });
});
