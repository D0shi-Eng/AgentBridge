/**
 * قالب README.md للخادم المولد — تعليمات تشغيل بالعربية لعميل التسليم.
 */

export interface ReadmeTemplateInput {
  readonly serverName: string;
  readonly toolNames: readonly string[];
}

export function renderReadme(input: ReadmeTemplateInput): string {
  const toolList = input.toolNames.map((name) => `- \`${name}\``).join("\n");
  return `# خادم MCP المولد: ${input.serverName}

خادم MCP جاهز للتشغيل وُلِّد آلياً بواسطة **AgentBridge** من مواصفة OpenAPI.

## الأدوات المتاحة

${toolList}

## التشغيل

\`\`\`bash
npm install
UPSTREAM_BASE_URL="https://api.example.com" npm start
# مع مصادقة (اختياري):
UPSTREAM_BASE_URL="https://api.example.com" UPSTREAM_API_KEY="..." npm start
\`\`\`

الخادم يتواصل عبر **stdio** وفق بروتوكول MCP، فأضفه لأي عميل MCP هكذا:

\`\`\`json
{
  "mcpServers": {
    "${input.serverName}": {
      "command": "npm",
      "args": ["start"],
      "env": { "UPSTREAM_BASE_URL": "https://api.example.com" }
    }
  }
}
\`\`\`

## متغيرات البيئة

| المتغير | الإلزامية | الوظيفة |
| --- | --- | --- |
| \`UPSTREAM_BASE_URL\` | إلزامي | عنوان الـAPI الأصلي الذي تناديه الأدوات |
| \`UPSTREAM_API_KEY\` | اختياري | يرسل ترويسة \`Authorization: Bearer ...\` مع كل نداء |

> ملاحظة أمنية: رسائل أخطاء الأدوات لا تعكس محتوى استجابات الـAPI — قرار تصميمي لصد تسريب البيانات الشخصية عبر قنوات الأخطاء.
`;
}
