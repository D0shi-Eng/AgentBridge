import { AppShell } from "@/components/system/AppShell";
import { SessionProvider } from "@/lib/use-session";

/**
 * مجموعة مسارات (app) — مزود جلسة واحد للتحميل كله + القشرة الموحدة.
 * مزود الجلسة هنا فيجيب /auth/session مرة واحدة لكل تحميل مهما تعددت
 * الصفحات، والقشرة تقرأه فتعرض المستأجر والخروج في كل صفحة.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <AppShell>{children}</AppShell>
    </SessionProvider>
  );
}
