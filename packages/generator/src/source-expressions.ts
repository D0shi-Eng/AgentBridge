/** سياقات المصدر المسموحة: literal للبيانات وتعبيرات ثابتة للقراءة؛ لا escape عام. */
export function stringLiteral(value: string): string {
  return JSON.stringify(value).replace(/\u2028/gu, "\\u2028").replace(/\u2029/gu, "\\u2029");
}

/** اسم API يبقى literal؛ own يمنع أن يحل prototype محل قيمة الطلب الحقيقية. */
export function parameterAccess(name: string, fallback: boolean): string {
  const key = stringLiteral(name);
  const own = `own(args, ${key})`;
  return fallback ? `(${own} ?? own(previousResponse, ${key}))` : own;
}

/** ${...} نص ثابت؛ وحدها {name} غير المسبوقة بدولار تمثل معامل OpenAPI. */
export function pathParameters(path: string): readonly string[] {
  return [...path.matchAll(/(?<!\$)\{([^{}]+)\}/gu)].map((match) => match[1] ?? "");
}

/** تركيب جمع literals ثابتة مع تعبيرات موثوقة؛ لا يُنسخ المسار إلى template literal. */
export function pathExpression(path: string, fallback: boolean): string {
  const parts: string[] = [];
  let start = 0;
  for (const match of path.matchAll(/(?<!\$)\{([^{}]+)\}/gu)) {
    const index = match.index;
    parts.push(stringLiteral(path.slice(start, index)));
    parts.push(`encodeURIComponent(String(${parameterAccess(match[1] ?? "", fallback)} ?? ""))`);
    start = index + match[0].length;
  }
  parts.push(stringLiteral(path.slice(start)));
  return parts.join(" + ");
}
