/** تحقق عقد DNS الأصلي مع Resolver اصطناعي يدعم cancel؛ دون أي استعلام خارجي. */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveDestination } from "./resolver.js";
const mocks = vi.hoisted(() => ({ v4: vi.fn(), v6: vi.fn(), cancel: vi.fn() }));
vi.mock("node:dns/promises", () => ({ Resolver: class {
  resolve4 = mocks.v4;
  resolve6 = mocks.v6;
  cancel = mocks.cancel;
} }));
beforeEach(() => {
  vi.resetAllMocks();
  mocks.v4.mockResolvedValue(["8.8.8.8"]);
  mocks.v6.mockResolvedValue(["2606:4700::1111"]);
});
describe("حل الوجهة", () => {
  it("يجمع A/AAAA ويحفظ family", async () => {
    expect(await resolveDestination("idp.example", new AbortController().signal)).toEqual([
      { address: "8.8.8.8", family: 4 }, { address: "2606:4700::1111", family: 6 },
    ]);
  });
  it("العنوان الحرفي لا يحل DNS", async () => {
    expect(await resolveDestination("8.8.8.8", new AbortController().signal)).toEqual([{ address: "8.8.8.8", family: 4 }]);
    expect(mocks.v4).not.toHaveBeenCalled();
  });
  it("غياب AAAA مقبول ولكن فشل DNS الجزئي مرفوض", async () => {
    mocks.v6.mockRejectedValue(Object.assign(new Error(), { code: "ENODATA" }));
    expect(await resolveDestination("idp.example", new AbortController().signal)).toHaveLength(1);
    mocks.v6.mockRejectedValue(Object.assign(new Error(), { code: "ESERVFAIL" }));
    await expect(resolveDestination("idp.example", new AbortController().signal)).rejects.toThrow();
  });
  it("إلغاء المستدعي يلغي resolver ويرفض النتائج المتأخرة", async () => {
    const abort = new AbortController();
    const pending = resolveDestination("idp.example", abort.signal);
    abort.abort();
    await expect(pending).rejects.toThrow();
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    await expect(resolveDestination("idp.example", abort.signal)).rejects.toThrow();
  });
});
