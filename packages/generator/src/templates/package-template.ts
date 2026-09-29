/**
 * قالب package.json للخادم المولد — حزمة مستقلة قابلة للتسليم.
 * الإصدارات مثبتة على ما اختُبر في المونوريبو نفسه.
 */

export interface PackageTemplateInput {
  readonly packageName: string;
  readonly version: string;
}

export function renderPackageJson(input: PackageTemplateInput): string {
  const manifest = {
    name: input.packageName,
    version: input.version,
    private: true,
    type: "module",
    scripts: {
      start: "tsx src/server.ts",
      typecheck: "tsc --noEmit",
    },
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.30.0",
      zod: "^3.25.76",
    },
    devDependencies: {
      tsx: "^4.19.2",
      typescript: "^5.7.2",
    },
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}
