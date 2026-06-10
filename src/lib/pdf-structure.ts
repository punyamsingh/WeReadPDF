/**
 * Document structure detection.
 *
 * The goal here is robustness across wildly different PDFs — novels, scanned
 * books, and especially research papers whose section layout varies a lot. No
 * single heuristic survives that variety, so instead of betting on one we run
 * several detectors ranked by reliability and merge them. Each detector emits
 * heading candidates tagged with the *source* of the evidence and a confidence,
 * and the cascade falls through gracefully: when a strong signal exists we use
 * it; when it doesn't we degrade to weaker-but-universal ones.
 *
 *   1. Tagged structure tree (`/StructTreeRoot`)  — best signal when present:
 *      the PDF literally tells us what is H1/H2/H3, a list, a table, a figure.
 *   2. Embedded outline / bookmarks               — reliable hierarchy + dests.
 *   3. Typography classifier                      — font size & weight per line;
 *      the universal fallback that works on any untagged PDF.
 *   4. Numbering & lexicon grammar                — sharpens levels and names
 *      ("2.1 …", "Related Work", "References", "Appendix B").
 *   5. Keyword chapter detection / page markers   — last resort (in pdf-extract).
 *
 * This module holds the pure (DOM-free, pdf.js-free) logic so it stays easy to
 * reason about; pdf-extract.ts performs the async pdf.js calls and feeds data
 * in.
 */

/** Where a heading came from, in descending order of trust. */
export type StructureSource = "structtree" | "outline" | "typography" | "fallback";

/** What a structure node represents, so the UI can tell a section from a topic. */
export type StructureKind = "section" | "subsection" | "frontmatter" | "reference" | "appendix";

/** A normalized entry in the document's reconstructed table of contents. */
export interface StructureNode {
  /** Display text, including any "2.1" number prefix as it appears in the doc. */
  title: string;
  /** 1 = top-level section, 2 = subsection, 3 = topic, … */
  level: number;
  /** 1-based source PDF page the heading sits on. */
  page: number;
  /** Ordinal prefix when the heading is numbered ("2.1.3"). */
  number?: string;
  kind: StructureKind;
  /** 0..1 — how much we trust this is a real heading. */
  confidence: number;
  source: StructureSource;
}

/** A heading before it's been classified/merged — carries just placement. */
export interface HeadingCandidate {
  title: string;
  page: number;
  level: number;
  /** Font size in points, when the candidate came from the typography pass. */
  size?: number;
  bold?: boolean;
}

/** The minimal line shape the typography pass needs (a subset of `Line`). */
export interface LineLike {
  str: string;
  size?: number;
  bold?: boolean;
}

// ---------------------------------------------------------------------------
// Numbering & lexicon grammar
// ---------------------------------------------------------------------------

// A leading decimal section number: "1", "2.3", "4.1.2" — optionally followed
// by a dot or paren, then the heading text. The depth of the number tells us
// the level far more reliably than font size does.
const NUMBERED = /^(\d{1,2}(?:\.\d{1,2}){0,3})\s*[.)]?\s+(\p{L}.*)$/u;

// Canonical research-paper / report section names. Matched against the text
// with any leading number stripped, so "2 Related Work" and "Related Work"
// both hit. Deliberately generous — papers phrase these many ways.
const SECTION_LEXICON =
  /^(abstract|introduction|related works?|prior works?|background|preliminaries|motivation|problem (statement|formulation)|methodology|methods?|materials and methods|approach|proposed (method|approach|model|framework)|system (design|model)|architecture|implementation|experimental (setup|design)|experiments?|datasets?|evaluation|results?( and discussion)?|discussion|analysis|ablation( study)?|limitations?|threats to validity|conclusions?( and future work)?|future work|acknowledge?ments?|references|bibliography|appendix|appendices|supplementary( material)?)\b/iu;

// Front matter and back matter that read as their own kind, not a body section.
const FRONTMATTER = /^(abstract|keywords?)\b/iu;
const REFERENCES = /^(references|bibliography|works cited)\b/iu;
const APPENDIX = /^(appendix|appendices)\b/iu;

