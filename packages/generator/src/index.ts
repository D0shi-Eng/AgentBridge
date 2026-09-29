/**
 * المنفذ العام لحزمة generator — عقد النظام الثالث تجاه المنسق.
 *
 * مساران فقط:
 *   1. generateServer(): تحليل + تصاميم → artifact في الذاكرة (حتمي).
 *   2. writeArtifact(): كتابة الـartifact على القرص بحراس أمنية.
 */

export {
  generateServer,
  type GenerationInput,
  type GenerationOptions,
} from "./emitter.js";
export { writeArtifact, type WriteOptions } from "./writer.js";
export { GenErrors } from "./errors.js";
export {
  slugifyName,
  zodLiteralFor,
  buildZodShapeLiteral,
  groupParametersByLocation,
  buildPathTemplateLiteral,
  SUPPORTED_LOCATIONS,
  type GroupedParams,
} from "./tool-codegen.js";
