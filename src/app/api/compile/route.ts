import { readFileSync } from "node:fs";
import path from "node:path";
import { compile } from "@/compiler/compile";
import { LibraryError, loadLibrary } from "@/compiler/library";

interface CompileBody {
  jd?: string;
  library_yaml?: string;
  pins?: string[];
  excludes?: string[];
  variants?: Record<string, string>;
  edits?: Record<string, string>;
}

export async function POST(request: Request) {
  let body: CompileBody;
  try {
    body = (await request.json()) as CompileBody;
  } catch {
    return Response.json({ error: "Expected a JSON body." }, { status: 400 });
  }
  try {
    const yaml =
      body.library_yaml && body.library_yaml.trim()
        ? body.library_yaml
        : readFileSync(path.join(process.cwd(), "fixtures/jordan-hale.library.yaml"), "utf8");
    const result = await compile({
      library: loadLibrary(yaml),
      jd: body.jd ?? "",
      controls: {
        pins: Array.isArray(body.pins) ? body.pins : [],
        excludes: Array.isArray(body.excludes) ? body.excludes : [],
        variants: body.variants ?? {},
        edits: body.edits ?? {},
      },
    });
    return Response.json({
      report: result.report,
      html: result.html,
      markdown: result.markdown,
      pdf_base64: result.pdf ? result.pdf.toString("base64") : null,
    });
  } catch (error) {
    if (error instanceof LibraryError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return Response.json({ error: "The compiler failed before it could build a report." }, { status: 500 });
  }
}
