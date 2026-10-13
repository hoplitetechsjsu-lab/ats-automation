import type { CompilerConfig } from "./config";
import { tokenize, tokensContain } from "./normalize";
import type { GateType, Library, Quarantine, Requirement, RequirementKind, Skill } from "./types";

interface VocabEntry {
  skillId: string;
  form: string;
  ambiguous: boolean;
  exactOnly: boolean;
}

const HEADINGS: { kind: RequirementKind; pattern: RegExp }[] = [
  {
    kind: "ignore",
    pattern:
      /^(about( us)?|who we are|the company|company overview|benefits|perks|what we offer|compensation|equal opportunity|eeo|how to apply|application process|to apply)\b/i,
  },
  {
    kind: "responsibility",
    pattern: /^(responsibilities|what you('ll| will) do|the role|day[- ]to[- ]day|in this role)\b/i,
  },
  {
    kind: "must",
    pattern: /^(requirements|qualifications|what you('ll| will) need|must[- ]haves?|required|what you bring)\b/i,
  },
  {
    kind: "preferred",
    pattern: /^(preferred|nice to have|nice-to-have|bonus|good to have|pluses)\b/i,
  },
  {
    kind: "soft",
    pattern: /^(soft skills|culture|who you are|how you work)\b/i,
  },
];

const INJECTION = [
  /ignore (all |any |the )?(previous|prior|above) (instructions|prompts|rules)/i,
  /disregard (the |all )?(rules|instructions|system|above)/i,
  /\byou are now\b/i,
  /\bsystem prompt\b/i,
  /\bact as (a |an )?(chatgpt|llm|language model|assistant)\b/i,
];

export function parseJobDescription(
  raw: string,
  library: Library,
  config: CompilerConfig,
): { requirements: Requirement[]; quarantined: Quarantine[] } {
  const { text, quarantined } = sanitize(raw);
  const vocab = buildVocab(library.skills);
  const requirements: Requirement[] = [];
  let section: RequirementKind = "preamble" as RequirementKind;
  let index = 1;

  const push = (requirement: Omit<Requirement, "id" | "weight" | "confidence" | "gate"> & { kind: RequirementKind }) => {
    const kind = requirement.kind;
    requirements.push({
      ...requirement,
      id: `req-${String(index).padStart(2, "0")}`,
      kind,
      weight: config.requirement_weights[kind],
      gate: kind === "gate",
      confidence: "deterministic",
    });
    index += 1;
  };

  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const heading = matchHeading(trimmed);
    if (heading) {
      section = heading;
      continue;
    }
    const bullet = trimmed.replace(/^([-*•]|\d+[.)])\s+/, "");
    const isBullet = bullet !== trimmed;
    const kind = section === ("preamble" as RequirementKind) ? (isBullet ? "responsibility" : "ignore") : section;
    if (kind === "ignore") {
      push({
        source_span: bullet,
        surface_forms: [],
        canonical_terms: [],
        kind: "ignore",
        gate_type: null,
        exposure_only: false,
        any_of: false,
      });
      continue;
    }
    for (const clause of splitClauses(bullet)) {
      const emitted = emitClause(clause, kind, vocab, push);
      if (!emitted) {
        push({
          source_span: clause,
          surface_forms: [],
          canonical_terms: [],
          kind: classifyBare(clause, kind),
          gate_type: gateType(clause),
          exposure_only: isExposure(clause),
          any_of: false,
        });
      }
    }
  }

  return { requirements, quarantined };
}

function sanitize(raw: string): { text: string; quarantined: Quarantine[] } {
  const cleaned = raw
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ");
  const quarantined: Quarantine[] = [];
  const kept: string[] = [];
  for (const line of cleaned.split("\n")) {
    const stripped = line.replace(/<[^>]+>/g, " ");
    if (INJECTION.some((pattern) => pattern.test(stripped))) {
      quarantined.push({
        text: stripped.trim().slice(0, 240),
        reason: "Instruction-like text was quarantined and was not read as a job requirement.",
      });
      continue;
    }
    kept.push(stripped);
  }
  return { text: kept.join("\n"), quarantined };
}

function matchHeading(line: string): RequirementKind | null {
  if (line.length > 80 || /[.!?]$/.test(line)) return null;
  const bare = line.replace(/:$/, "").trim();
  for (const heading of HEADINGS) {
    if (heading.pattern.test(bare)) return heading.kind;
  }
  return null;
}

function splitClauses(bullet: string): string[] {
  return bullet
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function emitClause(
  clause: string,
  sectionKind: RequirementKind,
  vocab: VocabEntry[],
  push: (requirement: Omit<Requirement, "id" | "weight" | "confidence" | "gate"> & { kind: RequirementKind }) => void,
): boolean {
  if (clauseNegated(clause)) {
    push({
      source_span: clause,
      surface_forms: [],
      canonical_terms: [],
      kind: "ignore",
      gate_type: null,
      exposure_only: false,
      any_of: false,
    });
    return true;
  }
  const matches = findSkillMatches(clause, vocab);
  const years = clause.match(/\b\d+\+?\s+years\b/i);
  const specialGate = gateType(clause);
  let emitted = false;
  if (years || (specialGate && specialGate !== null && matches.length === 0)) {
    push({
      source_span: clause,
      surface_forms: years ? [years[0]] : [],
      canonical_terms: specialGate ? [specialGate] : [],
      kind: "gate",
      gate_type: specialGate ?? (years ? "seniority" : null),
      exposure_only: false,
      any_of: false,
    });
    emitted = true;
    if (matches.length === 0) return true;
  }
  if (matches.length === 0) return emitted;
  const kind = adjustKind(clause, sectionKind);
  const uniqueMatches: typeof matches = [];
  const seenSkills = new Set<string>();
  for (const match of matches) {
    if (seenSkills.has(match.skillId)) continue;
    seenSkills.add(match.skillId);
    uniqueMatches.push(match);
  }
  const betweenOr =
    uniqueMatches.length === 2 &&
    tokensBetween(clause, uniqueMatches[0].form, uniqueMatches[1].form).toLowerCase().trim() === "or";
  if (betweenOr) {
    push({
      source_span: clause,
      surface_forms: uniqueMatches.map((match) => match.form),
      canonical_terms: uniqueMatches.map((match) => match.skillId),
      kind,
      gate_type: null,
      exposure_only: isExposure(clause),
      any_of: true,
    });
    return true;
  }
  for (const match of uniqueMatches) {
    push({
      source_span: clause,
      surface_forms: [match.form],
      canonical_terms: [match.skillId],
      kind,
      gate_type: null,
      exposure_only: isExposure(clause),
      any_of: false,
    });
  }
  return true;
}

function tokensBetween(clause: string, left: string, right: string): string {
  const normalized = clause.toLowerCase();
  const start = normalized.indexOf(left.toLowerCase());
  const end = normalized.indexOf(right.toLowerCase());
  if (start < 0 || end < 0 || end <= start) return "";
  return clause.slice(start + left.length, end);
}

function adjustKind(clause: string, sectionKind: RequirementKind): RequirementKind {
  if (isExposure(clause)) return "preferred";
  if (/\b(preferred|nice to have|bonus|plus)\b/i.test(clause) && sectionKind === "must") return "preferred";
  if (isSoft(clause) && !/\b(required|must)\b/i.test(clause)) return "soft";
  if (isAdministrative(clause)) return "ignore";
  return sectionKind;
}

function classifyBare(clause: string, sectionKind: RequirementKind): RequirementKind {
  if (gateType(clause)) return "gate";
  if (isExposure(clause)) return "preferred";
  if (isSoft(clause)) return "soft";
  if (isAdministrative(clause)) return "ignore";
  return sectionKind;
}

function clauseNegated(clause: string): boolean {
  return (
    /\b(not required|is not required|are not required|no experience (with|in)|do not require|don't require|without the need|is not a requirement)\b/i.test(
      clause,
    ) || /\b(no|not)\b[^.]{0,48}\brequired\b/i.test(clause)
  );
}

function isExposure(clause: string): boolean {
  return /\b(familiarity with|exposure to|awareness of|nice if you have)\b/i.test(clause);
}

function isSoft(clause: string): boolean {
  return /\b(communication|collaborate|collaboration|teamwork|interpersonal|stakeholder)\b/i.test(clause);
}

function isAdministrative(clause: string): boolean {
  return /\b(dental|vision|401\(k\)|401k|health insurance|paid time off|pto|equal opportunity|do not discriminate|salary)\b/i.test(
    clause,
  );
}

function gateType(clause: string): GateType {
  if (/\b(authorized to work|work authorization|u\.?s\.? citizen|citizenship)\b/i.test(clause)) {
    return "work_authorization";
  }
  if (/\b(security clearance|clearance required)\b/i.test(clause)) return "clearance";
  if (/\b(bachelor(?:'s)?|b\.s\.|master(?:'s)?|m\.s\.|ph\.?d\.?)\b/i.test(clause)) return "degree";
  if (/\b(driver's license|license required)\b/i.test(clause)) return "license";
  if (/\b\d+\+?\s+years\b/i.test(clause)) return "seniority";
  return null;
}

function buildVocab(skills: Skill[]): VocabEntry[] {
  const entries: VocabEntry[] = [];
  for (const skill of skills) {
    const add = (form: string) => {
      const trimmed = form.trim();
      if (!trimmed) return;
      entries.push({
        skillId: skill.id,
        form: trimmed,
        ambiguous: false,
        exactOnly: skill.exact_only,
      });
    };
    add(skill.canonical);
    if (skill.id.toLowerCase() !== skill.canonical.toLowerCase()) add(skill.id);
    for (const alias of skill.aliases) add(alias);
  }
  const unique = new Map<string, VocabEntry>();
  for (const entry of entries) unique.set(`${entry.skillId}:${entry.form.toLowerCase()}`, entry);
  return [...unique.values()].sort((left, right) => right.form.length - left.form.length);
}

function findSkillMatches(clause: string, vocab: VocabEntry[]): { skillId: string; form: string; ambiguous: boolean }[] {
  const tokens = tokenize(clause);
  const used = new Set<number>();
  const found: { skillId: string; form: string; ambiguous: boolean }[] = [];
  for (const entry of vocab) {
    if (!surfaceAllowedInClause(clause, entry)) continue;
    const hit = tokensContain(tokens, entry.form);
    if (!hit) continue;
    let overlaps = false;
    for (let offset = 0; offset < hit.length; offset += 1) {
      if (used.has(hit.index + offset)) overlaps = true;
    }
    if (overlaps) continue;
    for (let offset = 0; offset < hit.length; offset += 1) used.add(hit.index + offset);
    found.push({ skillId: entry.skillId, form: entry.form, ambiguous: entry.ambiguous });
  }
  return found;
}

function surfaceAllowedInClause(clause: string, entry: VocabEntry): boolean {
  if (entry.form.length >= 4 && !entry.exactOnly) return true;
  if (entry.form.length >= 4 && entry.exactOnly) return true;
  const escaped = entry.form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const cased = new RegExp(`(?:^|[^A-Za-z0-9+#])${escaped}(?=$|[^A-Za-z0-9+#])`);
  const upper = new RegExp(`(?:^|[^A-Za-z0-9+#])${escaped.toUpperCase()}(?=$|[^A-Za-z0-9+#])`);
  if (entry.exactOnly) return cased.test(clause) || upper.test(clause);
  const loose = new RegExp(`(?:^|[^A-Za-z0-9+#])${escaped}(?=$|[^A-Za-z0-9+#])`, "i");
  return loose.test(clause);
}

export function requirementLabel(requirement: Requirement, library: Library): string {
  if (requirement.canonical_terms.length === 0) return requirement.source_span;
  return requirement.canonical_terms
    .map((term) => library.skills.find((skill) => skill.id === term)?.canonical ?? term.replaceAll("_", " "))
    .join(requirement.any_of ? " or " : ", ");
}
