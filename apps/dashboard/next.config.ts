/**
 * إعداد Next.js — كل نداءات اللوحة تمر عبر وكيل داخلي إلى apps/api،
 * فلا CORS ولا تسريب مفاتيح في الشبكة العامة: المتصفح يرى /api فقط.
 *
 * الترويسات الأساسية صارت على كل مسارات اللوحة (كانت على مسارات
 * اللوحة الداخلية فقط فتُركت اللاندينج و/verify بلا حماية)؛ CSP للوثائق
 * يصدره middleware بـnonce، فلا تكرار هنا.
 *
 * ملاحظة تشغيلية موثقة: `next start` يقرأ rewrites من لقطة البناء
 * (required-server-files.json) — تغيير AGENTBRIDGE_API_ORIGIN بعد البناء
 * لا أثر له؛ أي جولة تعيد البناء بقيمة البيئة أولاً.
 */
import type { NextConfig } from "next";

const API_ORIGIN = process.env.AGENTBRIDGE_API_ORIGIN ?? "http://127.0.0.1:3000";

/** ترويسات الحدود لكل الاستجابات — ثابتة لا تعتمد على المسار */
const SECURITY_HEADERS = [
  { key: "Cache-Control", value: "private, no-store" },
  { key: "Referrer-Policy", value: "no-referrer" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

/**
 * دليل البناء قابل للعزل: الافتراض `.next` كما هو؛ أما عند
 * ضبط AGENTBRIDGE_NEXT_DIST فيبني في دليل منفصل كي لا يُزعج خادم
 * `next start` حيًّا يعمل من .next نفسه (بنية تحقق موازية دون لمس بيئة
 * التشغيل القائمة). `next start` يحتاج ضبط المتغير ذاته عند الإقلاع.
 */
const DIST_DIR = process.env.AGENTBRIDGE_NEXT_DIST ?? ".next";

const nextConfig: NextConfig = {
  distDir: DIST_DIR,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_ORIGIN}/:path*` }];
  },
};

export default nextConfig;
