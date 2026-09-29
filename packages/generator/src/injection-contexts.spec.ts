/** أسماء query/header/body والأوصاف كلها بيانات؛ لا تُنفذ أي عينة corpus. */
import { describe, expect, it } from "vitest";
import { INJECTION_CORPUS, seededCorpus } from "./injection-corpus.js";
import { diagnostics, injectionInput, structure, toolsSource } from "./injection-fixture.js";

describe("سياقات التوليد المتبقية", () => {
  for (const location of ["query", "header", "body"] as const) {
    for (const sequential of [false, true]) {
      const make = (name: string) => {
        const input = injectionInput("/fixed", name, sequential);
        return toolsSource({ ...input, analyzed: { ...input.analyzed, spec: { ...input.analyzed.spec,
          endpoints: input.analyzed.spec.endpoints.map((endpoint) => ({ ...endpoint, path: "/fixed",
            pathParams: [], fields: endpoint.fields.map((field) => ({ ...field, location })) })) } } });
      };
      it.each([...INJECTION_CORPUS, ...seededCorpus()].filter((name) => name !== "__proto__"))(
        `${location} fallback=${sequential}: %j`, (name) => {
          const source = make(name);
          expect(diagnostics(source)).toEqual([]);
          expect(structure(source)).toEqual(structure(make("safe")));
        });
    }
  }
  it.each(INJECTION_CORPUS)("الوصف يبقى literal: %j", (text) => {
    const input = injectionInput("/x/{id}");
    const description = `${text} safe description`;
    const source = toolsSource({ ...input, designs: input.designs.map((design) => ({ ...design, description,
      parameters: { id: { type: "string", required: true, description } } })) });
    expect(diagnostics(source)).toEqual([]);
    const baseline = toolsSource({ ...input, designs: input.designs.map((design) => ({ ...design,
      description: "safe description", parameters: { id: { type: "string", required: true,
        description: "safe description" } } })) });
    expect(structure(source)).toEqual(structure(baseline));
  });
});
