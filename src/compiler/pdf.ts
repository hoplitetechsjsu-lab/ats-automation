import { inflateSync } from "node:zlib";
import PDFDocument from "pdfkit";
import { collapse } from "./normalize";
import type { ResumeDocument } from "./types";

const MARGIN = 54;

export interface PdfRender {
  pdf: Buffer;
  overflow: boolean;
}

export function renderPdf(resume: ResumeDocument): Promise<PdfRender> {
  const doc = new PDFDocument({
    size: "LETTER",
    margin: MARGIN,
    info: {
      Title: "Resume",
      Author: "ats-automation",
      Creator: "ats-automation",
      Producer: "ats-automation",
      CreationDate: new Date(0),
      ModDate: new Date(0),
    },
  });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  let overflow = false;
  const width = doc.page.width - MARGIN * 2;
  const limit = doc.page.height - MARGIN;
  const write = (text: string, font: string, size: number, gap: number) => {
    if (overflow) return;
    doc.font(font).fontSize(size);
    const height = doc.heightOfString(text, { width });
    if (doc.y + height > limit) {
      overflow = true;
      return;
    }
    doc.text(text, MARGIN, doc.y, { width, lineGap: 1 });
    doc.y += gap;
  };

  write(resume.name, "Helvetica-Bold", 16, 3);
  write(resume.contact_line, "Helvetica", 9, 8);
  if (resume.summary) {
    write("Summary", "Helvetica-Bold", 11, 2);
    write(resume.summary.text, "Helvetica", 10, 6);
  }
  for (const section of resume.sections) {
    write(section.heading, "Helvetica-Bold", 11, 2);
    for (const entry of section.entries) {
      write(entry.heading, "Helvetica-Bold", 10, 1);
      if (entry.meta) write(entry.meta, "Helvetica", 9, 2);
      for (const bullet of entry.bullets) write(`- ${bullet.text}`, "Helvetica", 10, 2);
      doc.y += 4;
    }
  }
  if (resume.skills_line) {
    write("Skills", "Helvetica-Bold", 11, 2);
    write(resume.skills_line, "Helvetica", 10, 2);
  }
  doc.end();
  return done.then((pdf) => ({ pdf, overflow }));
}

export function extractPdfText(pdf: Buffer): { pageCount: number; text: string } {
  const raw = pdf.toString("latin1");
  const pageCount = raw.match(/\/Type\s*\/Page(?!s)/g)?.length ?? 0;
  const pieces: string[] = [];
  const streamPattern = /stream\r?\n([\s\S]*?)\nendstream/g;
  let match: RegExpExecArray | null;
  while ((match = streamPattern.exec(raw))) {
    const body = Buffer.from(match[1], "latin1");
    let decoded = body;
    try {
      decoded = inflateSync(body);
    } catch {
      decoded = body;
    }
    pieces.push(showText(decoded.toString("latin1")));
  }
  return { pageCount, text: pieces.join("\n") };
}

export function verifyResumeText(
  resume: ResumeDocument,
  extracted: string,
  email: string,
): { ok: boolean; reasons: string[]; bulletsFound: number; bulletsExpected: number; nameFound: boolean; emailFound: boolean } {
  const haystack = collapse(extracted);
  const reasons: string[] = [];
  const nameFound = haystack.includes(collapse(resume.name));
  const emailFound = haystack.includes(collapse(email));
  if (!nameFound) reasons.push("The name is missing from the extracted text.");
  if (!emailFound) reasons.push("Contact email is missing from the document body.");
  let cursor = 0;
  const headings = [
    ...(resume.summary ? ["Summary"] : []),
    ...resume.sections.map((section) => section.heading),
    ...(resume.skills_line ? ["Skills"] : []),
  ];
  for (const heading of headings) {
    const at = haystack.indexOf(collapse(heading), cursor);
    if (at < 0) reasons.push(`Heading "${heading}" is missing or out of order.`);
    else cursor = at + collapse(heading).length;
  }
  const expected: string[] = [];
  if (resume.summary) expected.push(resume.summary.text);
  for (const section of resume.sections) {
    for (const entry of section.entries) {
      expected.push(entry.heading);
      for (const bullet of entry.bullets) expected.push(bullet.text);
    }
  }
  if (resume.skills_line) expected.push(resume.skills_line);
  let bulletsFound = 0;
  for (const text of expected) {
    if (haystack.includes(collapse(text))) bulletsFound += 1;
    else reasons.push(`Rendered text is missing after extraction: ${text.slice(0, 80)}`);
  }
  return {
    ok: reasons.length === 0,
    reasons,
    bulletsFound,
    bulletsExpected: expected.length,
    nameFound,
    emailFound,
  };
}

function showText(content: string): string {
  let text = "";
  const arrays = content.matchAll(/\[([\s\S]*?)\]\s*TJ/g);
  for (const match of arrays) text += `${decodePdfArray(match[1])}\n`;
  const singles = content.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g);
  for (const match of singles) text += `${readPdfString(match[0], 0).text}\n`;
  return text;
}

function decodePdfArray(body: string): string {
  let text = "";
  const tokens = body.matchAll(/<([0-9A-Fa-f]+)>|\((?:\\.|[^\\)])*\)|(-?\d+(?:\.\d+)?)/g);
  for (const token of tokens) {
    if (token[1]) {
      text += hexToText(token[1]);
      continue;
    }
    if (token[0].startsWith("(")) {
      text += readPdfString(token[0], 0).text;
      continue;
    }
    const adjustment = Number(token[2]);
    if (adjustment > 700) text += " ";
  }
  return text;
}

function hexToText(hex: string): string {
  const bytes: number[] = [];
  for (let index = 0; index + 1 < hex.length; index += 2) {
    bytes.push(Number.parseInt(hex.slice(index, index + 2), 16));
  }
  return Buffer.from(bytes).toString("latin1");
}

function readPdfString(content: string, start: number): { text: string; next: number } {
  let text = "";
  let index = start + 1;
  while (index < content.length) {
    const char = content[index];
    if (char === "\\") {
      const next = content[index + 1] ?? "";
      if (next === "n") text += "\n";
      else if (next === "r") text += "\r";
      else if (next === "t") text += "\t";
      else if (next === "(" || next === ")" || next === "\\") text += next;
      else if (/[0-7]/.test(next)) {
        let octal = next;
        if (/[0-7]/.test(content[index + 2] ?? "")) octal += content[index + 2];
        if (octal.length < 3 && /[0-7]/.test(content[index + 3] ?? "")) octal += content[index + 3];
        text += String.fromCharCode(Number.parseInt(octal, 8));
        index += octal.length + 1;
        continue;
      } else text += next;
      index += 2;
      continue;
    }
    if (char === ")") return { text, next: index + 1 };
    text += char;
    index += 1;
  }
  return { text, next: index };
}
