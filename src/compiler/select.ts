import type { CompilerConfig } from "./config";
import { guardWording, parentLabel } from "./library";
import type {
  Claim,
  CoverageState,
  Library,
  MatchEdge,
  OutputOrigin,
  Requirement,
  RequirementCoverage,
  RunControls,
  SelectedLine,
  Suggestion,
} from "./types";

const MAJOR_KINDS = new Set(["experience_bullet", "project_bullet", "leadership_bullet"]);

export interface Selection {
  lines: SelectedLine[];
  coverage: RequirementCoverage[];
  suggestions: Suggestion[];
  failures: string[];
  notes: string[];
  fatal: boolean;
}

export function selectEvidence(
  library: Library,
  requirements: Requirement[],
  edges: MatchEdge[],
  suggestionEdges: MatchEdge[],
  controls: RunControls,
  config: CompilerConfig,
): Selection {
  const failures: string[] = [];
  const notes: string[] = [];
  const claims = new Map(library.claims.map((claim) => [claim.id, claim]));
  const byRequirement = group(edges, (edge) => edge.requirement_id);

  for (const pin of controls.pins) {
    if (controls.excludes.includes(pin)) failures.push(`Claim ${pin} is both pinned and excluded.`);
    const claim = claims.get(pin);
    if (!claim) failures.push(`Pinned claim ${pin} is not in the library.`);
    else if (!eligible(claim)) failures.push(ineligibleReason(claim));
  }
  for (const exclude of controls.excludes) {
    if (!claims.has(exclude)) failures.push(`Excluded claim ${exclude} is not in the library.`);
  }
  for (const [claimId, variantId] of Object.entries(controls.variants)) {
    const claim = claims.get(claimId);
    if (!claim) failures.push(`Variant requested for unknown claim ${claimId}.`);
    else if (!claim.approved_variants.some((variant) => variant.id === variantId && variant.approved)) {
      failures.push(`Variant ${variantId} is not an approved variant of ${claimId}.`);
    }
  }
  for (const [claimId, text] of Object.entries(controls.edits)) {
    const claim = claims.get(claimId);
    if (!claim) failures.push(`Edit requested for unknown claim ${claimId}.`);
    else {
      const problem = guardWording(claim, text, library.skills);
      if (problem) failures.push(`Edit for ${claimId} ${problem}`);
    }
  }

  if (failures.length > 0) {
    return {
      lines: [],
      coverage: coverageFrom(requirements, [], byRequirement, new Map()),
      suggestions: toSuggestions(suggestionEdges),
      failures,
      notes,
      fatal: true,
    };
  }

  const chosen = new Map<string, string[]>();
  const add = (claim: Claim, reason: string) => {
    const reasons = chosen.get(claim.id);
    if (reasons) {
      reasons.push(reason);
      return;
    }
    chosen.set(claim.id, [reason]);
  };

  for (const pin of controls.pins) add(claims.get(pin)!, "Pinned by the reviewer.");

  const bulletClaims = library.claims.filter((claim) => MAJOR_KINDS.has(claim.kind) && eligible(claim) && !controls.excludes.includes(claim.id));
  let lineCost = [...chosen.keys()].reduce((sum, id) => sum + (claims.get(id)?.line_cost_estimate ?? 0), 0);

  while (lineCost < config.selection.line_budget) {
    const ranked = bulletClaims
      .filter((claim) => !chosen.has(claim.id))
      .map((claim) => ({ claim, gain: marginalGain(claim, chosen, claims, byRequirement, requirements, config) }))
      .filter((item) => item.gain.coverage > 0)
      .sort((left, right) => right.gain.score - left.gain.score || left.claim.id.localeCompare(right.claim.id));
    const next = ranked.find((item) => canAdd(item.claim, chosen, claims, controls, config));
    if (!next || next.gain.score < config.selection.stop_gain) break;
    add(next.claim, "Selected for grounded requirement coverage.");
    lineCost += next.claim.line_cost_estimate;
  }

  enforceMinimumBullets(bulletClaims, chosen, claims, controls, config, byRequirement, notes);
  enforceExperience(bulletClaims, chosen, claims, controls, config, byRequirement, notes);

  const summary = chooseSummary(library, controls, byRequirement);
  if (summary) add(summary, "Human-authored summary kept as the summary source.");
  for (const claim of library.claims) {
    if (claim.kind === "education" && eligible(claim) && !controls.excludes.includes(claim.id)) {
      add(claim, "Education is included from the source library.");
    }
    if (claim.kind === "eligibility" && eligible(claim) && !controls.excludes.includes(claim.id)) {
      const coversGate = edges.some(
        (edge) => edge.claim_id === claim.id && edge.counts_as_coverage && edge.support === "direct",
      );
      if (coversGate || controls.pins.includes(claim.id)) add(claim, "Eligibility evidence covers a gate and stays in the ledger.");
    }
  }

  const lines = [...chosen.entries()].map(([claimId, reasons]) =>
    toLine(claims.get(claimId)!, reasons, controls, library),
  );
  const primaries = assignPrimaries(requirements, lines, byRequirement);
  return {
    lines,
    coverage: coverageFrom(requirements, lines, byRequirement, primaries),
    suggestions: toSuggestions(suggestionEdges),
    failures,
    notes,
    fatal: false,
  };
}