// Figure/table/equation captions — never a table-of-contents heading even when
// they're set bold or large.
const CAPTION = /^(fig(?:ure)?\.?|table|algorithm|listing|eq(?:uation)?\.?)\s*\d/iu;

export interface HeadingClassification {
  /** "2.1" when the heading is numbered. */
  number?: string;
  /** Level implied by the numbering depth, if any. */
  numberLevel?: number;
  kind: StructureKind;
  /** True for figure/table/equation captions, which must not become headings. */
  isCaption: boolean;
  /** True when the text matches a known section/front/back-matter name. */
  inLexicon: boolean;
}

/**
 * Read a heading's text for grammatical signals: a leading section number, a
 * known section name, or a caption pattern. Used both to assign precise levels
 * and to filter typography candidates down to real headings.
 */
export function classifyHeading(raw: string): HeadingClassification {
  const text = raw.replace(/\s+/g, " ").trim();
  if (CAPTION.test(text)) {
    return { kind: "section", isCaption: true, inLexicon: false };
  }

  let number: string | undefined;
  let numberLevel: number | undefined;
  let rest = text;
  const m = text.match(NUMBERED);
  if (m) {
    number = m[1];
    numberLevel = number.split(".").length;
    rest = m[2];
  }

  const inLexicon = SECTION_LEXICON.test(rest) || SECTION_LEXICON.test(text);
  let kind: StructureKind = numberLevel && numberLevel >= 2 ? "subsection" : "section";
  if (REFERENCES.test(rest) || REFERENCES.test(text)) kind = "reference";
  else if (APPENDIX.test(rest) || APPENDIX.test(text)) kind = "appendix";
  else if (FRONTMATTER.test(rest) || FRONTMATTER.test(text)) kind = "frontmatter";

  return { number, numberLevel, kind, isCaption: false, inLexicon };
}

// ---------------------------------------------------------------------------
// Tagged structure tree (StructTreeRoot)
// ---------------------------------------------------------------------------

/** A node of pdf.js' per-page structure tree (loosely typed). */
export interface StructTreeNode {
  role?: string;
  children?: Array<StructTreeNode | StructTreeContent>;
  alt?: string;
}
interface StructTreeContent {
  type: "content" | "object";
  id?: string;
}

/** A pdf.js text/marker item from getTextContent({ includeMarkedContent: true }). */
export interface MarkedItem {
  type?: string;
  id?: string;
  str?: string;
  /** End-of-line flag; a wrapped heading must keep a space across the break. */
  hasEOL?: boolean;
}

const headingLevelOf = (role?: string): number => {
  if (!role) return 0;
  if (role === "Title") return 1;
  const m = /^H([1-6])$/.exec(role);
  if (m) return Number(m[1]);
  if (role === "H") return 2; // untyped heading
  return 0;
};

/**
 * Build a map from marked-content id → its concatenated text by walking the
 * page's marked-content text stream. The `id` on a `beginMarkedContentProps`
 * marker is exactly the `id` referenced by the structure tree's leaf content
 * nodes, which is how we tie a tag like H2 back to the glyphs under it.
 */
function buildMarkedContentText(items: MarkedItem[]): Map<string, string> {
  const map = new Map<string, string>();
  const stack: Array<string | null> = [];
  for (const it of items) {
    if (it.type === "beginMarkedContent") {
      stack.push(null);
    } else if (it.type === "beginMarkedContentProps") {
      stack.push(it.id ?? null);
    } else if (it.type === "endMarkedContent") {
      stack.pop();
    } else if (typeof it.str === "string") {
      // Attribute the glyphs to the nearest enclosing tagged id.
      let id: string | null = null;
      for (let i = stack.length - 1; i >= 0; i--) {
        if (stack[i]) {
          id = stack[i];
          break;
        }
      }
      // A line wrap inside a heading (hasEOL) must not glue the two lines'
      // words together ("Transformer" + "models" → "Transformer models").
      if (id) map.set(id, (map.get(id) ?? "") + it.str + (it.hasEOL ? " " : ""));
    }
  }
  return map;
}

function collectStructText(node: StructTreeNode, idText: Map<string, string>): string {
  let out = "";
  for (const child of node.children ?? []) {
    if ("type" in child && child.type === "content" && child.id) {
      out += idText.get(child.id) ?? "";
    } else if ("role" in child || "children" in child) {
      out += collectStructText(child as StructTreeNode, idText);
    }
  }
  return out;
}

