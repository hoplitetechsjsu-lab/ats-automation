export type EvidenceLevel =
  | "direct"
  | "supported_inference"
  | "context_only"
  | "planned";

export type Ownership =
  | "led"
  | "designed"
  | "integrated"
  | "contributed"
  | "evaluated"
  | "researched"
  | "planned"
  | "completed";

export type ClaimKind =
  | "summary"
  | "experience_bullet"
  | "project_bullet"
  | "leadership_bullet"
  | "education"
  | "eligibility";

export type EntryKind = "experience" | "project" | "leadership" | "education";

export type RequirementKind =
  | "gate"
  | "must"
  | "preferred"
  | "responsibility"
  | "soft"
  | "ignore";

export type Support =
  | "direct"
  | "alias"
  | "text_review"
  | "semantic_suggestion"
  | "none";

export type CoverageState =
  | "verified"
  | "review"
  | "uncovered"
  | "ignored"
  | "suggestion";

export type OutputOrigin = "source" | "approved_variant" | "human_edit";

export type GateType =
  | "degree"
  | "work_authorization"
  | "clearance"
  | "seniority"
  | "license"
  | null;

export interface DateRange {
  start: string;
  end: string | null;
}

export interface Skill {
  id: string;
  canonical: string;
  aliases: string[];
  category: string;
  exact_only: boolean;
  ambiguous_aliases: string[];
}

export interface Metric {
  value: string;
  unit?: string;
  context?: string;
}

export interface ApprovedVariant {
  id: string;
  text: string;
  approved: boolean;
}

export interface Claim {
  id: string;
  parent_id: string;
  kind: ClaimKind;
  text: string;
  human_authored: boolean;
  ownership: Ownership;
  source: string;
  dates: DateRange;
  skills: string[];
  aliases_approved: string[];
  metrics: Metric[];
  evidence_level: EvidenceLevel;
  visibility: "public" | "private";
  line_cost_estimate: number;
  approved_variants: ApprovedVariant[];
}

export interface Entry {
  id: string;
  kind: EntryKind;
  organization: string;
  title: string;
  location?: string;
  dates: DateRange;
}

export interface ProfileLink {
  label: string;
  url: string;
}

export interface Profile {
  name: string;
  location: string;
  email: string;
  phone?: string;
  links: ProfileLink[];
  summary_claim_id?: string;
}

export interface Library {
  profile: Profile;
  skills: Skill[];
  entries: Entry[];
  claims: Claim[];
}

export interface Requirement {
  id: string;
  source_span: string;
  surface_forms: string[];
  canonical_terms: string[];
  kind: RequirementKind;
  weight: number;
  gate: boolean;
  gate_type: GateType;
  exposure_only: boolean;
  any_of: boolean;
  confidence: "deterministic";
}

export interface MatchEdge {
  requirement_id: string;
  claim_id: string;
  channels: {
    exact: number;
    alias: number;
    semantic: number;
  };
  support: Support;
  edge_score: number;
  explanation: string;
  counts_as_coverage: boolean;
}

export interface RunControls {
  pins: string[];
  excludes: string[];
  variants: Record<string, string>;
  edits: Record<string, string>;
}

export interface ClaimSummary {
  id: string;
  text: string;
  kind: ClaimKind;
  evidence_level: EvidenceLevel;
  ownership: Ownership;
  visibility: "public" | "private";
  parent_id: string;
  parent_label: string;
  skills: string[];
  variants: { id: string; text: string }[];
  source: string;
}

export interface RequirementCoverage {
  id: string;
  kind: RequirementKind;
  weight: number;
  source_span: string;
  canonical_terms: string[];
  surface_forms: string[];
  exposure_only: boolean;
  gate: boolean;
  gate_type: GateType;
  state: CoverageState;
  primary_claim_id: string | null;
  support: Support;
  explanation: string;
}

export interface SelectedLine {
  claim_id: string;
  parent_id: string;
  parent_label: string;
  kind: ClaimKind;
  section: string;
  source: string;
  ownership: Ownership;
  evidence_level: EvidenceLevel;
  text: string;
  output_text: string;
  output_origin: OutputOrigin;
  variant_id?: string;
  rendered: boolean;
  reasons: string[];
}

export interface Suggestion {
  requirement_id: string;
  claim_id: string;
  score: number;
  explanation: string;
}

export interface Quarantine {
  text: string;
  reason: string;
}

export interface ResumeBullet {
  claim_id: string;
  text: string;
}

export interface ResumeEntry {
  entry_id: string;
  heading: string;
  meta: string;
  bullets: ResumeBullet[];
}

export interface ResumeSection {
  id: "experience" | "projects" | "leadership" | "education";
  heading: string;
  entries: ResumeEntry[];
}

export interface ResumeDocument {
  name: string;
  contact_line: string;
  summary?: { text: string; claim_id: string };
  sections: ResumeSection[];
  skills_line?: string;
}

export interface Report {
  status: "valid" | "failed";
  run_id: string;
  library_hash: string;
  jd_hash: string;
  config_hash: string;
  controls_hash: string;
  input_hash: string;
  evidence_ceiling: "strong" | "partial" | "weak";
  semantic_mode: "lexical_overlap" | "off";
  hard_coverage: number;
  dimensions: {
    parse_readability: number;
    requirement_coverage: number;
    context_coverage: number;
    human_density: number;
    unsupported_claim_count: number;
  };
  diagnostic_index: {
    label: string;
    value: number | null;
    components: string[];
    note: string;
  };
  requirements: RequirementCoverage[];
  selected: SelectedLine[];
  suggestions: Suggestion[];
  quarantined: Quarantine[];
  failures: string[];
  notes: string[];
  claims: ClaimSummary[];
  verification: {
    pages: number | null;
    text_order_ok: boolean;
    name_found: boolean;
    email_found: boolean;
    bullets_found: number;
    bullets_expected: number;
    reasons: string[];
  };
}

export interface CompileResult {
  report: Report;
  resume: ResumeDocument | null;
  html: string | null;
  pdf: Buffer | null;
  markdown: string;
}