function marginalGain(
  claim: Claim,
  chosen: Map<string, string[]>,
  claims: Map<string, Claim>,
  byRequirement: Map<string, MatchEdge[]>,
  requirements: Requirement[],
  config: CompilerConfig,
): { coverage: number; score: number } {
  const requirementById = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  let coverage = 0;
  let index = 0;
  const edges = edgesForClaim(claim.id, byRequirement)
    .filter((edge) => edge.counts_as_coverage)
    .sort((left, right) => (requirementById.get(right.requirement_id)?.weight ?? 0) - (requirementById.get(left.requirement_id)?.weight ?? 0));
  for (const edge of edges) {
    const requirement = requirementById.get(edge.requirement_id);
    if (!requirement || requirement.kind === "ignore") continue;
    const current = bestSelectedScore(requirement.id, chosen, byRequirement);
    if (edge.edge_score <= current) continue;
    coverage += (edge.edge_score - current) * requirement.weight * config.selection.diminishing ** index;
    index += 1;
  }
  if (coverage <= 0) return { coverage: 0, score: 0 };
  const year = Number((claim.dates.end ?? claim.dates.start).slice(0, 4));
  const recency = Number.isFinite(year) ? Math.max(0, Math.min(1, (year - 2016) / 12)) : 0;
  const sameParent = [...chosen.keys()].some((id) => claims.get(id)?.parent_id === claim.parent_id);
  const cohesion = sameParent ? 0.05 : 0;
  return { coverage, score: coverage + 0.05 * evidenceBonus(claim) + 0.03 * recency + cohesion };
}

function enforceMinimumBullets(
  candidates: Claim[],
  chosen: Map<string, string[]>,
  claims: Map<string, Claim>,
  controls: RunControls,
  config: CompilerConfig,
  byRequirement: Map<string, MatchEdge[]>,
  notes: string[],
) {
  const parents = new Set([...chosen.keys()].map((id) => claims.get(id)?.parent_id).filter((id): id is string => Boolean(id)));
  for (const parentId of parents) {
    const selected = [...chosen.keys()].map((id) => claims.get(id)!).filter((claim) => claim.parent_id === parentId && MAJOR_KINDS.has(claim.kind));
    if (selected.length === 0 || selected.length >= config.selection.min_bullets_per_entry) continue;
    if (selected.every((claim) => controls.pins.includes(claim.id)) && selected.length === 1 && controls.pins.length > 0) {
      notes.push(`${parentId} stays at one bullet because the reviewer pinned a single line.`);
      continue;
    }
    const sibling = candidates
      .filter((claim) => claim.parent_id === parentId && !chosen.has(claim.id) && edgesForClaim(claim.id, byRequirement).some((edge) => edge.counts_as_coverage))
      .sort((left, right) => right.line_cost_estimate - left.line_cost_estimate || left.id.localeCompare(right.id))[0];
    if (!sibling || !canAdd(sibling, chosen, claims, controls, config)) {
      notes.push(`${parentId} has one selected bullet because no second grounded claim is available.`);
      continue;
    }
    chosen.set(sibling.id, ["Added so the entry has at least two grounded bullets."]);
    notes.push(`Added ${sibling.id} to meet the two-bullet layout preference.`);
  }
}