/**
 * Pull heading text (H1–H6/Title) out of one page's structure tree, in document
 * order. Returns `{ level, title }` pairs; the caller stamps the page number.
 */
export function extractStructHeadings(
  tree: StructTreeNode | null,
  items: MarkedItem[],
): Array<{ level: number; title: string }> {
  if (!tree) return [];
  const idText = buildMarkedContentText(items);
  const heads: Array<{ level: number; title: string }> = [];
  const walk = (node: StructTreeNode) => {
    const level = headingLevelOf(node.role);
    if (level) {
      const title = collectStructText(node, idText).replace(/\s+/g, " ").trim();
      if (title) heads.push({ level, title });
    }
    for (const child of node.children ?? []) {
      if ("role" in child || "children" in child) walk(child as StructTreeNode);
    }
  };
  walk(tree);
  return heads;
}

/**
 * Turn the raw per-page tagged headings into a clean candidate list: lift a
 * lone document Title/H1 out as the doc title, then rebase the remaining levels
 * so the shallowest heading becomes level 1 (an H2-rooted paper reads as
 * sections at level 1, subsections at level 2).
 */
export function finalizeStructHeadings(
  raw: Array<{ level: number; title: string; page: number }>,
): {
  title?: string;
  headings: HeadingCandidate[];
} {
  if (!raw.length) return { headings: [] };

  let title: string | undefined;
  let heads = raw;
  const h1s = raw.filter((h) => h.level === 1);
  const hasDeeper = raw.some((h) => h.level > 1);
  // A single top-level heading near the front, with real sections beneath it,
  // is the document title rather than a section.
  if (h1s.length === 1 && h1s[0].page <= 2 && hasDeeper) {
    title = h1s[0].title;
    heads = raw.filter((h) => h !== h1s[0]);
  }
  if (!heads.length) return { title, headings: [] };

  const minLevel = Math.min(...heads.map((h) => h.level));
  const headings = heads.map((h) => ({
    title: h.title,
    page: h.page,
    level: h.level - minLevel + 1,
  }));
  return { title, headings };
}

// ---------------------------------------------------------------------------
// Typography classifier (the universal fallback)
// ---------------------------------------------------------------------------

const isHeadingText = (text: string): boolean => {
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  if (letters < 2) return false; // need real words, not "•" or "12."
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length > 16) return false; // headings are short
  if (/[,;]$/.test(text)) return false; // trailing comma ⇒ mid-sentence
  if (words.length > 6 && /[.]$/.test(text)) return false; // sentence, not a title
  return true;
};

const sizeBucket = (s: number) => Math.round(s * 2) / 2;

/**
 * Infer the running body-text size: the size bucket carrying the most
 * characters. Returns 0 when no size info is available (e.g. OCR'd text), in
 * which case detection leans entirely on the grammar signal below.
 */
function bodyTextSize(pageLines: LineLike[][]): number {
  const charsBySize = new Map<number, number>();
  for (const lines of pageLines) {
    for (const l of lines) {
      if (!l.size || l.size <= 0) continue;
      charsBySize.set(
        sizeBucket(l.size),
        (charsBySize.get(sizeBucket(l.size)) ?? 0) + l.str.length,
      );
    }
  }
  let bodySize = 0;
  let bodyChars = -1;
  for (const [size, chars] of charsBySize) {
    if (chars > bodyChars) {
      bodyChars = chars;
      bodySize = size;
    }
  }
  return bodySize;
}

/**
 * The universal fallback for untagged PDFs. A line is a heading when *any* of
 * three size-independent-to-size-dependent signals fire:
 *
 *   • Typography — it's set larger than, or bold at, the body-text size.
 *   • Numbering  — it starts with a section number ("3.", "4.1."). This is the
 *     signal that survives when headings share the body's size and pdf.js has
 *     hidden their bold weight (common in journal styles), so it's what keeps
 *     research-paper detection standing.
 *   • Lexicon    — it's a known standalone section name ("Abstract",
 *     "References", "Conclusion") even without a number.
 *
 * Levels come from the numbering depth when present (most reliable), else from
 * ranking the distinct heading sizes (biggest → level 1), else the lexicon.
 */
