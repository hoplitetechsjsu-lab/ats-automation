const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "into",
  "of",
  "on",
  "or",
  "our",
  "that",
  "the",
  "their",
  "this",
  "to",
  "with",
  "you",
  "your",
  "will",
  "have",
  "has",
  "using",
  "use",
  "used",
  "including",
  "include",
  "experience",
  "hands",
  "hand",
]);

export function normalizeText(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/c\+\+/g, "cplusplus")
    .replace(/\//g, " ")
    .replace(/[^a-z0-9+.#\s-]/g, " ")
    .replace(/-/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function tokenize(input: string): string[] {
  const normalized = normalizeText(input);
  if (!normalized) return [];
  return normalized.split(" ").filter(Boolean);
}

export function contentTokens(input: string): string[] {
  return tokenize(input).filter((token) => token.length >= 4 && !STOPWORDS.has(token));
}

export function collapse(input: string): string {
  return normalizeText(input);
}

export function tokensContain(tokens: string[], phrase: string): { index: number; length: number } | null {
  const needle = tokenize(phrase);
  if (needle.length === 0 || needle.length > tokens.length) return null;
  for (let index = 0; index <= tokens.length - needle.length; index += 1) {
    let matches = true;
    for (let offset = 0; offset < needle.length; offset += 1) {
      if (tokens[index + offset] !== needle[offset]) {
        matches = false;
        break;
      }
    }
    if (matches) return { index, length: needle.length };
  }
  return null;
}

const NEGATORS = new Set([
  "not",
  "no",
  "without",
  "never",
  "didnt",
  "dont",
  "doesnt",
  "isnt",
  "wasnt",
  "werent",
]);

export function phraseNegated(tokens: string[], index: number): boolean {
  const window = tokens.slice(Math.max(0, index - 6), index);
  return window.some((token) => NEGATORS.has(token));
}

const NUMBER_WORDS =
  /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|hundred|thousand|million|billion)\b/gi;

export function numberTokens(input: string): string[] {
  const digits = input.match(/\d+(?:\.\d+)?%?/g) ?? [];
  const words = input.match(NUMBER_WORDS) ?? [];
  return [...digits, ...words.map((word) => word.toLowerCase())].sort();
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
