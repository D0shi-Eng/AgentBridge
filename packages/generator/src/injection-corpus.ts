/** بيانات عدائية للفحص البنيوي فقط؛ يمنع تنفيذ أي مصدر مولد منها. البذرة ثابتة. */
export const INJECTION_CORPUS = [
  "plain", "`", "${globalThis.__injectionMarker()}", "\";globalThis.__injectionMarker();//",
  "'\\/\n\r\t", "عربي mixed Unicode 日本語", "\u2028\u2029", "__proto__",
  "constructor", "prototype", "default", "class", "a-b", "a_b", "*/export const injected=1;/*",
] as const;

/** مولد نصوص محدود وحتمي: 128 حالة × 24 محرفًا، دون استدعاء أو شبكة. */
export function seededCorpus(): string[] {
  let state = 0x20260905;
  const alphabet = "ab`$\"'\\/\n\r\tعربي_-\u2028\u2029";
  return Array.from({ length: 128 }, () => Array.from({ length: 24 }, () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return alphabet[state % alphabet.length];
  }).join(""));
}
