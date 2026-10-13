import { parse } from "yaml";
import { numberTokens, tokenize, tokensContain } from "./normalize";
import type {
  ApprovedVariant,
  Claim,
  ClaimKind,
  ClaimSummary,
  Entry,
  EntryKind,
  EvidenceLevel,
  Library,
  Ownership,
  Skill,
} from "./types";

const CLAIM_KINDS = new Set<ClaimKind>([
  "summary",
  "experience_bullet",
  "project_bullet",
  "leadership_bullet",
  "education",
  "eligibility",
]);

const ENTRY_KINDS = new Set<EntryKind>([
  "experience",
  "project",
  "leadership",
  "education",
]);

const EVIDENCE = new Set<EvidenceLevel>([
  "direct",
  "supported_inference",
  "context_only",
  "planned",
]);

const OWNERSHIP = new Set<Ownership>([
  "led",
  "designed",
  "integrated",
  "contributed",
  "evaluated",
  "researched",
  "planned",
  "completed",
]);

const OWNERSHIP_RANK: Record<Ownership, number> = {
  planned: 0,
  researched: 1,
  evaluated: 1,
  contributed: 2,
  completed: 2,
  integrated: 3,
  designed: 3,
  led: 4,
};

const OWNERSHIP_PATTERNS: { ownership: Ownership; pattern: RegExp }[] = [
  { ownership: "led", pattern: /\b(led|owned|managed|directed)\b/i },
  { ownership: "designed", pattern: /\b(designed|architected)\b/i },
  { ownership: "integrated", pattern: /\b(integrated|implemented|built|shipped|developed|wrote|deployed|operated)\b/i },
  { ownership: "contributed", pattern: /\b(contributed|assisted|helped|supported)\b/i },
  { ownership: "evaluated", pattern: /\b(evaluated|assessed|compared)\b/i },
  { ownership: "researched", pattern: /\b(researched|studied|investigated)\b/i },
  { ownership: "planned", pattern: /\b(planned|proposed)\b/i },
];

export class LibraryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LibraryError";
  }
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LibraryError(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new LibraryError(`${label} must be a non-empty string.`);
  }
  return value.trim();
}

function asStringList(value: unknown, label: string): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new LibraryError(`${label} must be a list of strings.`);
  }
  return value.map((item) => item.trim()).filter(Boolean);
}

export function loadLibrary(yamlText: string): Library {
  let raw: unknown;
  try {
    raw = parse(yamlText);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid YAML";
    throw new LibraryError(`Could not parse the evidence library: ${message}`);
  }
  const root = asRecord(raw, "library");
  const profileRaw = asRecord(root.profile, "profile");
  const skills = parseSkills(root.skills);
  const entries = parseEntries(root.entries);
  const claims = parseClaims(root.claims, skills, entries);
  const summaryId =
    profileRaw.summary_claim_id === undefined
      ? undefined
      : asString(profileRaw.summary_claim_id, "profile.summary_claim_id");
  if (summaryId && !claims.some((claim) => claim.id === summaryId && claim.kind === "summary")) {
    throw new LibraryError(`profile.summary_claim_id ${summaryId} does not match a summary claim.`);
  }
  const links = Array.isArray(profileRaw.links) ? profileRaw.links : [];
  return {
    profile: {
      name: asString(profileRaw.name, "profile.name"),
      location: asString(profileRaw.location, "profile.location"),
      email: asString(profileRaw.email, "profile.email"),
      phone: profileRaw.phone === undefined ? undefined : asString(profileRaw.phone, "profile.phone"),
      links: links.map((link, index) => {
        const record = asRecord(link, `profile.links[${index}]`);
        return {
          label: asString(record.label, `profile.links[${index}].label`),
          url: asString(record.url, `profile.links[${index}].url`),
        };
      }),
      summary_claim_id: summaryId,
    },
    skills,
    entries,
    claims,
  };
}

function parseSkills(value: unknown): Skill[] {
  if (!Array.isArray(value)) throw new LibraryError("skills must be a list.");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = asRecord(item, `skills[${index}]`);
    const id = asString(record.id, `skills[${index}].id`);
    if (seen.has(id)) throw new LibraryError(`Duplicate skill id ${id}.`);
    seen.add(id);
    return {
      id,
      canonical: asString(record.canonical, `skills[${index}].canonical`),
      aliases: asStringList(record.aliases, `skills[${index}].aliases`),
      category: asString(record.category, `skills[${index}].category`),
      exact_only: record.exact_only === true,
      ambiguous_aliases: asStringList(record.ambiguous_aliases, `skills[${index}].ambiguous_aliases`),
    };
  });
}