function enforceExperience(
  candidates: Claim[],
  chosen: Map<string, string[]>,
  claims: Map<string, Claim>,
  controls: RunControls,
  config: CompilerConfig,
  byRequirement: Map<string, MatchEdge[]>,
  notes: string[],
) {
  const hasExperience = [...chosen.keys()].some((id) => claims.get(id)?.kind === "experience_bullet");
  if (hasExperience) return;
  const best = candidates
    .filter((claim) => claim.kind === "experience_bullet" && edgesForClaim(claim.id, byRequirement).some((edge) => edge.counts_as_coverage))
    .sort((left, right) => {
      const leftScore = edgesForClaim(left.id, byRequirement).reduce((sum, edge) => sum + edge.edge_score, 0);
      const rightScore = edgesForClaim(right.id, byRequirement).reduce((sum, edge) => sum + edge.edge_score, 0);
      return rightScore - leftScore || left.id.localeCompare(right.id);
    })[0];
  if (!best || !canAdd(best, chosen, claims, controls, config)) return;
  chosen.set(best.id, ["Included so the resume has a relevant experience entry."]);
  notes.push(`Forced experience claim ${best.id} because a grounded experience entry exists.`);
}

function chooseSummary(library: Library, controls: RunControls, byRequirement: Map<string, MatchEdge[]>): Claim | null {
  const summaries = library.claims.filter(
    (claim) => claim.kind === "summary" && eligible(claim) && !controls.excludes.includes(claim.id),
  );
  if (summaries.length === 0) return null;
  const preferred = library.profile.summary_claim_id
    ? summaries.find((claim) => claim.id === library.profile.summary_claim_id)
    : undefined;
  if (preferred) return preferred;
  return [...summaries].sort((left, right) => {
    const leftScore = edgesForClaim(left.id, byRequirement).reduce((sum, edge) => sum + edge.edge_score, 0);
    const rightScore = edgesForClaim(right.id, byRequirement).reduce((sum, edge) => sum + edge.edge_score, 0);
    return rightScore - leftScore || left.id.localeCompare(right.id);
  })[0] ?? null;
}

function canAdd(
  claim: Claim,
  chosen: Map<string, string[]>,
  claims: Map<string, Claim>,
  controls: RunControls,
  config: CompilerConfig,
): boolean {
  if (controls.excludes.includes(claim.id)) return false;
  const siblings = [...chosen.keys()].filter((id) => claims.get(id)?.parent_id === claim.parent_id && MAJOR_KINDS.has(claim.kind)).length;
  if (MAJOR_KINDS.has(claim.kind) && siblings >= config.selection.max_bullets_per_entry && !controls.pins.includes(claim.id)) {
    return false;
  }
  if (!MAJOR_KINDS.has(claim.kind)) return true;
  const parentAlready = [...chosen.keys()].some((id) => claims.get(id)?.parent_id === claim.parent_id && MAJOR_KINDS.has(claims.get(id)?.kind ?? "summary"));
  if (parentAlready) return true;
  const parents = new Set(
    [...chosen.keys()]
      .map((id) => claims.get(id))
      .filter((item): item is Claim => Boolean(item && MAJOR_KINDS.has(item.kind)))
      .map((item) => item.parent_id),
  );
  return parents.size < config.selection.max_major_entries;
}

function toLine(claim: Claim, reasons: string[], controls: RunControls, library: Library): SelectedLine {
  const edited = controls.edits[claim.id];
  const variantId = controls.variants[claim.id];
  const variant = variantId
    ? claim.approved_variants.find((item) => item.id === variantId && item.approved)
    : undefined;
  let output = claim.text;
  let origin: OutputOrigin = "source";
  let usedVariant: string | undefined;
  if (edited) {
    output = edited.trim();
    origin = "human_edit";
  } else if (variant) {
    output = variant.text;
    origin = "approved_variant";
    usedVariant = variant.id;
  }
  const rendered = claim.kind !== "eligibility" || controls.pins.includes(claim.id);
  return {
    claim_id: claim.id,
    parent_id: claim.parent_id,
    parent_label: parentLabel(library, claim.parent_id),
    kind: claim.kind,
    section: sectionFor(claim.kind),
    source: claim.source,
    ownership: claim.ownership,
    evidence_level: claim.evidence_level,
    text: claim.text,
    output_text: output,
    output_origin: origin,
    variant_id: usedVariant,
    rendered,
    reasons,
  };
}

function assignPrimaries(
  requirements: Requirement[],
  lines: SelectedLine[],
  byRequirement: Map<string, MatchEdge[]>,
): Map<string, MatchEdge> {
  const selected = new Set(lines.map((line) => line.claim_id));
  const primaries = new Map<string, MatchEdge>();
  for (const requirement of requirements) {
    const candidates = (byRequirement.get(requirement.id) ?? [])
      .filter((edge) => selected.has(edge.claim_id) && (edge.counts_as_coverage || edge.support === "text_review"))
      .sort((left, right) => {
        const leftBullet = lines.find((line) => line.claim_id === left.claim_id);
        const rightBullet = lines.find((line) => line.claim_id === right.claim_id);
        const leftRank = rankKind(leftBullet?.kind) + (left.counts_as_coverage ? 10 : 0);
        const rightRank = rankKind(rightBullet?.kind) + (right.counts_as_coverage ? 10 : 0);
        return rightRank - leftRank || right.edge_score - left.edge_score || left.claim_id.localeCompare(right.claim_id);
      });
    const best = candidates[0];
    if (best) primaries.set(requirement.id, best);
  }
  return primaries;
}

