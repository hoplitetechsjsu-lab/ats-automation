# Security and privacy

Resume Curator is local-first. The default path does not call a model, fetch a job page, or upload the evidence library.

## Reporting a vulnerability

Open a private GitHub security advisory on [hoplitetechsjsu-lab/ats-automation](https://github.com/hoplitetechsjsu-lab/ats-automation/security/advisories). Please do not file a public issue that includes a real resume, credentials, or an exploit.

## What to expect from the compiler

- Job-description text is untrusted data. Instruction-like lines are quarantined and are not executed.
- Raw resume text and contact details are not written to application logs.
- A failed verification stays a failed run.
- Do not commit real resumes or confidential postings. Use the synthetic fixtures.

If you add storage, encryption, or a cloud model later, keep that provider boundary visible in the interface and out of the default path.
