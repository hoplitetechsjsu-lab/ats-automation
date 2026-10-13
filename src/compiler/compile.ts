import { resolveConfig, type CompilerConfig } from "./config";
import { sha256 } from "./hash";
import { claimSummaries, guardWording, loadLibrary } from "./library";
import { matchRequirements, suggestOverlaps } from "./match";
import { extractPdfText, renderPdf, verifyResumeText } from "./pdf";
import { parseJobDescription } from "./parse-jd";
import { renderMarkdown } from "./report";
import { buildResume, relevantSkillIds, renderHtml } from "./render";
import { selectEvidence } from "./select";
import type { CompileResult, Library, MatchEdge, Report, Requirement, RunControls, SelectedLine } from "./types";

const EMPTY_CONTROLS: RunControls = { pins: [], excludes: [], variants: {}, edits: {} };

export interface CompileInput {
  library: Library;
  jd: string;
  controls?: Partial<RunControls>;
  config?: Partial<CompilerConfig>;
}

export async function compile(input: CompileInput): Promise<CompileResult> {
  const config = resolveConfig(input.config);
  const controls = normalizeControls(input.controls);
  const libraryHash = sha256(input.library);
  const jdHash = sha256(input.jd);
  const configHash = sha256(config);
  const controlsHash = sha256(controls);
  const inputHash = sha256({ libraryHash, jdHash, configHash, controlsHash });
  const claims = claimSummaries(input.library);

  if (!input.jd.trim()) {
    const report = emptyReport({
      inputHash,
      libraryHash,
      jdHash,
      configHash,
      controlsHash,
      claims,
      semanticMode: config.semantic.mode,
      failures: ["Paste a job description before compiling."],
    });
    return { report, resume: null, html: null, pdf: null, markdown: renderMarkdown(report) };
  }

  const parsed = parseJobDescription(input.jd, input.library, config);
  const baseEdges = matchRequirements(input.library, parsed.requirements, config);
  const suggestionEdges = suggestOverlaps(input.library, parsed.requirements, baseEdges, config);
  const dropped: string[] = [];
  let last:
    | {
        lines: SelectedLine[];
        reportBase: ReturnType<typeof selectEvidence>;
        edges: MatchEdge[];
      }
    | undefined;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const selection = selectEvidence(
      input.library,
      parsed.requirements,
      baseEdges,
      suggestionEdges,
      { ...controls, excludes: [...controls.excludes, ...dropped] },
      config,
    );
    last = { lines: selection.lines, reportBase: selection, edges: baseEdges };
    if (selection.fatal) break;
    const skillIds = relevantSkillIds(
      input.library,
      selection.lines,
      selection.coverage.filter((item) => item.state === "verified").flatMap((item) => item.canonical_terms),
    );
    const resume = buildResume(input.library, selection.lines, skillIds);
    const rendered = await renderPdf(resume);
    const extracted = extractPdfText(rendered.pdf);
    const check = verifyResumeText(resume, extracted.text, input.library.profile.email);
    const pages = rendered.overflow ? Math.max(extracted.pageCount, 2) : extracted.pageCount;
    const unsupported = unsupportedClaims(input.library, selection.lines);
    const pageOk = pages === 1;
    if (!pageOk && attempt < 7) {
      const victim = nextDrop(selection.lines, controls, baseEdges);
      if (victim) {
        dropped.push(victim);
        continue;
      }
    }
    const verificationOk = check.ok && pageOk && unsupported.length === 0;
    {
      const report = finishReport({
        inputHash,
        libraryHash,
        jdHash,
        configHash,
        controlsHash,
        claims,
        config,
        requirements: parsed.requirements,
        selection,
        quarantined: parsed.quarantined,
        pages,
        check,
        unsupported,
        dropped,
        valid: verificationOk && !selection.fatal,
      });
      const markdown = renderMarkdown(report);
      if (!verificationOk || selection.fatal) {
        return { report, resume, html: renderHtml(resume), pdf: rendered.pdf, markdown };
      }
      return { report, resume, html: renderHtml(resume), pdf: rendered.pdf, markdown };
    }
  }

  const selection = last?.reportBase;
  const report = emptyReport({
    inputHash,
    libraryHash,
    jdHash,
    configHash,
    controlsHash,
    claims,
    semanticMode: config.semantic.mode,
    failures: selection?.failures.length ? selection.failures : ["The resume could not be verified."],
    quarantined: parsed.quarantined,
    notes: dropped.length ? [`Dropped ${dropped.join(", ")} to chase a one-page layout.`] : [],
  });
  return { report, resume: null, html: null, pdf: null, markdown: renderMarkdown(report) };
}