export function detectHeadingsByTypography(pageLines: LineLike[][]): HeadingCandidate[] {
  const bodySize = bodyTextSize(pageLines);

  const raw: Array<{ title: string; page: number; size: number; bold: boolean; level?: number }> =
    [];
  for (let p = 0; p < pageLines.length; p++) {
    for (const l of pageLines[p]) {
      const text = l.str.replace(/\s+/g, " ").trim();
      if (!isHeadingText(text)) continue;
      const cls = classifyHeading(text);
      if (cls.isCaption) continue; // "Figure 3", "Table 2"

      const size = l.size ?? 0;
      const bigger = bodySize > 0 && size >= bodySize * 1.08;
      const boldHeading = !!l.bold && (bodySize === 0 || size >= bodySize * 0.98);
      const numbered = cls.number !== undefined;
      // An unnumbered lexicon heading must stand alone (a few words), so a
      // sentence that merely opens with "Introduction…" isn't swept in.
      const lexiconStandalone = cls.inLexicon && text.split(/\s+/).length <= 6;

      if (!bigger && !boldHeading && !numbered && !lexiconStandalone) continue;
      raw.push({ title: text, page: p + 1, size, bold: !!l.bold, level: cls.numberLevel });
    }
  }
  if (!raw.length) return [];

  // Rank distinct sizes of the size-detected candidates for level assignment.
  const sizes = [...new Set(raw.filter((r) => r.size > 0).map((r) => sizeBucket(r.size)))].sort(
    (a, b) => b - a,
  );
  const levelForSize = new Map(sizes.map((s, i) => [s, Math.min(i + 1, 4)]));

  return raw.map((r) => ({
    title: r.title,
    page: r.page,
    level: r.level ?? levelForSize.get(sizeBucket(r.size)) ?? 1,
    size: r.size,
    bold: r.bold,
  }));
}

// ---------------------------------------------------------------------------
// The cascade: pick the best evidence and normalize to StructureNodes
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

const toNode = (
  c: HeadingCandidate,
  source: StructureSource,
  confidence: number,
): StructureNode => {
  const cls = classifyHeading(c.title);
  let kind = cls.kind;
  // Without numbering, a deeper level still reads as a subsection/topic.
  if (kind === "section" && c.level >= 2) kind = "subsection";
  return {
    title: c.title,
    level: c.level,
    page: c.page,
    number: cls.number,
    kind,
    confidence,
    source,
  };
};

/** Drop captions, repeated running heads, and exact dupes from a candidate list. */
function cleanCandidates(cands: HeadingCandidate[]): HeadingCandidate[] {
  // A title repeated on many pages is a running head, not a section.
  const freq = new Map<string, number>();
  for (const c of cands) freq.set(norm(c.title), (freq.get(norm(c.title)) ?? 0) + 1);
  const repeatThreshold = Math.max(4, cands.length * 0.25);

  const seen = new Set<string>();
  const out: HeadingCandidate[] = [];
  for (const c of cands) {
    const key = norm(c.title);
    if (classifyHeading(c.title).isCaption) continue;
    if ((freq.get(key) ?? 0) >= repeatThreshold) continue;
    if (seen.has(key)) continue; // keep the first occurrence only
    seen.add(key);
    out.push(c);
  }
  return out;
}

/**
 * Keep only typography candidates that look like genuine headings: numbered,
 * in the section lexicon, or short-and-bold. Pure size can flag a stray
 * large-but-ordinary line (a pull quote, a dropped cap), so we ask for a second
 * corroborating signal before trusting size alone — unless the line is clearly
 * a standout heading size.
 */
function refineTypography(cands: HeadingCandidate[]): HeadingCandidate[] {
  return cands.filter((c) => {
    const cls = classifyHeading(c.title);
    if (cls.number || cls.inLexicon) return true;
    if (c.bold && c.title.split(/\s+/).length <= 12) return true;
    // A markedly large line (level 1 of the size ranking) stands on its own.
    return c.level === 1;
  });
}

