import { escapeHtml } from "./normalize";
import type { Entry, Library, ResumeDocument, ResumeSection, SelectedLine } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const SECTION_ORDER: { id: ResumeSection["id"]; heading: string; kinds: SelectedLine["kind"][] }[] = [
  { id: "experience", heading: "Experience", kinds: ["experience_bullet"] },
  { id: "projects", heading: "Projects", kinds: ["project_bullet"] },
  { id: "leadership", heading: "Leadership", kinds: ["leadership_bullet"] },
  { id: "education", heading: "Education", kinds: ["education"] },
];

export function buildResume(library: Library, lines: SelectedLine[], skillIds: string[]): ResumeDocument {
  const entries = new Map(library.entries.map((entry) => [entry.id, entry]));
  const sections: ResumeSection[] = [];
  for (const section of SECTION_ORDER) {
    const sectionLines = lines.filter((line) => line.rendered && section.kinds.includes(line.kind));
    if (sectionLines.length === 0) continue;
    const parentIds = unique(sectionLines.map((line) => line.parent_id)).sort((left, right) =>
      compareEntries(entries.get(left), entries.get(right), left, right),
    );
    sections.push({
      id: section.id,
      heading: section.heading,
      entries: parentIds.map((parentId) => {
        const entry = entries.get(parentId);
        const bullets = sectionLines.filter((line) => line.parent_id === parentId);
        if (section.id === "education" && bullets[0]) {
          return {
            entry_id: parentId,
            heading: bullets[0].output_text,
            meta: entry ? metaLine(entry) : "",
            bullets: [],
          };
        }
        return {
          entry_id: parentId,
          heading: entry ? `${entry.title}, ${entry.organization}` : parentId,
          meta: entry ? metaLine(entry) : "",
          bullets: bullets.map((line) => ({ claim_id: line.claim_id, text: line.output_text })),
        };
      }),
    });
  }
  const summary = lines.find((line) => line.kind === "summary" && line.rendered);
  const skills = skillIds
    .map((id) => library.skills.find((skill) => skill.id === id)?.canonical)
    .filter((name): name is string => Boolean(name));
  return {
    name: library.profile.name,
    contact_line: contactLine(library),
    summary: summary ? { text: summary.output_text, claim_id: summary.claim_id } : undefined,
    sections,
    skills_line: skills.length > 0 ? skills.join(", ") : undefined,
  };
}

export function renderHtml(resume: ResumeDocument): string {
  const sections = resume.sections
    .map((section) => {
      const entries = section.entries
        .map((entry) => {
          const bullets = entry.bullets
            .map((bullet) => `<li data-claim="${escapeHtml(bullet.claim_id)}">${escapeHtml(bullet.text)}</li>`)
            .join("");
          return `<article><h3>${escapeHtml(entry.heading)}</h3><p class="meta">${escapeHtml(entry.meta)}</p>${
            bullets ? `<ul>${bullets}</ul>` : ""
          }</article>`;
        })
        .join("");
      return `<section><h2>${escapeHtml(section.heading)}</h2>${entries}</section>`;
    })
    .join("");
  const summary = resume.summary
    ? `<section><h2>Summary</h2><p data-claim="${escapeHtml(resume.summary.claim_id)}">${escapeHtml(resume.summary.text)}</p></section>`
    : "";
  const skills = resume.skills_line
    ? `<section><h2>Skills</h2><p>${escapeHtml(resume.skills_line)}</p></section>`
    : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(resume.name)} resume</title>
  <style>
    body { margin: 0.7in; color: #1c1915; font-family: Helvetica, Arial, sans-serif; font-size: 11pt; line-height: 1.35; }
    h1 { font-size: 16pt; margin: 0 0 2px; }
    h2 { font-size: 11pt; letter-spacing: 0.04em; text-transform: uppercase; border-bottom: 1px solid #1c1915; margin: 12px 0 6px; }
    h3 { font-size: 11pt; margin: 8px 0 0; }
    p, ul { margin: 0; }
    .contact, .meta { font-size: 9.5pt; color: #3d3832; }
    ul { padding-left: 1.1em; }
    li { margin: 2px 0; }
    article { margin-bottom: 6px; }
  </style>
</head>
<body>
  <h1>${escapeHtml(resume.name)}</h1>
  <p class="contact">${escapeHtml(resume.contact_line)}</p>
  ${summary}
  ${sections}
  ${skills}
</body>
</html>
`;
}

export function relevantSkillIds(library: Library, lines: SelectedLine[], verifiedTerms: string[]): string[] {
  const selected = new Set(lines.filter((line) => line.rendered).map((line) => line.claim_id));
  const present = new Set<string>();
  for (const claim of library.claims) {
    if (!selected.has(claim.id)) continue;
    for (const skillId of claim.skills) present.add(skillId);
  }
  const weights = new Map<string, number>();
  for (const term of verifiedTerms) {
    if (present.has(term)) weights.set(term, (weights.get(term) ?? 0) + 1);
  }
  return [...weights.keys()].sort((left, right) => {
    const leftName = library.skills.find((skill) => skill.id === left)?.canonical ?? left;
    const rightName = library.skills.find((skill) => skill.id === right)?.canonical ?? right;
    return leftName.localeCompare(rightName);
  });
}

function contactLine(library: Library): string {
  const links = library.profile.links.map((link) => link.url.replace(/^https?:\/\//, "").replace(/\/$/, ""));
  return [library.profile.location, library.profile.email, library.profile.phone, ...links].filter(Boolean).join(" | ");
}

function metaLine(entry: Entry): string {
  const dates = `${formatMonth(entry.dates.start)} - ${entry.dates.end ? formatMonth(entry.dates.end) : "Present"}`;
  return [entry.location, dates].filter(Boolean).join(" | ");
}

function formatMonth(value: string): string {
  const [year, month] = value.split("-");
  const index = Number(month) - 1;
  if (!year || index < 0 || index > 11) return value;
  return `${MONTHS[index]} ${year}`;
}

function compareEntries(left: Entry | undefined, right: Entry | undefined, leftId: string, rightId: string): number {
  const leftKey = left?.dates.end ?? "9999-12";
  const rightKey = right?.dates.end ?? "9999-12";
  if (leftKey !== rightKey) return rightKey.localeCompare(leftKey);
  const leftStart = left?.dates.start ?? "";
  const rightStart = right?.dates.start ?? "";
  if (leftStart !== rightStart) return rightStart.localeCompare(leftStart);
  return leftId.localeCompare(rightId);
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
