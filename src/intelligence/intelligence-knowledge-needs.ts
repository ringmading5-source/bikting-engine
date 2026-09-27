import { KnowledgeNeed } from "./intelligence-provider.types";
import { KnowledgeRequirement } from "../knowledge/knowledge-requirement.types";
import { stableIdentity } from "./intelligence-identity";

/**
 * Single conversion from a model's declared knowledge need to Bikting's canonical requirement shape.
 * Shared by the intent interpreter and the reasoning service so both enter Phase 6 identically.
 */
export function knowledgeNeedsToRequirements(
  needs: readonly KnowledgeNeed[],
  options: { prefix?: string; existingIds?: readonly string[] } = {},
): KnowledgeRequirement[] {
  const existing = new Set(options.existingIds ?? []);
  const seen = new Set<string>();
  return needs
    .map((need) => ({
      id: `${options.prefix ?? "intent"}-knowledge-${stableIdentity({ topic: need.topic, domain: need.domain, concepts: need.conceptIds ?? [] })}`,
      domain: need.domain,
      concepts: [...(need.conceptIds ?? [need.topic])],
      topic: need.topic,
      relationshipTypes: need.relationshipTypes ? [...need.relationshipTypes] : undefined,
      freshness: need.freshness ?? "stable",
      required: need.required ?? true,
    }))
    .filter((requirement) => {
      if (existing.has(requirement.id) || seen.has(requirement.id)) return false;
      seen.add(requirement.id);
      return true;
    });
}
