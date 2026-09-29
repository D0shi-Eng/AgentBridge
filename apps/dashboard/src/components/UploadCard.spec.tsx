/**
 * اختبارات UploadCard — تفاعل/RTL/حالات فراغ.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { UploadCard } from "./UploadCard";
import { TestProviders } from "@/test/locale-wrapper";

vi.mock("@/lib/api-client", () => ({
  api: {
    uploadSpec: vi.fn(async () => ({ specId: "s1" })),
    startPipeline: vi.fn(async () => ({ runId: "r1" })),
  },
}));

function Wrapper(props: { children: React.ReactNode }) {
  return <TestProviders>{props.children}</TestProviders>;
}

describe("UploadCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("يعرض المشاريع ويبدأ تشغيلاً عند لصق محتوى", async () => {
    const onStarted = vi.fn();
    render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "عيادات" }]} onStarted={onStarted} />
      </Wrapper>,
    );
    expect(screen.getByText("عيادات")).toBeInTheDocument();
    const textarea = screen.getByPlaceholderText(/openapi/i);
    fireEvent.change(textarea, { target: { value: 'openapi: "3.0.3"' } });
    fireEvent.click(screen.getByText("ابدأ التشغيل"));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("r1"));
  });

  it("يظهر خطأ عند محتوى فارغ", async () => {
    const onStarted = vi.fn();
    render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "عيادات" }]} onStarted={onStarted} />
      </Wrapper>,
    );
    fireEvent.click(screen.getByText("ابدأ التشغيل"));
    await waitFor(() => expect(screen.getByText(/ألصق أو ارفع/)).toBeInTheDocument());
    expect(onStarted).not.toHaveBeenCalled();
  });

  it("حالة فراغ المشاريع: زر معطل", () => {
    render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[]} onStarted={vi.fn()} />
      </Wrapper>,
    );
    expect(screen.getByText("ابدأ التشغيل").closest("button")?.disabled).toBe(true);
  });

  it("مشاريع تصل بعد التركيب بقائمة فارغة: الاختيار يُزامن تلقائياً والبدء ينجح بلا لمس القائمة", async () => {
    // سيناريو التثبيت النظيف الحقيقي: اللوحة تركب بلا مشاريع، ثم يُنشأ الأول —
    // كان الرفض يقع بـ«اختر مشروعاً أولاً» رغم ظهور المشروع منتقاً في القائمة
    const onStarted = vi.fn();
    const { rerender } = render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[]} onStarted={onStarted} />
      </Wrapper>,
    );
    rerender(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "عيادات" }]} onStarted={onStarted} />
      </Wrapper>,
    );
    const textarea = screen.getByPlaceholderText(/openapi/i);
    fireEvent.change(textarea, { target: { value: 'openapi: "3.0.3"' } });
    fireEvent.click(screen.getByText("ابدأ التشغيل"));
    await waitFor(() => expect(onStarted).toHaveBeenCalledWith("r1"));
  });

  it("اختفاء المشروع المختار (حذف): يعود الاختيار لأول متاح تلقائياً", async () => {
    const onStarted = vi.fn();
    const { rerender } = render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "أول" }, { projectId: "p2", name: "ثانٍ" }]} onStarted={onStarted} />
      </Wrapper>,
    );
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "p2" } });
    rerender(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "أول" }]} onStarted={onStarted} />
      </Wrapper>,
    );
    await waitFor(() => expect(screen.getByRole("combobox")).toHaveValue("p1"));
  });

  it("يرفض ملفاً أكبر من 512KB", async () => {
    render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "عيادات" }]} onStarted={vi.fn()} />
      </Wrapper>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const large = new File([new Uint8Array(600 * 1024)], "big.yaml", { type: "text/yaml" });
    fireEvent.change(input, { target: { files: [large] } });
    await waitFor(() => expect(screen.getByText(/أكبر من الحد/)).toBeInTheDocument());
  });

  it("يقبل ملفاً صغيراً ويملأ النص", async () => {
    render(
      <Wrapper>
        <UploadCard creds={{ tenantId: "t1" }} projects={[{ projectId: "p1", name: "عيادات" }]} onStarted={vi.fn()} />
      </Wrapper>,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const small = new File(['openapi: "3.0.3"'], "small.yaml", { type: "text/yaml" });
    // jsdom قد لا يطبق text() افتراضياً — نحقنها
    (small as unknown as { text: () => Promise<string> }).text = async () => 'openapi: "3.0.3"';
    fireEvent.change(input, { target: { files: [small] } });
    await waitFor(() => expect(screen.getByDisplayValue('openapi: "3.0.3"')).toBeInTheDocument());
  });
});
