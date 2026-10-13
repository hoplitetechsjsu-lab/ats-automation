import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { compile } from "../src/compiler/compile";
import { loadLibrary } from "../src/compiler/library";
import { tokenize } from "../src/compiler/normalize";
import type { CompileResult } from "../src/compiler/types";

const root = path.resolve(import.meta.dirname, "..");
const library = loadLibrary(readFileSync(path.join(root, "fixtures/jordan-hale.library.yaml"), "utf8"));
const sampleJd = readFileSync(path.join(root, "fixtures/sample-backend.jd.txt"), "utf8");
const adversarialJd = readFileSync(path.join(root, "fixtures/adversarial.jd.txt"), "utf8");

function blob(result: CompileResult): string {
  const resume = result.resume;
  if (!resume) return "";
  return [
    resume.name,
    resume.contact_line,
    resume.summary?.text ?? "",
    resume.skills_line ?? "",
    ...resume.sections.flatMap((section) =>
      section.entries.flatMap((entry) => [entry.heading, entry.meta, ...entry.bullets.map((bullet) => bullet.text)]),
    ),
  ].join("\n");
}

function hasToken(text: string, term: string): boolean {
  const tokens = tokenize(text);
  const needle = tokenize(term);
  return needle.length > 0 && tokens.some((_, index) => needle.every((part, offset) => tokens[index + offset] === part));
}

