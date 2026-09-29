/**
 * خادم upstream محلي للتقاط نداءات الخادم المولد أثناء الفحوص الحية.
 *
 * وظيفتان أمنيتان:
 *   1. تسجيل كل هدف طلب خام (raw target) ليفحصه حرس الترميز HD-03.
 *   2. إعادة فشل 500 بجسم سرّي ثابت (LEAK_MARKER) لأي مسار غير معروف —
 *      أي أداة تعكس جسم الخطأ ستكشف العلامة ويقبض عليها حرس HD-02.
 *
 * شبكة محلية فقط 127.0.0.1 على منفذ عابر — لا صلاحيات ولا خارجية.
 */

import { createServer, type Server } from "node:http";

/** علامة السر التي يجب ألا تظهر أبداً في مخرجات الأدوات */
export const LEAK_MARKER = "AB-LIVE-LEAK-MARKER-9f3a7c";

/** علامة اجتياز المسار المستخدمة في حمولة HD-03 */
export const TRAVERSAL_MARKER = "ABTRAVERSAL";

export interface RecordingUpstream {
  readonly server: Server;
  readonly baseUrl: string;
  /** الأهداف الخام بترتيب وصولها مثل "/pets/42?x=1" */
  readonly recordedTargets: readonly string[];
}

/** يقلع upstream مسجِّلاً على منفذ عابر — يستدعى مرة لكل جلسة فحص حي */
export function startRecordingUpstream(): Promise<RecordingUpstream> {
  const recorded: string[] = [];

  let rateCounter = 0;
  return new Promise((resolve) => {
    const server: Server = createServer((req, res) => {
      recorded.push(req.url ?? "");
      res.setHeader("Content-Type", "application/json");

      // استجابات نجاح عامة تكفي لأن الفحوص تقيس الطلب لا شكل الاستجابة
      if (req.method === "POST" && (req.url ?? "") === "/pets") {
        res.statusCode = 201;
        req.resume();
        req.on("end", () => res.end(JSON.stringify({ id: "77", created: true })));
        return;
      }
      if ((req.url ?? "").startsWith("/pets?")) {
        res.end(JSON.stringify([{ id: "1", name: "Rex" }, { id: "2", name: "Masha" }]));
        return;
      }
      if (/^\/pets\/[^/?#]+$/.test(req.url ?? "")) {
        res.end(JSON.stringify({ id: "1", name: "Rex" }));
        return;
      }
      // مسارات التسلسل: أول نداء ينتج seqId والثاني يستهلكه
      if (req.method === "POST" && (req.url ?? "") === "/seq-first") {
        res.statusCode = 201;
        req.resume();
        req.on("end", () => res.end(JSON.stringify({ seqId: "SEQ-77", created: true })));
        return;
      }
      if (/^\/seq-second\/[^/?#]+$/.test(req.url ?? "")) {
        const seqId = (req.url ?? "").split("/")[2] ?? "unknown";
        res.end(JSON.stringify({ seqId, ok: true }));
        return;
      }
      // مسارات HD-06 و HD-07 — ضخامة ومعدل
      if ((req.url ?? "").startsWith("/large-echo")) {
        let bodyLength = 0;
        req.on("data", (chunk: Buffer) => { bodyLength += chunk.length; });
        req.on("end", () => {
          res.end(JSON.stringify({ receivedBytes: bodyLength, ok: true }));
        });
        return;
      }
      if ((req.url ?? "").startsWith("/rate-echo")) {
        rateCounter += 1;
        const current = rateCounter;
        req.resume();
        req.on("end", () => {
          res.end(JSON.stringify({ count: current, ok: true }));
        });
        return;
      }

      // أي هدف آخر = فشل مقصود بسر قابل للتسريب إن كانت الأداة سيئة التعقيم
      res.statusCode = 500;
      req.resume();
      req.on("end", () => {
        res.end(JSON.stringify({ error: "internal_failure", secret: LEAK_MARKER }));
      });
    });

    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${port}`,
        recordedTargets: recorded,
      });
    });
  });
}