function parseEntries(value: unknown): Entry[] {
  if (!Array.isArray(value)) throw new LibraryError("entries must be a list.");
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = asRecord(item, `entries[${index}]`);
    const id = asString(record.id, `entries[${index}].id`);
    if (seen.has(id)) throw new LibraryError(`Duplicate entry id ${id}.`);
    seen.add(id);
    const kind = asString(record.kind, `entries[${index}].kind`) as EntryKind;
    if (!ENTRY_KINDS.has(kind)) throw new LibraryError(`entries[${index}].kind is not supported.`);
    const dates = asRecord(record.dates, `entries[${index}].dates`);
    return {
      id,
      kind,
      organization: asString(record.organization, `entries[${index}].organization`),
      title: asString(record.title, `entries[${index}].title`),
      location: record.location === undefined ? undefined : asString(record.location, `entries[${index}].location`),
      dates: {
        start: asString(dates.start, `entries[${index}].dates.start`),
        end: dates.end === null || dates.end === undefined ? null : asString(dates.end, `entries[${index}].dates.end`),
      },
    };
  });
}

function parseClaims(value: unknown, skills: Skill[], entries: Entry[]): Claim[] {
  if (!Array.isArray(value)) throw new LibraryError("claims must be a list.");
  const skillIds = new Set(skills.map((skill) => skill.id));
  const entryIds = new Set(entries.map((entry) => entry.id));
  const seen = new Set<string>();
  return value.map((item, index) => {
    const record = asRecord(item, `claims[${index}]`);
    const id = asString(record.id, `claims[${index}].id`);
    if (seen.has(id)) throw new LibraryError(`Duplicate claim id ${id}.`);
    seen.add(id);
    const kind = asString(record.kind, `claims[${index}].kind`) as ClaimKind;
    if (!CLAIM_KINDS.has(kind)) throw new LibraryError(`claims[${index}].kind is not supported.`);
    const parentId = asString(record.parent_id, `claims[${index}].parent_id`);
    if (parentId !== "profile" && !entryIds.has(parentId)) {
      throw new LibraryError(`claims[${index}] parent_id ${parentId} does not match an entry.`);
    }
    const evidence = asString(record.evidence_level, `claims[${index}].evidence_level`) as EvidenceLevel;
    if (!EVIDENCE.has(evidence)) throw new LibraryError(`claims[${index}].evidence_level is not supported.`);
    const ownership = asString(record.ownership, `claims[${index}].ownership`) as Ownership;
    if (!OWNERSHIP.has(ownership)) throw new LibraryError(`claims[${index}].ownership is not supported.`);
    const visibility = asString(record.visibility, `claims[${index}].visibility`);
    if (visibility !== "public" && visibility !== "private") {
      throw new LibraryError(`claims[${index}].visibility must be public or private.`);
    }
    if (record.human_authored !== true) {
      throw new LibraryError(`claims[${index}] must be human_authored. Generated bullets are not source text.`);
    }
    const claimSkills = asStringList(record.skills, `claims[${index}].skills`);
    for (const skillId of claimSkills) {
      if (!skillIds.has(skillId)) throw new LibraryError(`claims[${index}] references unknown skill ${skillId}.`);
    }
    const dates = asRecord(record.dates, `claims[${index}].dates`);
    const lineCost = record.line_cost_estimate;
    if (typeof lineCost !== "number" || lineCost <= 0) {
      throw new LibraryError(`claims[${index}].line_cost_estimate must be a positive number.`);
    }
    const metrics = Array.isArray(record.metrics)
      ? record.metrics.map((metric, metricIndex) => {
          const metricRecord = asRecord(metric, `claims[${index}].metrics[${metricIndex}]`);
          return {
            value: asString(metricRecord.value, `claims[${index}].metrics[${metricIndex}].value`),
            unit: metricRecord.unit === undefined ? undefined : asString(metricRecord.unit, `claims[${index}].metrics[${metricIndex}].unit`),
            context:
              metricRecord.context === undefined
                ? undefined
                : asString(metricRecord.context, `claims[${index}].metrics[${metricIndex}].context`),
          };
        })
      : [];
    const variants = parseVariants(record.approved_variants, index);
    const claim: Claim = {
      id,
      parent_id: parentId,
      kind,
      text: asString(record.text, `claims[${index}].text`),
      human_authored: true,
      ownership,
      source: asString(record.source, `claims[${index}].source`),
      dates: {
        start: asString(dates.start, `claims[${index}].dates.start`),
        end: dates.end === null || dates.end === undefined ? null : asString(dates.end, `claims[${index}].dates.end`),
      },
      skills: claimSkills,
      aliases_approved: asStringList(record.aliases_approved, `claims[${index}].aliases_approved`),
      metrics,
      evidence_level: evidence,
      visibility,
      line_cost_estimate: lineCost,
      approved_variants: variants,
    };
    for (const variant of variants) {
      if (!variant.approved) continue;
      const problem = guardWording(claim, variant.text, skills);
      if (problem) throw new LibraryError(`claims[${index}] variant ${variant.id} ${problem}`);
    }
    return claim;
  });
}

