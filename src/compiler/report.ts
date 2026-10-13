import type { Report } from "./types";

export function renderMarkdown(report: Report): string {
  const lines: string[] = [
    "# Match report",
    "",
    `Run \`${report.run_id}\` is ${report.status}.`,
    `Evidence ceiling: **${report.evidence_ceiling}**.`,
    `Hard requirement coverage: ${percent(report.hard_coverage)}.`,
    "",
    "This diagnostic is a project-specific coverage index. It is not an employer ATS score.",
    "",
    "## Dimensions",
    "",
    `- Parse readability: ${percent(report.dimensions.parse_readability)}`,
    `- Requirement coverage: ${percent(report.dimensions.requirement_coverage)}`,
    `- Context coverage: ${percent(report.dimensions.context_coverage)}`,
    `- Human density: ${percent(report.dimensions.human_density)}`,
    `- Unsupported claims: ${report.dimensions.unsupported_claim_count}`,
    "",
  ];
  if (report.failures.length > 0) {
    lines.push("## Failures", "");
    for (const failure of report.failures) lines.push(`- ${failure}`);
    lines.push("");
  }
  if (report.quarantined.length > 0) {
    lines.push("## Quarantined job-description text", "");
    for (const item of report.quarantined) lines.push(`- ${item.reason}`);
    lines.push("");
  }
  lines.push("## Coverage ledger", "");
  for (const requirement of report.requirements) {
    if (requirement.kind === "ignore") continue;
    const claim = requirement.primary_claim_id ? ` -> \`${requirement.primary_claim_id}\`` : "";
    lines.push(`- \`${requirement.id}\` ${requirement.kind} ${requirement.state}${claim}: ${requirement.source_span}`);
  }
  lines.push("", "## Selected lines", "");
  if (report.selected.length === 0) lines.push("No lines were selected.");
  for (const line of report.selected) {
    lines.push(`- \`${line.claim_id}\` (${line.output_origin}, ${line.source}): ${line.output_text}`);
  }
  lines.push("", "## Review suggestions", "");
  if (report.suggestions.length === 0) lines.push("None. Suggestions never count as verified coverage.");
  for (const suggestion of report.suggestions) {
    lines.push(`- \`${suggestion.requirement_id}\` / \`${suggestion.claim_id}\`: ${suggestion.explanation}`);
  }
  if (report.notes.length > 0) {
    lines.push("", "## Notes", "");
    for (const note of report.notes) lines.push(`- ${note}`);
  }
  lines.push("");
  return lines.join("\n");
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
