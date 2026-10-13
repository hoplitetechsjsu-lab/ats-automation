import type { CompilerConfig } from "./config";
import { contentTokens, phraseNegated, tokenize, tokensContain } from "./normalize";
import type { Claim, Library, MatchEdge, Requirement, Skill, Support } from "./types";

const BULLET_KINDS = new Set(["experience_bullet", "project_bullet", "leadership_bullet"]);

export function matchRequirements(
  library: Library,
  requirements: Requirement[],
  config: CompilerConfig,
): MatchEdge[] {
  const edges: MatchEdge[] = [];
  for (const requirement of requirements) {
    if (requirement.kind === "ignore") continue;
    for (const claim of library.claims) {
      if (claim.visibility !== "public" || !claim.human_authored) continue;
      const edge = matchPair(library, requirement, claim, config);
      if (edge) edges.push(edge);
    }
  }
  return edges;
}

export function suggestOverlaps(
  library: Library,
  requirements: Requirement[],
  edges: MatchEdge[],
  config: CompilerConfig,
): MatchEdge[] {
  if (!config.semantic.enabled || config.semantic.mode === "off") return [];
  const suggestions: MatchEdge[] = [];
  for (const requirement of requirements) {
    if (requirement.kind === "ignore") continue;
    const verified = edges.some(
      (edge) =>
        edge.requirement_id === requirement.id &&
        (edge.support === "direct" || edge.support === "alias") &&
        edge.counts_as_coverage,
    );
    if (verified) continue;
    const ranked = library.claims
      .filter((claim) => claim.visibility === "public" && claim.evidence_level !== "planned" && claim.ownership !== "planned")
      .map((claim) => ({ claim, score: jaccard(requirement.source_span, claim.text) }))
      .filter((item) => item.score >= config.semantic.suggestion_threshold)
      .sort((left, right) => right.score - left.score || left.claim.id.localeCompare(right.claim.id))
      .slice(0, config.semantic.suggestions_per_requirement);
    for (const item of ranked) {
      suggestions.push({
        requirement_id: requirement.id,
        claim_id: item.claim.id,
        channels: { exact: 0, alias: 0, semantic: round(item.score) },
        support: "semantic_suggestion",
        edge_score: round(config.support_gates.semantic_suggestion * config.weights.semantic * item.score),
        explanation: `Lexical overlap only (${item.score.toFixed(2)}). This is a review suggestion, not a verified match, and no embedding model was used.`,
        counts_as_coverage: false,
      });
    }
  }
  return suggestions;
}

function matchPair(
  library: Library,
  requirement: Requirement,
  claim: Claim,
  config: CompilerConfig,
): MatchEdge | null {
  if (requirement.gate_type === "degree") return matchDegree(requirement, claim, config);
  if (requirement.gate_type === "work_authorization") return matchAuthorization(requirement, claim, config);
  if (requirement.gate_type === "seniority" || requirement.gate_type === "clearance" || requirement.gate_type === "license") {
    return null;
  }
  const skillIds = requirement.canonical_terms.filter((term) => library.skills.some((skill) => skill.id === term));
  if (skillIds.length === 0) return null;
  const considered = skillIds
    .map((skillId) => {
      const skill = library.skills.find((item) => item.id === skillId)!;
      return scoreSkill(requirement, claim, skill, config);
    })
    .filter((edge): edge is MatchEdge => edge !== null)
    .sort((left, right) => right.edge_score - left.edge_score || left.claim_id.localeCompare(right.claim_id));
  return considered[0] ?? null;
}

function scoreSkill(requirement: Requirement, claim: Claim, skill: Skill, config: CompilerConfig): MatchEdge | null {
  const blocked = blockReason(requirement, claim, skill);
  const tokens = tokenize(claim.text);
  const canonicalHit = tokensContain(tokens, skill.canonical);
  const aliasHit = [...skill.aliases, ...claim.aliases_approved].find((alias) => {
    if (skill.ambiguous_aliases.some((item) => item.toLowerCase() === alias.toLowerCase())) return false;
    if (skill.exact_only && alias.length < 4) return false;
    const hit = tokensContain(tokens, alias);
    return hit !== null && !phraseNegated(tokens, hit.index);
  });
  const ambiguousHit = skill.ambiguous_aliases.find((alias) => tokensContain(tokens, alias));
  const canonicalOk = canonicalHit !== null && !phraseNegated(tokens, canonicalHit.index);
  const tagged = claim.skills.includes(skill.id);
  const surfaceIsAlias = requirement.surface_forms.some(
    (form) => form.toLowerCase() !== skill.canonical.toLowerCase() && form.toLowerCase() !== skill.id.toLowerCase(),
  );

  let support: Support = "none";
  let exact = 0;
  let alias = 0;
  let explanation = "";

  if (blocked) {
    support = "none";
    explanation = blocked;
  } else if (tagged && (canonicalOk || aliasHit || (ambiguousHit && tagged))) {
    if (surfaceIsAlias && (aliasHit || tagged)) {
      support = "alias";
      alias = 1;
      explanation = `Approved alias for ${skill.canonical} is supported by claim ${claim.id}, which is tagged and uses approved wording.`;
    } else if (canonicalOk || tagged) {
      support = "direct";
      exact = 1;
      explanation = `Claim ${claim.id} is tagged ${skill.canonical} and its text supports that term.`;
    }
    if (claim.evidence_level === "supported_inference") {
      support = "text_review";
      explanation = `Claim ${claim.id} is only supported inference for ${skill.canonical}. It needs review and is not verified coverage.`;
    }
  } else if (!tagged && canonicalOk && skill.canonical.length >= 4) {
    support = "text_review";
    exact = 1;
    explanation = `Claim ${claim.id} mentions ${skill.canonical}, but the skill tag is missing. Review it before treating the match as verified.`;
  } else if (!tagged && aliasHit) {
    support = "text_review";
    alias = 1;
    explanation = `Claim ${claim.id} uses an approved alias for ${skill.canonical}, but the skill tag is missing. Review it before treating the match as verified.`;
  } else if (ambiguousHit && !tagged) {
    return null;
  } else {
    return null;
  }

  if (support === "none" && !blocked) return null;
  if (support === "none" && blocked && !tagged && !canonicalOk) return null;

  const role = roleAlignment(requirement, claim);
  const quality = evidenceQuality(claim);
  const gate =
    support === "direct"
      ? config.support_gates.direct
      : support === "alias"
        ? config.support_gates.alias
        : support === "text_review"
          ? config.support_gates.text_review
          : config.support_gates.none;
  const edgeScore =
    gate *
    (config.weights.exact * exact +
      config.weights.alias * alias +
      config.weights.semantic * 0 +
      config.weights.role_alignment * role +
      config.weights.evidence_quality * quality);

  return {
    requirement_id: requirement.id,
    claim_id: claim.id,
    channels: { exact, alias, semantic: 0 },
    support,
    edge_score: round(edgeScore),
    explanation,
    counts_as_coverage: (support === "direct" || support === "alias") && claim.evidence_level === "direct",
  };
}