function parseVariants(value: unknown, index: number): ApprovedVariant[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new LibraryError(`claims[${index}].approved_variants must be a list.`);
  return value.map((item, variantIndex) => {
    const record = asRecord(item, `claims[${index}].approved_variants[${variantIndex}]`);
    return {
      id: asString(record.id, `claims[${index}].approved_variants[${variantIndex}].id`),
      text: asString(record.text, `claims[${index}].approved_variants[${variantIndex}].text`),
      approved: record.approved === true,
    };
  });
}

export function guardWording(claim: Claim, text: string, skills: Skill[]): string | null {
  const trimmed = text.trim();
  if (!trimmed) return "is empty.";
  const sourceNumbers = numberTokens(claim.text);
  const nextNumbers = numberTokens(trimmed);
  const remaining = [...sourceNumbers];
  for (const token of nextNumbers) {
    const found = remaining.indexOf(token);
    if (found < 0) return `introduces a number or quantity (${token}) that is not in the source claim.`;
    remaining.splice(found, 1);
  }
  const upgrade = ownershipUpgrade(claim, trimmed);
  if (upgrade) return upgrade;
  const invented = inventedSkill(claim, trimmed, skills);
  if (invented) return invented;
  return null;
}

function ownershipUpgrade(claim: Claim, text: string): string | null {
  const originalRank = OWNERSHIP_RANK[claim.ownership];
  for (const candidate of OWNERSHIP_PATTERNS) {
    if (!candidate.pattern.test(text)) continue;
    if (candidate.pattern.test(claim.text)) continue;
    if (OWNERSHIP_RANK[candidate.ownership] > originalRank) {
      return `raises ownership from ${claim.ownership} to ${candidate.ownership}.`;
    }
  }
  return null;
}

function inventedSkill(claim: Claim, text: string, skills: Skill[]): string | null {
  const original = tokenize(claim.text);
  const edited = tokenize(text);
  for (const skill of skills) {
    const surfaces = [skill.canonical, ...skill.aliases].filter(
      (surface) => !skill.ambiguous_aliases.some((alias) => alias.toLowerCase() === surface.toLowerCase()),
    );
    for (const surface of surfaces) {
      if (tokenize(surface).length < 1) continue;
      if (skill.ambiguous_aliases.map((alias) => alias.toLowerCase()).includes(surface.toLowerCase())) continue;
      if (surface.length < 4 && skill.exact_only) continue;
      const inEdit = tokensContain(edited, surface);
      const inSource = tokensContain(original, surface);
      if (inEdit && !inSource && !claim.skills.includes(skill.id)) {
        return `introduces ${skill.canonical}, which this claim does not support.`;
      }
    }
  }
  return null;
}

export function claimSummaries(library: Library): ClaimSummary[] {
  return library.claims.map((claim) => ({
    id: claim.id,
    text: claim.text,
    kind: claim.kind,
    evidence_level: claim.evidence_level,
    ownership: claim.ownership,
    visibility: claim.visibility,
    parent_id: claim.parent_id,
    parent_label: parentLabel(library, claim.parent_id),
    skills: claim.skills,
    variants: claim.approved_variants
      .filter((variant) => variant.approved)
      .map((variant) => ({ id: variant.id, text: variant.text })),
    source: claim.source,
  }));
}

export function parentLabel(library: Library, parentId: string): string {
  const entry = library.entries.find((item) => item.id === parentId);
  if (!entry) return parentId === "profile" ? "Profile" : parentId;
  return `${entry.title}, ${entry.organization}`;
}

export function skillById(library: Library, id: string): Skill | undefined {
  return library.skills.find((skill) => skill.id === id);
}
