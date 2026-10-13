# Contributing

Thanks for helping keep Resume Curator auditable. The useful change is one that makes a requirement's coverage easier to trust, not one that makes the resume sound stronger than the evidence.

## Setup

```bash
npm install
npm test
npm run dev
```

`npm test` runs the compiler tests. `npm run lint` and `npm run typecheck` should pass before you open a pull request.

The review UI is at `http://127.0.0.1:3847` after `npm run dev`.

## Ground rules

- Do not commit real resumes, contact details, confidential research, or private job descriptions. `fixtures/` is synthetic on purpose.
- Do not add a model call to the default path. Exact and alias matches are the coverage authority. Suggestions must stay labeled as suggestions.
- Do not invent aliases in code. Add them to the skill table in a fixture or to a reviewed vocabulary, with ambiguous short forms marked.
- A change that lets planned work, negated text, or an untagged skill count as verified coverage needs a failing test first, then a fix that keeps the test.
- Keep scoring weights in `config/compiler.json`. Say what the weight change does to the fixtures.

## Adding a case

Add a synthetic job description under `fixtures/` and assert the coverage states in `tests/compiler.test.ts`. Useful cases:

- a must-have the library truly supports
- a must-have it must leave uncovered
- negation, exposure-only language, and instruction-like text
- an ambiguous alias such as `Go` versus the verb "go", or `Java` versus `JavaScript`

Prefer a small labeled case over a new subsystem.

## Pull requests

- Describe the behavior change and the fixture that locks it in.
- Run `npm test`.
- Do not include generated resumes from `output/` or anything from a real application.

## Conduct

See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md). Report security or privacy issues through the process in [SECURITY.md](SECURITY.md).
