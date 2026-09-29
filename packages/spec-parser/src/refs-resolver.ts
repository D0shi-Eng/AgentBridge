/**
 * حلال المراجع — يزيل كل $ref من المستند بإحلال القيم مكانها.
 *
 * الوظيفة: بعد هذا الملف لا يبقى في المستند أي مرجع خارجي، وتصبح
 * كل بقية القراءة تعقلاً مباشراً على البيانات نفسها.
 *
 * كيف يعمل:
 * 1) المراجع الداخلية فقط (تبدأ بـ #/) — الخارجي رفض أمني فوري.
 * 2) تذكّر (Memoize) كل مرجع تم حله لمنع الانفجار الأسّي.
 * 3) الحلقات الذاتية مشروعة في OpenAPI (نموذج Pet يحوي children من نوعه)،
 *   لذا عند لمس حلقة نُبقي $ref الداخلي كما هو بدل الفشل — وطبقات ما بعدنا
 *   (المطبّع والماسح) لديها حدود عمق خاصة بها تتوقف عندها بأمان.
 */

import { err, ok, type Result } from "@agentbridge/shared";
import { SpecErrors } from "./errors.js";

/** حد عمق الإحلال — صد هياكل شاذة قبل انهيار مكدس الاستدعاءات */
const MAX_RESOLVE_DEPTH = 200;

/** هل الكائن مرجع OpenAPI صريح؟ */
function isReferenceObject(node: object): node is { readonly $ref: string } {
  return typeof (node as Record<string, unknown>)["$ref"] === "string";
}

/** فك ترميز رموز JsonPointer (~0 للـ ~ و ~1 للـ /) */
function decodeToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

/** تصفح المستند عبر مؤشر JSON Pointer وإعادة القيمة الهدف */
function navigate(root: Record<string, unknown>, pointer: string): Result<unknown> {
  if (pointer === "") return ok(root);
  let current: unknown = root;
  for (const rawToken of pointer.split("/").slice(1)) {
    const token = decodeToken(rawToken);
    if (!Array.isArray(current) && typeof current !== "object") {
      return err(SpecErrors.brokenRef(`#${pointer} — المسار يمر عبر قيمة غير قابلة للتصفح`));
    }
    const container = current as Record<string, unknown>;
    if (!(token in container)) {
      return err(SpecErrors.brokenRef(`#${pointer}`));
    }
    current = container[token];
  }
  return ok(current);
}

/** نقطة الدخول: مستند خام → نسخة محلولة المراجع بالكامل */
export function resolveDocument(doc: Record<string, unknown>): Result<Record<string, unknown>> {
  /** ذاكرة الحلول: مؤشر → القيمة المحلولة كاملة */
  const memo = new Map<string, unknown>();

  function followRef(ref: string, chain: readonly string[], depth: number): Result<unknown> {
    if (!ref.startsWith("#/")) return err(SpecErrors.externalRef(ref));

    const pointer = ref.slice(1);
    const cached = memo.get(pointer);
    if (cached !== undefined) return ok(cached);

    // الحلقة الذاتية: أوقف التوسيع هنا وأعد المرجع كما هو (انظر توثيق الرأس)
    if (chain.includes(ref)) return ok({ $ref: ref });

    const target = navigate(doc, pointer);
    if (!target.ok) return target;

    const resolved = derefValue(target.value, [...chain, ref], depth + 1);
    if (resolved.ok) memo.set(pointer, resolved.value);
    return resolved;
  }

  function derefValue(node: unknown, chain: readonly string[], depth: number): Result<unknown> {
    if (depth > MAX_RESOLVE_DEPTH) {
      return err(SpecErrors.invalidStructure(`عمق الإحلال تجاوز ${MAX_RESOLVE_DEPTH}`));
    }
    if (Array.isArray(node)) {
      const out: unknown[] = [];
      for (const item of node) {
        const resolved = derefValue(item, chain, depth + 1);
        if (!resolved.ok) return resolved;
        out.push(resolved.value);
      }
      return ok(out);
    }
    if (typeof node === "object" && node !== null) {
      const obj = node as Record<string, unknown>;
      if (isReferenceObject(obj)) return followRef(obj.$ref, chain, depth);
      const out: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(obj)) {
        const resolved = derefValue(value, chain, depth + 1);
        if (!resolved.ok) return resolved;
        out[key] = resolved.value;
      }
      return ok(out);
    }
    return ok(node);
  }

  const result = derefValue(doc, [], 0);
  if (!result.ok) return result;
  return ok(result.value as Record<string, unknown>);
}