describe("deterministic resume compiler", () => {
  it("compiles the sample posting to the same one-page resume twice", async () => {
    const first = await compile({ library, jd: sampleJd });
    const second = await compile({ library, jd: sampleJd });
    assert.equal(first.report.status, "valid", first.report.failures.join("\n"));
    assert.equal(first.report.evidence_ceiling, "strong");
    assert.equal(first.report.verification.pages, 1);
    assert.equal(first.report.dimensions.unsupported_claim_count, 0);
    assert.equal(first.report.input_hash, second.report.input_hash);
    assert.deepEqual(first.report.selected.map((line) => line.output_text), second.report.selected.map((line) => line.output_text));
    assert.ok(first.pdf);
    assert.ok(second.pdf);
    assert.deepEqual(first.pdf, second.pdf);
    for (const line of first.report.selected) {
      assert.ok(line.source.includes(line.claim_id));
      assert.equal(line.evidence_level === "planned", false);
    }
  });

  it("covers required terms with grounded claims and leaves preferred gaps visible", async () => {
    const result = await compile({ library, jd: sampleJd });
    const verified = new Set(
      result.report.requirements.filter((item) => item.state === "verified").flatMap((item) => item.canonical_terms),
    );
    for (const term of ["go", "postgresql", "kubernetes", "testing", "typescript", "degree", "work_authorization"]) {
      assert.ok(verified.has(term), `missing verified term ${term}`);
    }
    const uncovered = new Set(
      result.report.requirements.filter((item) => item.state === "uncovered").flatMap((item) => item.canonical_terms),
    );
    for (const term of ["aws", "terraform", "kafka"]) assert.ok(uncovered.has(term), `expected uncovered ${term}`);
    const text = blob(result);
    assert.equal(hasToken(text, "rust"), false);
    assert.equal(hasToken(text, "java"), false);
    assert.equal(hasToken(text, "42"), false);
    assert.equal(text.includes("private contract"), false);
    assert.ok(result.report.selected.some((line) => line.claim_id === "northwind-events"));
    assert.equal(result.report.selected.some((line) => line.claim_id === "planned-rust"), false);
    assert.equal(result.report.selected.some((line) => line.claim_id === "private-margin"), false);
    assert.equal(result.report.requirements.find((item) => item.canonical_terms.includes("postgresql"))?.primary_claim_id, "northwind-events");
  });

  it("keeps an alias match distinct and refuses ambiguous or negated wording", async () => {
    const alias = await compile({ library, jd: "Requirements\n- Production k8s experience" });
    const kubernetes = alias.report.requirements.find((item) => item.canonical_terms.includes("kubernetes"));
    assert.equal(kubernetes?.state, "verified");
    assert.equal(kubernetes?.support, "alias");
    assert.equal(kubernetes?.primary_claim_id, "lumen-k8s");

    const java = await compile({ library, jd: "Requirements\n- Must know Java" });
    const javaReq = java.report.requirements.find((item) => item.canonical_terms.includes("java"));
    assert.equal(javaReq?.state, "uncovered");
    assert.equal(hasToken(blob(java), "java"), false);
    assert.equal(java.report.selected.some((line) => line.claim_id === "trailmark-react"), false);

    const go = await compile({ library, jd: "Requirements\n- Experience with Go" });
    assert.equal(go.report.selected.some((line) => line.claim_id === "ta-lab"), false);
    assert.ok(go.report.selected.some((line) => line.claim_id === "northwind-go" || line.claim_id === "lumen-go"));
  });

  it("quarantines prompt injection, negation, planned work, and exposure-only asks", async () => {
    const result = await compile({ library, jd: adversarialJd });
    assert.equal(result.report.status, "valid", result.report.failures.join("\n"));
    assert.ok(result.report.quarantined.length > 0);
    assert.equal(result.report.evidence_ceiling, "weak");
    const text = blob(result);
    for (const term of ["cobol", "rust", "scala", "java"]) assert.equal(hasToken(text, term), false, term);
    assert.equal(result.report.requirements.some((item) => /cobol/i.test(item.source_span)), false);
    assert.equal(result.report.requirements.some((item) => item.canonical_terms.includes("kubernetes") && item.kind !== "ignore"), false);
    const rust = result.report.requirements.find((item) => item.canonical_terms.includes("rust"));
    assert.equal(rust?.state, "uncovered");
    assert.match(rust?.explanation ?? "", /planned/i);
    const scala = result.report.requirements.find((item) => item.canonical_terms.includes("scala"));
    assert.equal(scala?.kind, "preferred");
    assert.equal(scala?.exposure_only, true);
    assert.equal(scala?.state, "uncovered");
    assert.ok(result.report.requirements.some((item) => item.gate_type === "seniority" && item.state === "uncovered"));
    assert.equal(result.report.suggestions.every((item) => /not a verified match/i.test(item.explanation)), true);
    assert.equal(result.report.diagnostic_index.note.includes("Not an employer ATS score"), true);
  });

  it("honors pins, exclusions, approved variants, and refuses invented edits", async () => {
    const pinned = await compile({ library, jd: sampleJd, controls: { pins: ["northwind-aws"], excludes: ["northwind-go"] } });
    assert.equal(pinned.report.status, "valid", pinned.report.failures.join("\n"));
    assert.ok(pinned.report.selected.some((line) => line.claim_id === "northwind-aws"));
    assert.equal(pinned.report.selected.some((line) => line.claim_id === "northwind-go"), false);

    const variant = await compile({ library, jd: sampleJd, controls: { variants: { "northwind-go": "shorter" } } });
    const line = variant.report.selected.find((item) => item.claim_id === "northwind-go");
    assert.equal(line?.output_origin, "approved_variant");
    assert.match(line?.output_text ?? "", /incident log replay/);

    const invented = await compile({
      library,
      jd: sampleJd,
      controls: { edits: { "northwind-go": "Led a Go service that cut latency 40% with Rust." } },
    });
    assert.equal(invented.report.status, "failed");
    assert.match(invented.report.failures.join(" "), /Rust|ownership|number/);
    assert.equal(invented.resume, null);

    const reworded = await compile({
      library,
      jd: sampleJd,
      controls: { edits: { "northwind-go": "Built an internal Go service for incident log replay and review." } },
    });
    assert.equal(reworded.report.status, "valid", reworded.report.failures.join("\n"));
    assert.equal(
      reworded.report.selected.find((item) => item.claim_id === "northwind-go")?.output_origin,
      "human_edit",
    );

    const planned = await compile({ library, jd: sampleJd, controls: { pins: ["planned-rust"] } });
    assert.equal(planned.report.status, "failed");
    assert.match(planned.report.failures.join(" "), /planned/i);
  });
});
