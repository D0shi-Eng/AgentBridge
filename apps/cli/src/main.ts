/**
 * نقطة الدخول التنفيذية — غلاف رفيع فوق runCli يربط رمز الخروج.
 * كل المنطق في run-cli.ts ليظل قابلاً للاختبار برمجياً.
 */

import { runCli } from "./run-cli.js";

const exitCode = await runCli(process.argv.slice(2));
process.exit(exitCode);
