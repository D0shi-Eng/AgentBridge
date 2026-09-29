/**
 * اختبارات الشارة — حتمية كاملة وانعكاس صادق لقرار الشهادة.
 */

import { describe, expect, it } from "vitest";
import type { Certificate } from "@agentbridge/shared";
import { renderBadge } from "./badge.js";

const GRANTED: Certificate = {
  verificationId: "AB-0123456789abcdef",
  artifactsHash: "deadbeef",
  finalScore: 100,
  granted: true,
  issuedAt: "2026-08-23T00:00:00.000Z",
};

const REJECTED: Certificate = { ...GRANTED, granted: false, finalScore: 40 };

describe("renderBadge", () => {
  it("شارة المنح تحمل الدرجة وكلمة verified ولون النجاح", () => {
    const svg = renderBadge(GRANTED);
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("verified 100/100");
    expect(svg).toContain("#0a7d33");
    expect(svg.trimEnd().endsWith("</svg>")).toBe(true);
  });

  it("شارة الرفض تعكس الحالة بلون التحذير", () => {
    const svg = renderBadge(REJECTED);
    expect(svg).toContain("rejected 40/100");
    expect(svg).toContain("#b91c1c");
    expect(svg).not.toContain("verified");
  });

  it("نفس الشهادة = نفس الـSVG بايت ببايت (قابل للتحقق بالمقارنة)", () => {
    expect(renderBadge(GRANTED)).toBe(renderBadge(GRANTED));
  });

  it("بلا خيارات يبقى الناتج بلا عنصر لفّ خارجي — توافق خلفي بايت-ببايت", () => {
    // النسخة الأساسية للشارة لا تلفها بأي عنصر خارجي
    expect(renderBadge(GRANTED).startsWith("<svg")).toBe(true);
    expect(renderBadge(GRANTED)).not.toContain("<a ");
  });

  it("verifyUrl يلف الشارة برابط صفحة التحقق ويهرّب محارف XML", () => {
    const svg = renderBadge(GRANTED, { verifyUrl: `https://ab.io/verify/${GRANTED.verificationId}` });
    expect(svg.startsWith('<a xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('href="https://ab.io/verify/AB-0123456789abcdef"');
    expect(svg).toContain('target="_blank"');
    expect(svg.trimEnd().endsWith("</a>")).toBe(true);
    const hostile = renderBadge(GRANTED, { verifyUrl: 'https://x.io/" onclick="evil()' });
    expect(hostile).not.toContain('" onclick="evil()');
    expect(hostile).toContain("&quot; onclick=&quot;evil()");
  });
});
