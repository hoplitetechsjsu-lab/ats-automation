import { readFileSync } from "node:fs";
import path from "node:path";
import { claimSummaries, loadLibrary } from "@/compiler/library";

export async function GET() {
  const root = process.cwd();
  const yaml = readFileSync(path.join(root, "fixtures/jordan-hale.library.yaml"), "utf8");
  const library = loadLibrary(yaml);
  return Response.json({
    yaml,
    claims: claimSummaries(library),
    profile_name: library.profile.name,
    examples: {
      sample: readFileSync(path.join(root, "fixtures/sample-backend.jd.txt"), "utf8"),
      adversarial: readFileSync(path.join(root, "fixtures/adversarial.jd.txt"), "utf8"),
    },
  });
}
