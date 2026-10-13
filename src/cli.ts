import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { compile } from "./compiler/compile";
import { LibraryError, loadLibrary } from "./compiler/library";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

async function main() {
  const jdPath = argument("--jd");
  const libraryPath = argument("--library") ?? "fixtures/jordan-hale.library.yaml";
  const outDir = argument("--out") ?? "output/run";
  if (!jdPath) {
    console.error(
      "Usage: npm run compile -- --jd fixtures/sample-backend.jd.txt [--library fixtures/jordan-hale.library.yaml] [--out output/sample]",
    );
    process.exit(1);
  }
  try {
    const library = loadLibrary(readFileSync(libraryPath, "utf8"));
    const jd = readFileSync(jdPath, "utf8");
    const result = await compile({ library, jd });
    mkdirSync(outDir, { recursive: true });
    writeFileSync(path.join(outDir, "report.json"), JSON.stringify(result.report, null, 2));
    writeFileSync(path.join(outDir, "coverage.md"), result.markdown);
    if (result.html) writeFileSync(path.join(outDir, "resume.html"), result.html);
    if (result.pdf) writeFileSync(path.join(outDir, "resume.pdf"), result.pdf);
    console.log(
      `${result.report.status} run=${result.report.run_id} ceiling=${result.report.evidence_ceiling} pages=${result.report.verification.pages ?? "n/a"}`,
    );
    console.log(path.resolve(outDir));
    if (result.report.failures.length > 0) {
      for (const failure of result.report.failures) console.error(failure);
    }
    process.exit(result.report.status === "valid" ? 0 : 1);
  } catch (error) {
    if (error instanceof LibraryError) {
      console.error(error.message);
      process.exit(1);
    }
    console.error("Compile failed.");
    process.exit(1);
  }
}

void main();
