# Resume Curator

A local, deterministic resume compiler. It tailors a one-page resume from a human-maintained evidence library and a pasted job description, then shows the evidence behind every selected line.

The compiler may select, reorder, and use human-approved wording. It may not invent a qualification, technology, metric, ownership claim, title, or accomplishment.

This is a clean-room project. It is not a fork of [ats-tailor](https://github.com/hoshinoht/ats-tailor), which is GPLv3. No code from that project is included. This repository is MIT, as stated in `LICENSE`.

## What a run shows

- A one-page, single-column resume in HTML and PDF.
- A requirement-to-evidence ledger with a source id on every selected line.
- Coverage for each must-have and gate, including requirements the library cannot support.
- Separate checks for parse readability, requirement coverage, context coverage, human density, and unsupported claims.
- An evidence ceiling: strong, partial, or weak grounded coverage. That is not an interview probability and not an employer ATS score.
- Lexical overlaps as review suggestions. They never count as verified matches. No embedding model is required.

Semantic retrieval can be added later behind the suggestion channel. The deterministic path runs with no model installed and repeats the same result for the same inputs.

## Run it

Node.js 22 or newer.

```bash
npm install
npm test
npm run dev
```

Open [http://127.0.0.1:3847](http://127.0.0.1:3847). The dev server binds to `0.0.0.0:3847`.

The app loads a synthetic profile, Jordan Hale. Paste a job description or load the sample posting. Nothing is uploaded and no model is called.

Compile from the command line:

```bash
npm run compile -- --jd fixtures/sample-backend.jd.txt --out output/sample
```

That writes `report.json`, `coverage.md`, `resume.html`, and `resume.pdf`. The same inputs produce the same report hash and the same PDF bytes.

Try `fixtures/adversarial.jd.txt` for negation, planned work, an ambiguous skill name, and instruction-like text. Those lines are quarantined or left uncovered. They are not turned into resume claims.

## Layout

```text
config/compiler.json          scoring weights
fixtures/                     synthetic library and job descriptions
src/compiler/                 deterministic compiler
src/cli.ts                    offline compile command
src/app/                      review UI and local API
tests/compiler.test.ts        reproducibility, provenance, and adversarial cases
```

Weights live in `config/compiler.json`. They are starting defaults, not a claim about employer ranking.

## What this refuses

- Predicting an interview probability.
- Browsing job boards or submitting applications.
- Rewriting bullets without an approved variant or an explicit human edit.
- Treating familiarity, planned work, or a semantically similar project as proof.
- Adding a technology because the posting mentioned it.
- Sending the evidence library to a remote model.
- Collapsing the checks into a single “ATS score.”

A human edit is the highest-priority wording for a run, and it is rejected when it adds a number, skill, or ownership claim the source line does not support. Edits are not written back to the library.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Do not commit real resumes, phone numbers, private research, or confidential job descriptions. Use synthetic fixtures.

## License

MIT. See [LICENSE](LICENSE).
