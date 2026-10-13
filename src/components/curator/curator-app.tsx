"use client";

import { useEffect, useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import type { ClaimSummary, Report, RequirementCoverage } from "@/compiler/types";

interface LibraryResponse {
  yaml: string;
  claims: ClaimSummary[];
  profile_name: string;
  examples: { sample: string; adversarial: string };
}

interface CompileResponse {
  report: Report;
  html: string | null;
  markdown: string;
  pdf_base64: string | null;
  error?: string;
}

const ceilingCopy = {
  strong: "Strong grounded coverage of the required qualifications.",
  partial: "Partial grounded coverage. Some required qualifications are still open.",
  weak: "Weak grounded coverage. This library cannot support the important requirements.",
};

export function CuratorApp() {
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [yaml, setYaml] = useState("");
  const [jd, setJd] = useState("");
  const [pins, setPins] = useState<string[]>([]);
  const [excludes, setExcludes] = useState<string[]>([]);
  const [variants, setVariants] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [compiling, setCompiling] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CompileResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoadingLibrary(true);
      setLibraryError(null);
      try {
        const response = await fetch("/api/library");
        if (!response.ok) throw new Error("The evidence library could not be loaded.");
        const payload = (await response.json()) as LibraryResponse;
        if (cancelled) return;
        setLibrary(payload);
        setYaml(payload.yaml);
      } catch {
        if (!cancelled) setLibraryError("The evidence library could not be loaded from this machine.");
      } finally {
        if (!cancelled) setLoadingLibrary(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const claims = result?.report.claims ?? library?.claims ?? [];
  const report = result?.report;

  async function compileRun() {
    setCompiling(true);
    setError(null);
    try {
      const response = await fetch("/api/compile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jd,
          library_yaml: yaml,
          pins,
          excludes,
          variants,
          edits,
        }),
      });
      const payload = (await response.json()) as CompileResponse;
      if (!response.ok) {
        setResult(null);
        setError(payload.error ?? "The compiler rejected this run.");
        return;
      }
      setResult(payload);
    } catch {
      setError("The compiler did not respond. Nothing was sent to a third party.");
    } finally {
      setCompiling(false);
    }
  }

  function toggle(list: string[], id: string, other: string[], setList: (value: string[]) => void, setOther: (value: string[]) => void) {
    setOther(other.filter((item) => item !== id));
    setList(list.includes(id) ? list.filter((item) => item !== id) : [...list, id]);
  }

  const uncovered = useMemo(
    () => report?.requirements.filter((item) => item.state === "uncovered" && item.kind !== "ignore") ?? [],
    [report],
  );

  return (
    <div className="min-h-full bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-xs font-medium tracking-[0.16em] text-primary uppercase">Local evidence compiler</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">Resume Curator</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Paste a job description. The compiler selects human-approved lines from {library?.profile_name ?? "the evidence library"} and shows why each one is there. It does not invent skills, metrics, titles, or accomplishments.
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Runs on this machine. No model is called.</p>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-4 px-4 py-4 xl:grid-cols-[320px_minmax(0,1fr)_390px]">
        <section className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>Job description</CardTitle>
              <CardDescription>Plain text only. Instruction-like lines are quarantined and never become requirements.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea
                aria-label="Job description"
                value={jd}
                onChange={(event) => setJd(event.target.value)}
                placeholder="Paste a job description…"
                className="field-sizing-fixed min-h-64"
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!library}
                  onClick={() => setJd(library?.examples.sample ?? "")}
                >
                  Sample posting
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!library}
                  onClick={() => setJd(library?.examples.adversarial ?? "")}
                >
                  Adversarial posting
                </Button>
              </div>
              <Button type="button" className="w-full" disabled={compiling} onClick={() => void compileRun()}>
                {compiling ? "Compiling…" : report ? "Compile again" : "Compile resume"}
              </Button>
              {loadingLibrary ? <p className="text-sm text-muted-foreground">Loading the synthetic evidence library…</p> : null}
              {libraryError ? (
                <p className="text-sm text-destructive" role="alert">
                  {libraryError}
                </p>
              ) : null}
              {error ? (
                <p className="text-sm text-destructive" role="alert">
                  {error}
                </p>
              ) : null}
            </CardContent>
          </Card>
          <details className="rounded-xl bg-card px-4 py-3 text-sm ring-1 ring-foreground/10">
            <summary className="cursor-pointer font-medium">Evidence library ({claims.length} claims)</summary>
            <p className="mt-2 text-muted-foreground">
              Edits stay in this run until you compile. The fixture on disk is the synthetic profile for {library?.profile_name ?? "Jordan Hale"}.
            </p>
            <Textarea
              aria-label="Evidence library YAML"
              value={yaml}
              onChange={(event) => setYaml(event.target.value)}
              className="field-sizing-fixed mt-3 max-h-80 min-h-40 font-mono text-xs"
            />
          </details>
        </section>

        <section className="min-w-0 space-y-3">
          {!report ? (
            <Card>
              <CardHeader>
                <CardTitle>Nothing compiled yet</CardTitle>
                <CardDescription>
                  Compile a posting to see the one-page resume, the requirement ledger, and every qualification this library cannot support.
                </CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <>
              <Ceiling report={report} />
              <Tabs defaultValue="ledger">
                <TabsList>
                  <TabsTrigger value="ledger">Ledger</TabsTrigger>
                  <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
                  <TabsTrigger value="report">Report</TabsTrigger>
                </TabsList>
                <TabsContent value="ledger" className="space-y-3">
                  <Uncovered items={uncovered} />
                  <div className="max-h-[70vh] space-y-2 overflow-auto pr-1">
                    {report.requirements
                      .filter((item) => item.kind !== "ignore")
                      .map((item) => (
                        <RequirementRow
                          key={item.id}
                          item={item}
                          claims={claims}
                          pins={pins}
                          excludes={excludes}
                          drafts={drafts}
                          onDraft={(id, value) => setDrafts((current) => ({ ...current, [id]: value }))}
                          onTogglePin={(id) => toggle(pins, id, excludes, setPins, setExcludes)}
                          onToggleExclude={(id) => toggle(excludes, id, pins, setExcludes, setPins)}
                          onVariant={(id, variantId) =>
                            setVariants((current) => ({ ...current, [id]: variantId }))
                          }
                          onApprove={(id) => {
                            const text = (drafts[id] ?? "").trim();
                            setEdits((current) => ({ ...current, [id]: text }));
                          }}
                        />
                      ))}
                  </div>
                </TabsContent>
                <TabsContent value="suggestions">
                  <Card>
                    <CardHeader>
                      <CardTitle>Review suggested</CardTitle>
                      <CardDescription>
                        No embedding model is installed. These are lexical overlaps only. They are not verified matches and they do not count as coverage.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {report.suggestions.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No review suggestions for the uncovered requirements.</p>
                      ) : (
                        report.suggestions.map((suggestion) => (
                          <div key={`${suggestion.requirement_id}-${suggestion.claim_id}`} className="rounded-lg border border-border p-3">
                            <p className="text-xs text-muted-foreground">
                              {suggestion.requirement_id} · {suggestion.claim_id} · overlap {suggestion.score.toFixed(2)}
                            </p>
                            <p className="mt-1">{suggestion.explanation}</p>
                          </div>
                        ))
                      )}
                    </CardContent>
                  </Card>
                </TabsContent>
                <TabsContent value="report">
                  <ReportPanel report={report} />
                </TabsContent>
              </Tabs>
            </>
          )}
        </section>

        <section className="xl:sticky xl:top-4 xl:self-start">
          <ResumePanel result={result} />
        </section>
      </main>
    </div>
  );
}

