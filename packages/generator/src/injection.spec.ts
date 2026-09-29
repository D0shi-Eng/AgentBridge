/** عدم رجوع A01/A02: AST والترجمة فقط؛ لا eval ولا تشغيل payload. */
import { describe, expect, it } from "vitest";
import { INJECTION_CORPUS, seededCorpus } from "./injection-corpus.js";
import { diagnostics, injectionInput, structure, toolsSource } from "./injection-fixture.js";

describe("البيانات لا تغير بنية البرنامج", () => {
  for (const sequential of [false, true]) {
    it.each([...INJECTION_CORPUS, ...seededCorpus()])(`A01 path fallback=${sequential}: %j`, (text) => {
      const baseline = toolsSource(injectionInput("/plain/{id}", "id", sequential));
      const source = toolsSource(injectionInput(`/${text}/{id}`, "id", sequential));
      expect(diagnostics(source)).toEqual([]);
      expect(structure(source)).toEqual(structure(baseline));
    });

    it.each(INJECTION_CORPUS.filter((name) => !/[{}]/u.test(name) && name !== "__proto__"))(
      `A02 property fallback=${sequential}: %j`, (name) => {
        const source = toolsSource(injectionInput(`/plain/{${name}}`, name, sequential));
        const baseline = toolsSource(injectionInput("/plain/{id}", "id", sequential));
        expect(diagnostics(source)).toEqual([]);
        expect(structure(source)).toEqual(structure(baseline));
      },
    );
  }
});