export function compileLibraryYaml(yamlText: string, jd: string, controls?: Partial<RunControls>): Promise<CompileResult> {
  return compile({ library: loadLibrary(yamlText), jd, controls });
}

function finishReport(args: {
  inputHash: string;
  libraryHash: string;
  jdHash: string;
  configHash: string;
  controlsHash: string;
  claims: Report["claims"];
  config: CompilerConfig;
  requirements: Requirement[];
  selection: ReturnType<typeof selectEvidence>;
  quarantined: Report["quarantined"];
  pages: number;
  check: ReturnType<typeof verifyResumeText>;
  unsupported: string[];
  dropped: string[];
  valid: boolean;
}): Report {
  const hard = args.selection.coverage.filter((item) => item.kind === "must" || item.kind === "gate");
  const counted = args.selection.coverage.filter((item) => item.kind !== "ignore");
  const hardCoverage = ratio(
    hard.filter((item) => item.state === "verified"),
    hard,
  );
  const requirementCoverage = ratio(
    counted.filter((item) => item.state === "verified"),
    counted,
  );
  const musts = args.selection.coverage.filter((item) => item.kind === "must" && item.state === "verified");
  const contextHits = musts.filter((item) => {
    const line = args.selection.lines.find((selected) => selected.claim_id === item.primary_claim_id);
    return line?.kind === "experience_bullet" || line?.kind === "project_bullet" || line?.kind === "leadership_bullet" || line?.kind === "summary";
  });
  const contextCoverage = musts.length === 0 ? 0 : contextHits.length / musts.length;
  const bullets = args.selection.lines.filter((line) => line.rendered && line.kind !== "summary" && line.kind !== "education" && line.kind !== "eligibility");
  const dense = bullets.filter((line) => {
    const claim = args.claims.find((item) => item.id === line.claim_id);
    const shortEnough = line.output_text.length <= 220;
    const metricOk = !claim || true;
    const source = line.text;
    const metricPresent = !/\d/.test(source) || numberOverlap(source, line.output_text);
    return shortEnough && metricOk && metricPresent && line.output_text.trim().length > 0;
  });
  const humanDensity = bullets.length === 0 ? 0.5 : dense.length / bullets.length;
  const parseReadability = args.check.ok && args.pages === 1 ? 1 : args.check.nameFound && args.check.emailFound ? 0.4 : 0;
  const uncoveredGate = hard.some((item) => item.kind === "gate" && item.state !== "verified");
  let ceiling: Report["evidence_ceiling"] = "weak";
  if (hardCoverage >= args.config.evidence_ceiling.strong && !uncoveredGate) ceiling = "strong";
  else if (hardCoverage >= args.config.evidence_ceiling.partial) ceiling = "partial";
  const failures = [...args.selection.failures];
  if (args.unsupported.length > 0) failures.push(...args.unsupported);
  if (args.pages !== 1) failures.push(`Verification failed: rendered ${args.pages} pages. A one-page resume is required.`);
  if (!args.check.ok) failures.push(...args.check.reasons);
  const notes = [...args.selection.notes];
  if (args.dropped.length > 0) notes.push(`Removed ${args.dropped.join(", ")} so the rendered resume stays on one page.`);
  const diagnosticValue = failures.length > 0 && args.unsupported.length > 0
    ? null
    : round(100 * (0.5 * requirementCoverage + 0.2 * contextCoverage + 0.2 * parseReadability + 0.1 * humanDensity));
  return {
    status: args.valid ? "valid" : "failed",
    run_id: args.inputHash.slice(0, 12),
    library_hash: args.libraryHash,
    jd_hash: args.jdHash,
    config_hash: args.configHash,
    controls_hash: args.controlsHash,
    input_hash: args.inputHash,
    evidence_ceiling: ceiling,
    semantic_mode: args.config.semantic.mode === "off" ? "off" : "lexical_overlap",
    hard_coverage: round(hardCoverage),
    dimensions: {
      parse_readability: round(parseReadability),
      requirement_coverage: round(requirementCoverage),
      context_coverage: round(contextCoverage),
      human_density: round(humanDensity),
      unsupported_claim_count: args.unsupported.length,
    },
    diagnostic_index: {
      label: "Grounded coverage index",
      value: args.valid ? diagnosticValue : null,
      components: ["requirement_coverage", "context_coverage", "parse_readability", "human_density"],
      note: "Project-specific diagnostic. Not an employer ATS score. Unsupported claims withhold a passing result.",
    },
    requirements: args.selection.coverage,
    selected: args.selection.lines,
    suggestions: args.selection.suggestions,
    quarantined: args.quarantined,
    failures,
    notes,
    claims: args.claims,
    verification: {
      pages: args.pages,
      text_order_ok: args.check.ok,
      name_found: args.check.nameFound,
      email_found: args.check.emailFound,
      bullets_found: args.check.bulletsFound,
      bullets_expected: args.check.bulletsExpected,
      reasons: args.check.reasons,
    },
  };
}

