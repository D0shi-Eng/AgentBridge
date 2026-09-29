/** تنظيف ترحيل لمفاتيح قديمة؛ لا يقرأ المحتوى ولا يحتفظ ببيانات هوية. */

const STORAGE_KEY = "ab.credentials.v1";

export function clearLegacyCredentials(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(STORAGE_KEY);
}
