/**
 * Sprint-3 M4: smart-metadata post-processors.
 *
 * Pure functions that take already-extracted plain text and produce:
 *   • detected language (ISO 639-1) using a stopword-frequency
 *     classifier across a small fixed set (en/es/fr/de/it/pt).
 *   • a ranked list of keywords using a lightweight TF-style scorer
 *     with stopword + length filtering.
 *
 * The classifier is intentionally small — no external dependency, no
 * model file, no IO. We trade peak accuracy for a deterministic,
 * dependency-free function that costs sub-millisecond on a 50 KB
 * extract and produces the same answer in every environment (tests,
 * dev, prod). "Best effort" is the contract.
 */

// ─── Stopword tables ──────────────────────────────────────────────
// Roughly the top 30 function words per language; chosen to be
// orthographically distinct enough to disambiguate on short inputs.

const STOPWORDS_EN = new Set([
  "the", "of", "and", "to", "in", "a", "is", "that", "it", "for",
  "on", "with", "as", "by", "this", "are", "be", "was", "were", "has",
  "have", "from", "or", "an", "at", "but", "not", "we", "you", "they",
  "their", "its", "if", "which", "can", "will", "all", "more", "than", "so",
]);
const STOPWORDS_ES = new Set([
  "el", "la", "de", "que", "y", "en", "un", "ser", "se", "no",
  "haber", "por", "con", "su", "para", "como", "estar", "tener", "le", "lo",
  "todo", "pero", "más", "hacer", "o", "poder", "decir", "este", "ir", "otro",
  "ese", "los", "las", "una", "del", "al", "es", "son", "ha", "han",
]);
const STOPWORDS_FR = new Set([
  "le", "de", "un", "être", "et", "à", "il", "avoir", "ne", "je",
  "son", "que", "se", "qui", "ce", "dans", "en", "du", "elle", "au",
  "pour", "pas", "que", "vous", "par", "sur", "faire", "plus", "dire", "me",
  "on", "mon", "lui", "nous", "comme", "mais", "pouvoir", "avec", "tout", "y",
]);
const STOPWORDS_DE = new Set([
  "der", "die", "und", "in", "den", "von", "zu", "das", "mit", "sich",
  "des", "auf", "für", "ist", "im", "dem", "nicht", "ein", "eine", "als",
  "auch", "es", "an", "werden", "aus", "er", "hat", "dass", "sie", "nach",
  "wird", "bei", "einer", "um", "am", "sind", "noch", "wie", "einem", "über",
]);
const STOPWORDS_IT = new Set([
  "il", "di", "che", "e", "la", "in", "un", "a", "per", "non",
  "una", "le", "lo", "gli", "del", "della", "al", "alla", "ai", "alle",
  "con", "da", "su", "ma", "se", "come", "anche", "più", "ha", "ho",
  "sono", "questo", "questa", "essere", "fare", "ci", "si", "mi", "ti", "lei",
]);
const STOPWORDS_PT = new Set([
  "o", "a", "de", "que", "e", "do", "da", "em", "um", "para",
  "é", "com", "não", "uma", "os", "no", "se", "na", "por", "mais",
  "as", "dos", "como", "mas", "foi", "ao", "ele", "das", "tem", "à",
  "seu", "sua", "ou", "ser", "quando", "muito", "há", "nos", "já", "está",
]);

const LANGUAGE_TABLES: Array<{ code: string; words: Set<string> }> = [
  { code: "en", words: STOPWORDS_EN },
  { code: "es", words: STOPWORDS_ES },
  { code: "fr", words: STOPWORDS_FR },
  { code: "de", words: STOPWORDS_DE },
  { code: "it", words: STOPWORDS_IT },
  { code: "pt", words: STOPWORDS_PT },
];

/** Combined stopword set used by `extractKeywords` so the keyword
 *  list is reasonably noise-free regardless of detected language. */
const ALL_STOPWORDS = new Set<string>();
for (const t of LANGUAGE_TABLES) for (const w of t.words) ALL_STOPWORDS.add(w);

// ─── Tokeniser ────────────────────────────────────────────────────

/**
 * Lowercase + split on non-letter runs. Unicode letters (`\p{L}`)
 * are kept so the classifier works on non-ASCII text (e.g. German
 * umlauts, accented French/Spanish). Digits are *not* kept — they
 * carry no language signal and add noise to keyword extraction.
 */
function tokenise(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((t) => t.length > 0);
}

// ─── Language detection ───────────────────────────────────────────

/**
 * Detect the dominant language using stopword frequency. Returns the
 * ISO-639-1 code of the table whose stopwords were hit most often,
 * provided the leader cleared a minimum hit count *and* a minimum
 * margin over the runner-up. Returns `undefined` on short or
 * ambiguous input rather than guessing.
 *
 * Cost: O(n) over the first `SAMPLE_TOKEN_CAP` tokens.
 */
const SAMPLE_TOKEN_CAP = 5_000;
const MIN_LEADER_HITS = 3;
const MIN_LEADER_MARGIN = 2; // leader must beat runner-up by ≥ this

export function detectLanguage(text: string): string | undefined {
  if (!text) return undefined;
  const tokens = tokenise(text);
  if (tokens.length === 0) return undefined;
  const sample = tokens.length > SAMPLE_TOKEN_CAP
    ? tokens.slice(0, SAMPLE_TOKEN_CAP)
    : tokens;

  const scores: Array<{ code: string; hits: number }> = [];
  for (const { code, words } of LANGUAGE_TABLES) {
    let hits = 0;
    for (const tok of sample) if (words.has(tok)) hits++;
    scores.push({ code, hits });
  }
  scores.sort((a, b) => b.hits - a.hits);
  const [first, second] = scores;
  if (!first || first.hits < MIN_LEADER_HITS) return undefined;
  if (second && first.hits - second.hits < MIN_LEADER_MARGIN) return undefined;
  return first.code;
}

// ─── Keyword extraction ───────────────────────────────────────────

/**
 * TF-style keyword pick: tokenise, drop stopwords + tokens shorter
 * than `MIN_KEYWORD_LEN`, count occurrences, return the top `max`
 * tokens sorted by frequency (ties broken alphabetically for stable
 * test output).
 *
 * Not strict TF-IDF — we have no corpus statistics on hand at upload
 * time, and the doc-frequency component would only matter for
 * cross-document scoring. For "suggest tags for this file" the TF
 * head is the right signal: words the author actually used often.
 */
const MIN_KEYWORD_LEN = 4;
const MAX_KEYWORD_LEN = 30;
const DEFAULT_KEYWORD_COUNT = 8;

export function extractKeywords(text: string, max = DEFAULT_KEYWORD_COUNT): string[] {
  if (!text || max <= 0) return [];
  const counts = new Map<string, number>();
  for (const tok of tokenise(text)) {
    if (tok.length < MIN_KEYWORD_LEN || tok.length > MAX_KEYWORD_LEN) continue;
    if (ALL_STOPWORDS.has(tok)) continue;
    counts.set(tok, (counts.get(tok) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([term]) => term);
}
