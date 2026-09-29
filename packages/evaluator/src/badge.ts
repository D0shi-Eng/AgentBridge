/**
 * شارة SVG قابلة للتضمين تعكس قرار الشهادة — بديل نظيف عن صور خارجية.
 *
 * حتمية 100%: نفس الشهادة = نفس الـSVG بايت ببايت، فتصلح للتضمين
 * في README العميل ومقارنتها بالنسخة المرجعية عند التحقق.
 *
 * خيار `verifyUrl` يلف الشارة برابط لصفحة التحقق العامة —
 * من دون الخيار يبقى الناتج مطابقاً بايت-ببايت للنسخ السابقة (توافق خلفي).
 */

import type { Certificate } from "@agentbridge/shared";

export interface BadgeOptions {
  /** رابط صفحة التحقق العام — يُلف به SVG كاملاً كعنصر <a> */
  readonly verifyUrl?: string;
}

/** عرض النص التقريبي بخط SVG الافتراضي لتحجيم المستطيلات */
function textWidth(text: string): number {
  return Math.round(text.length * 6.5) + 12;
}

/** يهرّب محارف XML الأساسية في القيم المدرجة نصياً */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function badgeSvg(certificate: Certificate): string {
  const label = "Agent-Ready";
  const message = certificate.granted
    ? `verified ${certificate.finalScore}/100`
    : `rejected ${certificate.finalScore}/100`;
  const color = certificate.granted ? "#0a7d33" : "#b91c1c";
  const leftWidth = textWidth(label);
  const rightWidth = textWidth(message);
  const totalWidth = leftWidth + rightWidth;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${totalWidth}" height="20" role="img" aria-label="${label}: ${message}">
  <linearGradient id="s" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <clipPath id="r"><rect width="${totalWidth}" height="20" rx="3" fill="#fff"/></clipPath>
  <g clip-path="url(#r)">
    <rect width="${leftWidth}" height="20" fill="#555"/>
    <rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${color}"/>
    <rect width="${totalWidth}" height="20" fill="url(#s)"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,Geneva,DejaVu Sans,sans-serif" font-size="11">
    <text x="${Math.round(leftWidth / 2)}" y="14">${label}</text>
    <text x="${leftWidth + Math.round(rightWidth / 2)}" y="14">${message}</text>
  </g>
</svg>
`;
}

export function renderBadge(certificate: Certificate, options?: BadgeOptions): string {
  const svg = badgeSvg(certificate);
  if (options?.verifyUrl === undefined) return svg;
  return `<a xmlns="http://www.w3.org/2000/svg" href="${escapeXml(options.verifyUrl)}" target="_blank" rel="noopener">
${svg}</a>
`;
}
