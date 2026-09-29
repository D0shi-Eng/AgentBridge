/**
 * تنزيل الملفات المحمية — blob ثم anchor لأن الترويسة لا تصل عبر روابط <a>.
 * فصل عن api-client للحفاظ على حدود الملفات؛ كل شيء cookie-based.
 */
import { ApiError, headers, type Credentials } from "./api-client";

/** تنزيل ملف محمي بالجلسة ثم حفظه بجهاز المستخدم */
export async function downloadFile(
  _session: Credentials,
  path: string,
  filename: string,
): Promise<void> {
  const response = await fetch(`/api${path}`, { headers: headers(false, "GET"), credentials: "include", cache: "no-store" });
  if (!response.ok) {
    throw new ApiError(response.status, `HTTP_${response.status}`, "");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