function emptyReport(args: {
  inputHash: string;
  libraryHash: string;
  jdHash: string;
  configHash: string;
  controlsHash: string;
  claims: Report["claims"];
  semanticMode: CompilerConfig["semantic"]["mode"];
  failures: string[];
  quarantined?: Report["quarantined"];
  notes?: string[];
}): Report {
  return {
    status: "failed",
    run_id: args.inputHash.slice(0, 12),
    library_hash: args.libraryHash,
    jd_hash: args.jdHash,
    config_hash: args.configHash,
    controls_hash: args.controlsHash,
    input_hash: args.inputHash,
    evidence_ceiling: "weak",
    semantic_mode: args.semanticMode === "off" ? "off" : "lexical_overlap",
    hard_coverage: 0,
    dimensions: {
      parse_readability: 0,
      requirement_coverage: 0,
      context_coverage: 0,
      human_density: 0,
      unsupported_claim_count: 0,
    },
    diagnostic_index: {
      label: "Grounded coverage index",
      value: null,
      components: ["requirement_coverage", "context_coverage", "parse_readability", "human_density"],
      note: "Project-specific diagnostic. Not an employer ATS score.",
    },
    requirements: [],
    selected: [],
    suggestions: [],
    quarantined: args.quarantined ?? [],
    failures: args.failures,
    notes: args.notes ?? [],
    claims: args.claims,
    verification: {
      pages: null,
      text_order_ok: false,
      name_found: false,
      email_found: false,
      bullets_found: 0,
      bullets_expected: 0,
      reasons: [],
    },
  };
}

function unsupportedClaims(library: Library, lines: SelectedLine[]): string[] {
  const problems: string[] = [];
  for (const line of lines) {
    if (!line.rendered) continue;
    const claim = library.claims.find((item) => item.id === line.claim_id);
    if (!claim) {
      problems.push(`Selected line ${line.claim_id} has no source claim.`);
      continue;
    }
    if (line.output_origin === "source" && line.output_text !== claim.text) {
      problems.push(`Claim ${claim.id} output does not match its source text.`);
    }
    if (line.output_origin === "approved_variant") {
      const variant = claim.approved_variants.find((item) => item.id === line.variant_id);
      if (!variant || variant.text !== line.output_text) problems.push(`Claim ${claim.id} variant text was not approved.`);
    }
    const problem = guardWording(claim, line.output_text, library.skills);
    if (problem) problems.push(`Claim ${claim.id} ${problem}`);
  }
  return problems;
}

function nextDrop(lines: SelectedLine[], controls: RunControls, edges: MatchEdge[]): string | null {
  const candidates = lines.filter(
    (line) =>
      (line.kind === "experience_bullet" || line.kind === "project_bullet" || line.kind === "leadership_bullet") &&
      !controls.pins.includes(line.claim_id),
  );
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((line) => ({
      id: line.claim_id,
      layoutOnly: line.reasons.some((reason) => reason.includes("two-bullet")),
      score: edges.filter((edge) => edge.claim_id === line.claim_id && edge.counts_as_coverage).reduce((sum, edge) => sum + edge.edge_score, 0),
    }))
    .sort((left, right) => Number(right.layoutOnly) - Number(left.layoutOnly) || left.score - right.score || left.id.localeCompare(right.id));
  return ranked[0]?.id ?? null;
}

function normalizeControls(controls: Partial<RunControls> | undefined): RunControls {
  return {
    pins: unique(controls?.pins ?? EMPTY_CONTROLS.pins),
    excludes: unique(controls?.excludes ?? EMPTY_CONTROLS.excludes),
    variants: controls?.variants ?? {},
    edits: controls?.edits ?? {},
  };
}

function ratio(covered: { weight: number }[], all: { weight: number }[]): number {
  const total = all.reduce((sum, item) => sum + item.weight, 0);
  if (total === 0) return 0;
  return covered.reduce((sum, item) => sum + item.weight, 0) / total;
}

function numberOverlap(source: string, output: string): boolean {
  const numbers = source.match(/\d+(?:\.\d+)?/g) ?? [];
  return numbers.every((number) => output.includes(number));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
