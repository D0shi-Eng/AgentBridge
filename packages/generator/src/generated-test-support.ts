/**
 * اختبار القبول الرئيسي:
 *   "خادم مولد من petstore يقوم بتشغيل فعلي ويستجيب لنداء MCP حقيقي عبر SDK"
 *
 * المسار كاملاً: مواصفة ← استيعاب ← تحليل ← وكيل مصمم (بمزود وهمي حتمي)
 * ← توليد ← كتابة على القرص ← إقلاع العملية المولدة ← عميل MCP رسمي
 *   (listTools ثم callTool) ضد upstream حقيقي محلي.
 */

import { createServer, type Server } from "node:http";
import { fileURLToPath } from "node:url";

export const petstoreYaml = await import("node:fs").then((fs) =>
  fs.readFileSync(
    new URL("../../../tests/fixtures/mini-petstore.yaml", import.meta.url),
    "utf8",
  ),
);

/** مجلد التوليد داخل المستودع عمداً حتى تعمل دلالة الوحدات للـtsx والـSDK
 *  محسوب من موقع الملف نفسه (ثابت مهما اختلف cwd) */
export const TARGET_DIR = fileURLToPath(
  new URL("../../../tests/e2e/.tmp/mini-petstore-server", import.meta.url),
).replace(/\\$/u, "");

/** الدفعة الصحيحة كما يجب أن يصممها الوكيل — سكربت المزود الوهمي */
export const VALID_BATCH = {
  designs: [
    {
      name: "list_pets",
      description: "List all pets in the store with an optional limit.",
      endpointIds: ["listPets"],
      parameters: { limit: { type: "number", required: false, description: "Max pets to return." } },
    },
    {
      name: "create_pet",
      description: "Create a new pet record with a required name.",
      endpointIds: ["createPet"],
      parameters: {
        name: { type: "string", required: true, description: "Name of the new pet." },
        tag: { type: "string", required: false, description: "Optional tag." },
      },
    },
    {
      name: "get_pet_by_id",
      description: "Retrieve one pet by its unique identifier.",
      endpointIds: ["showPetById"],
      parameters: { petId: { type: "string", required: true, description: "Pet identifier." } },
    },
    {
      name: "delete_pet",
      description: "Remove a pet permanently by its identifier.",
      endpointIds: ["deletePet"],
      parameters: { petId: { type: "string", required: true, description: "Pet identifier." } },
    },
  ],
} as const;

/** upstream حقيقي محلي يحاكي الـAPI الأصلي */
export function startMockUpstream(): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = req.url ?? "";
      res.setHeader("Content-Type", "application/json");
      if (req.method === "POST" && url === "/pets") {
        res.statusCode = 201;
        req.resume();
        req.on("end", () => res.end(JSON.stringify({ id: "99", created: true })));
      } else if (url.startsWith("/pets?") || url === "/pets") {
        res.end(JSON.stringify([{ id: "1", name: "Rex" }, { id: "2", name: "Masha" }]));
      } else if (url === "/pets/42") {
        res.end(JSON.stringify({ id: "42", name: "RexTheFortyTwo" }));
      } else if (/^\/pets\/[^/]+$/.test(url) && req.method === "DELETE") {
        req.resume();
        req.on("end", () => {
          res.statusCode = 204;
          res.end();
        });
      } else {
        // أي مسار آخر = فشل upstream بمحتوى سرّي لا يجوز تسريبه عبر الخطأ
        res.statusCode = 500;
        res.end(JSON.stringify({ secret: "DO-NOT-LEAK-INTERNAL-TRACE" }));
      }
    });
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ server, baseUrl: `http://127.0.0.1:${port}` });
    });
  });
}

