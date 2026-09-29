import { Stepper } from "@/components/ui/Stepper";
import { ScoreRing } from "@/components/ui/ScoreRing";
import { Pill } from "@/components/ui/Pill";
import { parseNdjson, summarize, type RunViewModel } from "@/lib/run-model";
import { t } from "@/lib/i18n";
import { normalizeLocale, type Locale } from "@/lib/locale-shared";

/**
 * لقطة أنبوب نموذجية للصفحة الهبوطية — مبنية من مكونات اللوحة الحقيقية نفسها
 * (Stepper/ScoreRing/Pill) فوق أحداث تشغيل مكتمل افتراضي.
 * صدق المنتج: شارة «مثال توضيحي» ظاهرة دائماً فوق اللوحة — لا تُقدَّم
 * كتشغيل حي، ورقم التحقق الافتراضي لا يُفتح على صفحة التحقق.
 */

const DEMO_EVENTS_TEXT = [
  { stage: "load_spec", stageStatus: "completed", summary: "قراءة المواصفة" },
  { stage: "normalize", stageStatus: "completed", summary: "توحيد 23 نقطة نهاية" },
  { stage: "analyze", stageStatus: "completed", summary: "تصنيف وتحليل الخطورة" },
  { stage: "design_tools", stageStatus: "completed", summary: "تصميم 9 أدوات MCP" },
  { stage: "generate_server", stageStatus: "completed", summary: "توليد خادم TypeScript" },
  { stage: "harden", stageStatus: "completed", summary: "اجتياز 14/14 فحصاً أمنياً" },
  { stage: "evaluate", stageStatus: "completed", summary: "تقييم جودة الأدوات" },
  { stage: "certify", stageStatus: "completed", summary: "منح شهادة Agent-Ready" },
]
  .map((event, index) =>
    JSON.stringify({ runId: "demo", tenantId: "demo", at: `2026-08-25T10:0${index}:00.000Z`, ...event }),
  )
  .join("\n");

const demoModel: RunViewModel = summarize(parseNdjson(DEMO_EVENTS_TEXT));

export function PipelineSnapshot({ locale: localeProp }: { locale?: string }) {
  // اللغة من الخاصية إن مرّرت وإلا من كوكي الطلب (الصفحة خادمية)
  const locale: Locale = normalizeLocale(localeProp);
  return (
    <div className="hero-panel fade-up">
      {/* وسم الصدق — يمنع الالتباس بين النموذج والتشغيل الحي */}
      <div className="snapshot-badge-row">
        <span className="demo-badge">◈ {t("marketing.snapshotBadge", locale)}</span>
      </div>
      <div className="hero-panel-head">
        <span className="card-title">{t("marketing.snapshotTitle", locale)}</span>
        <Pill status="completed" />
      </div>
      <Stepper model={demoModel} runIsOver={true} />
      <div className="snapshot-lower">
        <ScoreRing score={94} granted={true} caption="Agent-Ready Verified" />
        <div className="snapshot-tools">
          <div className="mono snapshot-id">AB-7f3c91d2e84b50a6</div>
          <div className="tools-grid">
            <div className="tool-card">
              <div className="name">{t("demo.tool1Name", locale)}</div>
              <div className="desc">{t("demo.tool1Desc", locale)}</div>
              <div className="eps">GET /appointments</div>
            </div>
            <div className="tool-card">
              <div className="name">{t("demo.tool2Name", locale)}</div>
              <div className="desc">{t("demo.tool2Desc", locale)}</div>
              <div className="eps">POST /patients/{"{id}"}/notes</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
