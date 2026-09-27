import { BilParseError } from "./bil.errors";
import { BilModule } from "./bil.types";
import { assertValidBilModule } from "./bil.validator";

/** Parse inert JSON data and validate it. Module content is never evaluated. */
export function parseBilModule(source: string): BilModule {
  let value: unknown;
  try {
    value = JSON.parse(source) as unknown;
  } catch (error) {
    throw new BilParseError("BIL module is not valid JSON.", error);
  }
  const module = assertValidBilModule(value);
  return { ...module, knowledgeRequirements: structuredClone(module.knowledgeRequirements ?? []) };
}