/** Convert an embedded outline (indentation-encoded depth) into candidates. */
function outlineToCandidates(
  outline: Array<{ title: string; pageNumber: number }>,
): HeadingCandidate[] {
  return outline.map((o) => {
    const indent = o.title.match(/^\s*/)?.[0].length ?? 0;
    return {
      title: o.title.trim(),
      page: o.pageNumber,
      level: Math.floor(indent / 2) + 1,
    };
  });
}

export interface CascadeInput {
  structTree: HeadingCandidate[];
  outline: Array<{ title: string; pageNumber: number }>;
  typography: HeadingCandidate[];
  /** Keyword/chapter fallback from the legacy detector (novels). */
  chapters: Array<{ title: string; pageNumber: number }>;
}

/**
 * Merge the detectors into one ordered StructureNode list, trusting the
 * strongest available source. Returns an empty list only when nothing fired —
 * the caller then drops in evenly spaced page markers so the contents panel is
 * never empty.
 */
export function buildStructure(input: CascadeInput): StructureNode[] {
  if (input.structTree.length >= 2) {
    return input.structTree.map((c) => toNode(c, "structtree", 0.97));
  }
  if (input.outline.length >= 2) {
    return outlineToCandidates(input.outline).map((c) => toNode(c, "outline", 0.9));
  }
  const typo = cleanCandidates(refineTypography(input.typography));
  if (typo.length >= 2) {
    return typo.map((c) => toNode(c, "typography", c.bold ? 0.7 : 0.55));
  }
  if (input.chapters.length >= 2) {
    return input.chapters.map((c) =>
      toNode({ title: c.title, page: c.pageNumber, level: 1 }, "fallback", 0.5),
    );
  }
  return [];
}

/**
 * Flatten StructureNodes back to the legacy `{ title, pageNumber }[]` shape the
 * reader's chapter logic and contents panel already consume. Depth is encoded
 * as leading double-spaces, matching the embedded-outline convention.
 */
export function structureToOutline(
  nodes: StructureNode[],
): Array<{ title: string; pageNumber: number }> {
  return nodes.map((n) => ({
    title: "  ".repeat(Math.max(0, n.level - 1)) + n.title,
    pageNumber: n.page,
  }));
}

// ---------------------------------------------------------------------------
// Title resolution
// ---------------------------------------------------------------------------

// Producer junk that leaks into /Title: a leftover figure/asset filename
// ("gr1.eps"), an extension, or a bare asset id.
const JUNK_TITLE = /\.(eps|pdf|docx?|tex|png|jpe?g|tiff?|gif|svg)$/i;
const ASSET_TITLE = /^(gr|fig|figure|image|img|graphic|untitled)[\s_-]*\d*$/i;

const looksLikeTitle = (s?: string): boolean => {
  if (!s) return false;
  const t = s.trim();
  return t.length >= 3 && !JUNK_TITLE.test(t) && !ASSET_TITLE.test(t);
};

/**
 * Resolve the document title from the most trustworthy source available. The
 * embedded `/Title` metadata is often wrong (this is where "gr1.eps" comes
 * from), so a tagged Title/H1 wins, then valid metadata, then the largest line
 * on page 1, then the filename.
 */
export function resolveTitle(opts: {
  structTitle?: string;
  metaTitle?: string;
  typographyTitle?: string;
  fileName: string;
}): string {
  if (looksLikeTitle(opts.structTitle)) return opts.structTitle!.trim();
  if (looksLikeTitle(opts.metaTitle)) return opts.metaTitle!.trim();
  if (looksLikeTitle(opts.typographyTitle)) return opts.typographyTitle!.trim();
  return opts.fileName.replace(/\.pdf$/i, "");
}

/**
 * The page-1 title guess for the typography path: the largest-type line that
 * reads like a title (a couple of words, not a bare number or a caption).
 */
export function largestLineTitle(firstPageLines: LineLike[]): string | undefined {
  let best: { str: string; size: number } | undefined;
  for (const l of firstPageLines) {
    const size = l.size ?? 0;
    const text = l.str.replace(/\s+/g, " ").trim();
    if (size <= 0 || text.split(/\s+/).filter(Boolean).length < 2) continue;
    if (/^\d/.test(text) || classifyHeading(text).isCaption) continue;
    if (!best || size > best.size) best = { str: text, size };
  }
  return best?.str;
}