function Ceiling({ report }: { report: Report }) {
  const tone =
    report.status === "failed"
      ? "border-destructive/40 bg-destructive/10"
      : report.evidence_ceiling === "strong"
        ? "border-ok/30 bg-ok/10"
        : report.evidence_ceiling === "partial"
          ? "border-warn/30 bg-warn/10"
          : "border-destructive/40 bg-destructive/10";
  return (
    <div className={`rounded-xl border px-4 py-3 ${tone}`}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={report.status === "valid" ? "secondary" : "destructive"}>{report.status}</Badge>
        <Badge variant="outline">{report.evidence_ceiling} evidence ceiling</Badge>
        <span className="text-xs text-muted-foreground">run {report.run_id}</span>
      </div>
      <p className="mt-2 text-sm">{ceilingCopy[report.evidence_ceiling]}</p>
      {report.failures.length > 0 ? (
        <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
          {report.failures.map((failure) => (
            <li key={failure}>{failure}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Uncovered({ items }: { items: RequirementCoverage[] }) {
  if (items.length === 0) return null;
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Uncovered requirements</CardTitle>
        <CardDescription>These stay visible. The compiler will not backfill them.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-1">
        {items.map((item) => (
          <p key={item.id} className="text-sm">
            <span className="font-medium">{item.kind}</span> · {item.source_span}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}

function RequirementRow({
  item,
  claims,
  pins,
  excludes,
  drafts,
  onDraft,
  onTogglePin,
  onToggleExclude,
  onVariant,
  onApprove,
}: {
  item: RequirementCoverage;
  claims: ClaimSummary[];
  pins: string[];
  excludes: string[];
  drafts: Record<string, string>;
  onDraft: (id: string, value: string) => void;
  onTogglePin: (id: string) => void;
  onToggleExclude: (id: string) => void;
  onVariant: (id: string, variantId: string) => void;
  onApprove: (id: string) => void;
}) {
  const claim = claims.find((entry) => entry.id === item.primary_claim_id);
  return (
    <article className="rounded-xl bg-card p-3 ring-1 ring-foreground/10">
      <div className="flex flex-wrap items-center gap-2">
        <StateBadge state={item.state} />
        <Badge variant="outline">{item.kind}</Badge>
        {item.exposure_only ? <Badge variant="outline">exposure only</Badge> : null}
        <span className="text-xs text-muted-foreground">{item.id}</span>
      </div>
      <p className="mt-2 text-sm">{item.source_span}</p>
      <p className="mt-1 text-xs text-muted-foreground">{item.explanation}</p>
      {claim ? (
        <div className="mt-3 space-y-2 rounded-lg bg-muted/60 p-3">
          <p className="text-sm">{claim.text}</p>
          <p className="text-xs text-muted-foreground">
            {claim.id} · {claim.ownership} · {claim.evidence_level} · {claim.source}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant={pins.includes(claim.id) ? "default" : "outline"} onClick={() => onTogglePin(claim.id)}>
              {pins.includes(claim.id) ? "Pinned" : "Pin"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant={excludes.includes(claim.id) ? "destructive" : "outline"}
              onClick={() => onToggleExclude(claim.id)}
            >
              {excludes.includes(claim.id) ? "Excluded" : "Exclude"}
            </Button>
          </div>
          {claim.variants.length > 0 ? (
            <label className="block text-xs text-muted-foreground">
              Approved variant
              <select
                className="mt-1 w-full rounded-lg border border-input bg-card px-2 py-1 text-sm text-foreground"
                defaultValue=""
                onChange={(event) => onVariant(claim.id, event.target.value)}
              >
                <option value="">Source wording</option>
                {claim.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.text}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <label className="block text-xs text-muted-foreground">
            Approve a wording change for this run
            <Textarea
              value={drafts[claim.id] ?? ""}
              onChange={(event) => onDraft(claim.id, event.target.value)}
              className="field-sizing-fixed mt-1 min-h-16 bg-card"
            />
          </label>
          <Button type="button" size="sm" variant="secondary" onClick={() => onApprove(claim.id)} disabled={!(drafts[claim.id] ?? "").trim()}>
            Stage wording, then compile again
          </Button>
        </div>
      ) : null}
    </article>
  );
}

function StateBadge({ state }: { state: RequirementCoverage["state"] }) {
  if (state === "verified") return <Badge className="bg-ok text-white">verified</Badge>;
  if (state === "review") return <Badge className="bg-warn text-white">needs review</Badge>;
  if (state === "uncovered") return <Badge variant="destructive">uncovered</Badge>;
  return <Badge variant="outline">{state}</Badge>;
}

function ReportPanel({ report }: { report: Report }) {
  const index = report.diagnostic_index;
  const rows = [
    ["Parse readability", report.dimensions.parse_readability],
    ["Requirement coverage", report.dimensions.requirement_coverage],
    ["Context coverage", report.dimensions.context_coverage],
    ["Human density", report.dimensions.human_density],
  ] as const;
  return (
    <Card>
      <CardHeader>
        <CardTitle>{index.label}</CardTitle>
        <CardDescription>{index.note}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-3xl font-semibold">{index.value === null ? "Withheld" : Math.round(index.value)}</p>
        <Separator />
        <dl className="grid grid-cols-2 gap-3">
          {rows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="text-lg font-medium">{Math.round(value * 100)}%</dd>
            </div>
          ))}
          <div>
            <dt className="text-xs text-muted-foreground">Unsupported claims</dt>
            <dd className="text-lg font-medium">{report.dimensions.unsupported_claim_count}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Hard requirement coverage</dt>
            <dd className="text-lg font-medium">{Math.round(report.hard_coverage * 100)}%</dd>
          </div>
        </dl>
        {report.quarantined.length > 0 ? (
          <div>
            <p className="text-sm font-medium">Quarantined text</p>
            {report.quarantined.map((item) => (
              <p key={item.text} className="mt-1 text-sm text-muted-foreground">
                {item.reason}
              </p>
            ))}
          </div>
        ) : null}
        {report.notes.length > 0 ? (
          <ul className="list-disc space-y-1 pl-4 text-sm text-muted-foreground">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-muted-foreground">
          Semantic mode: {report.semantic_mode}. Pages: {report.verification.pages ?? "n/a"}. Input hash {report.input_hash.slice(0, 12)}.
        </p>
      </CardContent>
    </Card>
  );
}

function ResumePanel({ result }: { result: CompileResponse | null }) {
  const resumeLines = result?.report.selected.filter((line) => line.rendered) ?? [];
  return (
    <Card>
      <CardHeader>
        <CardTitle>One-page resume</CardTitle>
        <CardDescription>Single column, standard type, contact in the body. Source ids stay in the ledger, not in the PDF.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {!result?.html ? (
          <p className="text-sm text-muted-foreground">The preview appears after a compile.</p>
        ) : (
          <iframe title="Resume preview" className="h-[640px] w-full rounded-lg border border-border bg-white" srcDoc={result.html} />
        )}
        {resumeLines.length > 0 ? (
          <ul className="space-y-1 text-xs text-muted-foreground">
            {resumeLines.map((line) => (
              <li key={line.claim_id}>
                <span className="font-medium text-foreground">{line.claim_id}</span> · {line.output_origin} · {line.source}
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!result?.pdf_base64}
            onClick={() => result?.pdf_base64 && downloadBinary("resume.pdf", result.pdf_base64, "application/pdf")}
          >
            PDF
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!result?.html}
            onClick={() => result?.html && downloadText("resume.html", result.html, "text/html")}
          >
            HTML
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!result}
            onClick={() => result && downloadText("report.json", JSON.stringify(result.report, null, 2), "application/json")}
          >
            JSON
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!result?.markdown}
            onClick={() => result?.markdown && downloadText("coverage.md", result.markdown, "text/markdown")}
          >
            Report
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function downloadText(filename: string, contents: string, type: string) {
  download(filename, new Blob([contents], { type }));
}

function downloadBinary(filename: string, base64: string, type: string) {
  const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  download(filename, new Blob([bytes], { type }));
}

function download(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
