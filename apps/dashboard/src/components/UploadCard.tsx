"use client";

/**
 * بطاقة رفع المواصفة وبدء التشغيل — قلب رحلة العميل.
 * الرفع بالزر (لوحة مفاتيح) وبالسحب والإفلات معاً، والحد والأنواع معلنة
 * نصاً، واسم الملف يعرض داخل bdi كي لا يكسر bidi التخطيط (وثيقة 05).
 * المحتوى يُرسل نصاً للتحليل حصراً — لا تنفيذ ولا معاينة محلية.
 */

import React, { useEffect, useRef, useState } from "react";
import { api, type Credentials } from "@/lib/api-client";
import { apiErrorMessage, t, useLocale } from "@/lib/i18n";
import { Button } from "@/components/ui/Button";
import { useToast } from "@/components/ui/ToastProvider";

const MAX_BYTES = 512 * 1024;

export function UploadCard(props: {
  creds: Credentials;
  projects: Array<{ projectId: string; name: string }>;
  onStarted: (runId: string) => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [projectId, setProjectId] = useState(props.projects[0]?.projectId ?? "");
  // مزامنة الاختيار مع قائمة المشاريع المتغيرة: التركيب بقائمة فارغة (تثبيت
  // جديد) ثم إنشاء أول مشروع يجعل المتصفح يعرض أول خيار بصرياً بينما تبقى
  // الحالة فارغة فيرفض البدء بـ«اختر مشروعاً أولاً» رغم الانتقاء الظاهر —
  // النظام: الحالة تتبع أول مشروع متاح، وإن اختفى المختار (حذف) عُدنا لأول متاح
  useEffect(() => {
    const ids = props.projects.map((project) => project.projectId);
    if (!ids.includes(projectId)) {
      setProjectId(ids[0] ?? "");
    }
  }, [props.projects, projectId]);
  const [content, setContent] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [requireApproval, setRequireApproval] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const toast = useToast();
  const { locale } = useLocale();

  async function pickFile(file: File | undefined): Promise<void> {
    if (file === undefined) return;
    if (file.size > MAX_BYTES) {
      toast.error(t("upload.fileTooLarge", locale));
      return;
    }
    try {
      setContent(await file.text());
      setFileName(file.name);
      toast.info(t("upload.fileLoaded", locale, { name: file.name, bytes: file.size }));
    } catch {
      toast.error(t("upload.readFailed", locale));
    }
  }

  async function start(): Promise<void> {
    if (projectId.length === 0) return void toast.error(t("upload.noProject", locale));
    if (content.trim().length === 0) return void toast.error(t("upload.emptyContent", locale));
    setBusy(true);
    try {
      const spec = await api.uploadSpec(props.creds, projectId, content);
      const run = await api.startPipeline(props.creds, projectId, spec.specId, requireApproval);
      toast.success(t("upload.started", locale));
      props.onStarted(run.runId);
    } catch (error) {
      // كان error.message الخام يُعرض كما هو؛
      // العقد هو ترجمة كود الخادم عبر apiErrorMessage بلا نص خام أبداً
      toast.error(apiErrorMessage(error, locale, "error.generic"));
    } finally {
      setBusy(false);
    }
  }

  return (
    // onDragOver/onDrop يكملان الزر — لوحة المفاتيح لا تحتاجهما إطلاقاً
    <div
      className="card fade-up"
      onDragOver={(event) => { event.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setDragOver(false);
        void pickFile(event.dataTransfer.files[0]);
      }}
      style={dragOver ? { borderColor: "var(--brand-green)" } : undefined}
    >
      <h2>{t("upload.title", locale)}</h2>
      <div className="row" style={{ marginBottom: 12, gridTemplateColumns: "1fr auto" }}>
        <label className="field" style={{ marginBottom: 0 }}>
          <span>{t("upload.project", locale)}</span>
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {props.projects.map((project) => (
              <option key={project.projectId} value={project.projectId}>
                {project.name}
              </option>
            ))}
          </select>
        </label>
        <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
          {t("upload.pickFile", locale)}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".yaml,.yml,.json"
          aria-label={t("upload.pickFile", locale)}
          style={{ display: "none" }}
          onChange={(e) => {
            void pickFile(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      <p style={{ color: "var(--muted)", fontSize: "var(--text--2)", marginBottom: 8 }}>
        {t("upload.acceptedTypes", locale)} · {t("upload.dropHint", locale)}
        {fileName !== null && <> — <bdi style={{ color: "var(--text-secondary)" }}>{fileName}</bdi></>}
      </p>
      <textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        placeholder={t("upload.placeholder", locale)}
        spellCheck={false}
        dir="ltr"
        aria-label={t("upload.title", locale)}
      />
      <div className="row" style={{ marginTop: 14, gridTemplateColumns: "1fr auto" }}>
        <label className="check">
          <input
            type="checkbox"
            checked={requireApproval}
            onChange={(e) => setRequireApproval(e.target.checked)}
          />
          {t("upload.hitl", locale)}
        </label>
        <Button variant="green" busy={busy} disabled={props.projects.length === 0} onClick={() => void start()}>
          {busy ? t("upload.starting", locale) : t("upload.start", locale)}
        </Button>
      </div>
    </div>
  );
}