function coverageFrom(
  requirements: Requirement[],
  lines: SelectedLine[],
  byRequirement: Map<string, MatchEdge[]>,
  primaries: Map<string, MatchEdge>,
): RequirementCoverage[] {
  return requirements.map((requirement) => {
    if (requirement.kind === "ignore") {
      return baseCoverage(requirement, "ignored", null, "none", "Classified as administrative, benefits, or negated text and excluded from coverage.");
    }
    const primary = primaries.get(requirement.id) ?? null;
    if (!primary) {
      const blocked = (byRequirement.get(requirement.id) ?? []).find((edge) => edge.support === "none" && edge.explanation);
      return baseCoverage(
        requirement,
        "uncovered",
        null,
        "none",
        blocked?.explanation ?? "No selected claim verifies this requirement.",
      );
    }
    const line = lines.find((item) => item.claim_id === primary.claim_id);
    const state: CoverageState = primary.counts_as_coverage ? "verified" : "review";
    return baseCoverage(requirement, state, primary.claim_id, primary.support, `${primary.explanation} Output line: ${line?.output_text ?? primary.claim_id}.`);
  });
}

function baseCoverage(
  requirement: Requirement,
  state: CoverageState,
  claimId: string | null,
  support: RequirementCoverage["support"],
  explanation: string,
): RequirementCoverage {
  return {
    id: requirement.id,
    kind: requirement.kind,
    weight: requirement.weight,
    source_span: requirement.source_span,
    canonical_terms: requirement.canonical_terms,
    surface_forms: requirement.surface_forms,
    exposure_only: requirement.exposure_only,
    gate: requirement.gate,
    gate_type: requirement.gate_type,
    state,
    primary_claim_id: claimId,
    support,
    explanation,
  };
}

function toSuggestions(edges: MatchEdge[]): Suggestion[] {
  return edges.map((edge) => ({
    requirement_id: edge.requirement_id,
    claim_id: edge.claim_id,
    score: edge.channels.semantic,
    explanation: edge.explanation,
  }));
}

function edgesForClaim(claimId: string, byRequirement: Map<string, MatchEdge[]>): MatchEdge[] {
  const edges: MatchEdge[] = [];
  for (const groupEdges of byRequirement.values()) {
    for (const edge of groupEdges) if (edge.claim_id === claimId) edges.push(edge);
  }
  return edges;
}

function bestSelectedScore(requirementId: string, chosen: Map<string, string[]>, byRequirement: Map<string, MatchEdge[]>): number {
  let best = 0;
  for (const edge of byRequirement.get(requirementId) ?? []) {
    if (chosen.has(edge.claim_id) && edge.counts_as_coverage) best = Math.max(best, edge.edge_score);
  }
  return best;
}

function eligible(claim: Claim): boolean {
  return claim.visibility === "public" && claim.human_authored && claim.evidence_level !== "planned" && claim.ownership !== "planned";
}

function ineligibleReason(claim: Claim): string {
  if (claim.visibility === "private") return `Pinned claim ${claim.id} is private and cannot be rendered.`;
  if (claim.evidence_level === "planned" || claim.ownership === "planned") {
    return `Pinned claim ${claim.id} is planned work and cannot be presented as experience.`;
  }
  return `Pinned claim ${claim.id} cannot be selected.`;
}

function sectionFor(kind: Claim["kind"]): string {
  if (kind === "experience_bullet") return "Experience";
  if (kind === "project_bullet") return "Projects";
  if (kind === "leadership_bullet") return "Leadership";
  if (kind === "education") return "Education";
  if (kind === "summary") return "Summary";
  return "Eligibility";
}

function rankKind(kind: Claim["kind"] | undefined): number {
  if (kind === "experience_bullet" || kind === "project_bullet" || kind === "leadership_bullet") return 3;
  if (kind === "summary") return 2;
  if (kind === "education" || kind === "eligibility") return 1;
  return 0;
}

function evidenceBonus(claim: Claim): number {
  return claim.metrics.length > 0 ? 1 : 0.7;
}

function group<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    const list = map.get(id);
    if (list) list.push(item);
    else map.set(id, [item]);
  }
  return map;
}