function blockReason(requirement: Requirement, claim: Claim, skill: Skill): string | null {
  if (claim.evidence_level === "planned" || claim.ownership === "planned") {
    return `Claim ${claim.id} is marked planned, so it cannot support ${skill.canonical}.`;
  }
  if (claim.evidence_level === "context_only") {
    return `Claim ${claim.id} is context only, so it cannot verify ${skill.canonical}.`;
  }
  const researchish = /\b(research|survey|literature|evaluat)\b/i.test(requirement.source_span);
  if ((claim.ownership === "researched" || claim.ownership === "evaluated") && !researchish) {
    return `Claim ${claim.id} is ${claim.ownership} evidence and does not verify hands-on ${skill.canonical}.`;
  }
  return null;
}

function matchDegree(requirement: Requirement, claim: Claim, config: CompilerConfig): MatchEdge | null {
  if (claim.kind !== "education") return null;
  const text = claim.text.toLowerCase();
  const degree = /\b(bachelor|b\.s\.|b\.a\.|bs|ba)\b/i.test(requirement.source_span);
  const master = /\b(master|m\.s\.|ph\.?d)\b/i.test(requirement.source_span);
  const claimDegree = /\b(b\.s\.|b\.a\.|bachelor)/i.test(text);
  const claimMaster = /\b(m\.s\.|master|ph\.?d)/i.test(text);
  if (degree && !claimDegree) return null;
  if (master && !claimMaster && !claimDegree) return null;
  if (/\bcomputer science\b/i.test(requirement.source_span) && !/\bcomputer science\b/i.test(text)) return null;
  return scoredGate(requirement, claim, config, `Education claim ${claim.id} supports the degree gate.`);
}

function matchAuthorization(requirement: Requirement, claim: Claim, config: CompilerConfig): MatchEdge | null {
  if (claim.kind !== "eligibility") return null;
  const requirementUs = /\b(united states|u\.s\.|us)\b/i.test(requirement.source_span);
  const claimUs = /\b(united states|u\.s\.)\b/i.test(claim.text);
  const claimAuth = /\b(authorized to work|work authorization|citizen)\b/i.test(claim.text);
  if (!claimAuth) return null;
  if (requirementUs && !claimUs) return null;
  return scoredGate(requirement, claim, config, `Eligibility claim ${claim.id} supports the work-authorization gate.`);
}

function scoredGate(requirement: Requirement, claim: Claim, config: CompilerConfig, explanation: string): MatchEdge {
  const role = 1;
  const quality = evidenceQuality(claim);
  const edgeScore =
    config.support_gates.direct *
    (config.weights.exact * 1 +
      config.weights.role_alignment * role +
      config.weights.evidence_quality * quality);
  return {
    requirement_id: requirement.id,
    claim_id: claim.id,
    channels: { exact: 1, alias: 0, semantic: 0 },
    support: "direct",
    edge_score: round(edgeScore),
    explanation,
    counts_as_coverage: claim.evidence_level === "direct",
  };
}

function roleAlignment(requirement: Requirement, claim: Claim): number {
  if (BULLET_KINDS.has(claim.kind) && (requirement.kind === "must" || requirement.kind === "preferred" || requirement.kind === "responsibility")) {
    return 1;
  }
  if (claim.kind === "summary") return 0.65;
  if (claim.kind === "education" && requirement.kind === "gate") return 1;
  return 0.35;
}

function evidenceQuality(claim: Claim): number {
  if (claim.evidence_level === "planned" || claim.evidence_level === "context_only") return 0;
  if (claim.evidence_level === "supported_inference") return 0.55;
  if (claim.metrics.length > 0) return 1;
  return 0.85;
}

function jaccard(left: string, right: string): number {
  const a = new Set(contentTokens(left));
  const b = new Set(contentTokens(right));
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection += 1;
  return intersection / (a.size + b.size - intersection);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
