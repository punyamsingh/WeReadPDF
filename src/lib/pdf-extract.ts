import type * as PdfJsType from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";
import {
  buildStructure,
  detectHeadingsByTypography,
  extractStructHeadings,
  finalizeStructHeadings,
  largestLineTitle,
  resolveTitle,
  structureToOutline,
  type HeadingCandidate,
  type MarkedItem,
  type StructTreeNode,
  type StructureNode,
} from "@/lib/pdf-structure";

export interface ExtractedPage {
  pageNumber: number;
  text: string;
}

export interface ExtractedDoc {
  title: string;
  author: string;
  pages: ExtractedPage[];
  fullText: string;
  wordCount: number;
  outline: Array<{ title: string; pageNumber: number }>;
  /** Rich, kind-aware table of contents derived by the structure cascade. */
  structure: StructureNode[];
}

/** Which stage of the import pipeline a progress tick belongs to. */
export type ExtractPhase = "extract" | "ocr";

/** Shape of the pdf.js text items we read (subset of TextItem). */
interface TextItemLike {
  str: string;
  transform?: number[];
  width?: number;
  height?: number;
  hasEOL?: boolean;
  /** Key into the text content's `styles` map; used to sniff bold faces. */
  fontName?: string;
}

/** The `styles` map pdf.js returns alongside text items. */
type FontStyles = Record<string, { fontFamily?: string } | undefined>;

/** Best-effort bold detection from the font's family/name string. */
function isBoldFont(fontName: string | undefined, styles: FontStyles | undefined): boolean {
  if (!fontName) return false;
  const family = styles?.[fontName]?.fontFamily ?? "";
  return /bold|black|heavy|semibold|\bbd\b/i.test(family) || /bold/i.test(fontName);
}

export async function extractPdf(
  file: File,
  onProgress?: (loaded: number, total: number, phase?: ExtractPhase) => void,
): Promise<ExtractedDoc> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();

  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  // Pass 1: rebuild each page's physical lines in reading order. Pages with a
  // column layout are re-ordered geometrically (left column before right);
  // everything else trusts the content-stream order, which preserves things
  // like superscripts better than a blind sort.
  const pageLines: Line[][] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    pageLines.push(
      buildPageLines(content.items as TextItemLike[], content.styles as FontStyles | undefined),
    );
    onProgress?.(i, pdf.numPages, "extract");
  }

  // Pass 2: drop running headers/footers that repeat across many pages, then
  // reflow what's left into paragraphs.
  const repeated = findRepeatedEdgeLines(pageLines);
  const pages: ExtractedPage[] = pageLines.map((lines, idx) => ({
    pageNumber: idx + 1,
    text: reflowParagraphs(stripRepeatedEdges(lines, repeated)),
  }));

  // Scanned PDFs carry no text layer at all — fall back to client-side OCR for
  // any page that came out (near-)empty, so the book still stays on-device.
  await ocrTextlessPages(pdf, pages, onProgress);

  if (pages.every((p) => alnumCount(p.text) < 8)) {
    throw new Error("No extractable text found in this PDF.");
  }

  // --- Structure detection: an evidence cascade, strongest source first ------

  // 1. Tagged structure tree (StructTreeRoot) — when present, the PDF itself
  //    labels H1/H2/H3, so this is the most reliable signal by far.
  const { headings: structTree, title: structTitle } = await extractTaggedStructure(pdf);

  // 2. Embedded outline / bookmarks.
  let outline: Array<{ title: string; pageNumber: number }> = [];
  try {
    const raw = await pdf.getOutline();
    if (raw && raw.length) outline = await flattenOutline(pdf, raw);
  } catch {
    /* ignore */
  }

  // 3. Typography — heading lines stand out by size/weight. Run it on the
  //    header/footer-stripped lines so running heads can't pose as sections.
  const cleanedLines = pageLines.map((lines) => stripRepeatedEdges(lines, repeated));
  const typography = detectHeadingsByTypography(cleanedLines);

  // 4. Keyword/chapter detection (novels) as the weakest structured source.
  const chapters = detectChapters(pages);

  const structure = buildStructure({ structTree, outline, typography, chapters });
  outline = structureToOutline(structure);

  // Last resort: evenly spaced page markers so the contents panel is never empty.
  if (outline.length === 0) {
    outline = pages
      .filter((_, idx) => idx === 0 || idx % Math.max(1, Math.floor(pages.length / 8)) === 0)
      .map((p) => ({ title: `Page ${p.pageNumber}`, pageNumber: p.pageNumber }));
  }

  const fullText = pages.map((p) => p.text).join("\n\n");
  const wordCount = fullText.split(/\s+/).filter(Boolean).length;

  const meta = await pdf.getMetadata().catch(() => null);
  const info = (meta?.info ?? {}) as Record<string, unknown>;
  const author = typeof info.Author === "string" ? info.Author.trim() : "";

  // The embedded /Title is frequently producer junk ("gr1.eps"); resolve the
  // real title from the tagged tree, then valid metadata, then the largest line
  // on page 1, then the filename.
  const title = resolveTitle({
    structTitle,
    metaTitle: typeof info.Title === "string" ? info.Title : undefined,
    typographyTitle: largestLineTitle(pageLines[0] ?? []),
    fileName: file.name,
  });

  return { title, author, pages, fullText, wordCount, outline, structure };
}

// ---------------------------------------------------------------------------
// Line reconstruction (column-aware)
// ---------------------------------------------------------------------------

interface Line {
  str: string;
  /** Left edge of the line in PDF points, normalised to its column's left edge. */
  x: number;
  /** Baseline (vertical position) in PDF points; larger = higher on the page. */
  y: number;
  /** Representative font size (points) of the line — drives heading detection. */
  size?: number;
  /** True when most of the line is set in a bold face. */
  bold?: boolean;
}

/** A text item with resolved page geometry. */
interface PlacedItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Glyph font size (points), from the text transform. */
  size: number;
  bold: boolean;
}

/** An empty vertical strip separating two columns of text. */
interface Gutter {
  start: number;
  end: number;
}

function buildPageLines(items: TextItemLike[], styles?: FontStyles): Line[] {
  const placed = collectItems(items, styles);
  const split = splitColumns(placed, detectGutters(placed));
  if (split) return orderByColumns(split);
  return streamLines(items, styles);
}

/** Font size in points from a text item's transform (vertical scale). */
const itemSize = (t: number[], fallback?: number) =>
  Math.hypot(t[2] ?? 0, t[3] ?? 0) || fallback || 10;

function collectItems(items: TextItemLike[], styles?: FontStyles): PlacedItem[] {
  const out: PlacedItem[] = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const t = it.transform;
    if (!t) continue;
    out.push({
      str: it.str,
      x: t[4],
      y: t[5],
      w: it.width ?? 0,
      h: it.height || Math.abs(t[3]) || 10,
      size: itemSize(t, it.height),
      bold: isBoldFont(it.fontName, styles),
    });
  }
  return out;
}

/** Median glyph size of a line's items — robust to the odd super/subscript. */
const lineSize = (items: PlacedItem[]) => median(items.map((i) => i.size));

/** A line reads as bold when most of its characters are set bold. */
function lineBold(items: PlacedItem[]): boolean {
  let bold = 0;
  let total = 0;
  for (const i of items) {
    total += i.str.length;
    if (i.bold) bold += i.str.length;
  }
  return total > 0 && bold / total > 0.6;
}

/**
 * Single-column path: group items into lines following the content-stream
 * order (the original extraction behaviour). A new line starts whenever the
 * baseline moves by more than a couple of points.
 */
function streamLines(items: TextItemLike[], styles?: FontStyles): Line[] {
  const lines: Line[] = [];
  let cur = "";
  let curX: number | null = null;
  let lastY: number | null = null;
  let sizes: number[] = [];
  let boldChars = 0;
  let totalChars = 0;

  const flushLine = () => {
    const s = cur.replace(/\s+/g, " ").trim();
    if (s) {
      lines.push({
        str: s,
        x: curX ?? 0,
        y: lastY ?? 0,
        size: median(sizes),
        bold: totalChars > 0 && boldChars / totalChars > 0.6,
      });
    }
    cur = "";
    curX = null;
    sizes = [];
    boldChars = 0;
    totalChars = 0;
  };

  for (const item of items) {
    const t = item.transform;
    const x = t?.[4];
    const y = t?.[5];
    if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) flushLine();
    if (curX === null && x !== undefined) curX = x;
    cur += item.str;
    if (t) sizes.push(itemSize(t, item.height));
    const len = item.str?.length ?? 0;
    totalChars += len;
    if (isBoldFont(item.fontName, styles)) boldChars += len;
    if (item.hasEOL) cur += " ";
    if (y !== undefined) lastY = y;
  }
  flushLine();
  return lines;
}

/**
 * Find the empty vertical strips ("gutters") that separate text columns by
 * projecting every item's horizontal span onto a histogram. Only confident,
 * central, wide-enough gaps count — a ragged right edge or an indented block
 * quote must not split a single-column page in two.
 */
function detectGutters(placed: PlacedItem[]): Gutter[] {
  if (placed.length < 24) return []; // too sparse to call a layout
  let minX = Infinity;
  let maxX = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x + p.w);
  }
  const span = maxX - minX;
  if (!(span > 0)) return [];

  const BINS = 96;
  const cov = new Float64Array(BINS);
  for (const p of placed) {
    if (p.w <= 0) continue;
    const a = Math.max(0, Math.floor(((p.x - minX) / span) * BINS));
    const b = Math.min(BINS - 1, Math.ceil(((p.x + p.w - minX) / span) * BINS) - 1);
    for (let i = a; i <= b; i++) cov[i] += 1;
  }
  let peak = 0;
  for (let i = 0; i < BINS; i++) peak = Math.max(peak, cov[i]);
  if (peak < 8) return [];

  // A handful of full-width lines (a paper's title block) may cross the gutter;
  // tolerate a little coverage rather than demanding perfectly empty bins.
  const emptyMax = Math.max(2, peak * 0.06);
  const minRun = 3; // ≈3% of the text span — narrower gaps are word spacing

  const gutters: Gutter[] = [];
  let runStart = -1;
  for (let i = 0; i <= BINS; i++) {
    const isEmpty = i < BINS && cov[i] <= emptyMax;
    if (isEmpty && runStart < 0) runStart = i;
    if (!isEmpty && runStart >= 0) {
      const len = i - runStart;
      const centerFrac = (runStart + i) / 2 / BINS;
      // Only central gaps split columns; gaps hugging an edge are margins.
      if (len >= minRun && centerFrac > 0.25 && centerFrac < 0.75) {
        gutters.push({
          start: minX + (runStart / BINS) * span,
          end: minX + (i / BINS) * span,
        });
      }
      runStart = -1;
    }
  }
  return gutters.slice(0, 2); // 2 gutters = 3 columns; more is a table, not prose
}

interface ColumnSplit {
  /** Items of each column, left to right. */
  columns: PlacedItem[][];
  /** Left edge of each column, for x-normalisation. */
  columnLeft: number[];
  /** Full-width items (titles, banners) that cut the page into bands. */
  spanning: PlacedItem[];
  bodyLeft: number;
}

/**
 * Assign items to columns (or to the full-width "spanning" set) and sanity-check
 * the hypothesis: every column must hold a meaningful share of the page, and
 * spanning items must stay the exception. Returns null when the page is better
 * treated as a single column.
 */
function splitColumns(placed: PlacedItem[], gutters: Gutter[]): ColumnSplit | null {
  if (!gutters.length) return null;
  const columns: PlacedItem[][] = Array.from({ length: gutters.length + 1 }, () => []);
  const spanning: PlacedItem[] = [];

  for (const p of placed) {
    const spans = gutters.some((g) => p.x < g.start - 2 && p.x + p.w > g.end + 2);
    if (spans) {
      spanning.push(p);
      continue;
    }
    const cx = p.x + p.w / 2;
    let col = 0;
    for (const g of gutters) if (cx > (g.start + g.end) / 2) col++;
    columns[col].push(p);
  }

  const minShare = Math.max(6, placed.length * 0.12);
  if (columns.some((c) => c.length < minShare)) return null;
  if (spanning.length > placed.length * 0.2) return null;

  let bodyLeft = Infinity;
  for (const p of placed) bodyLeft = Math.min(bodyLeft, p.x);
  return {
    columns,
    columnLeft: columns.map((c) => c.reduce((m, p) => Math.min(m, p.x), Infinity)),
    spanning,
    bodyLeft,
  };
}

/**
 * Emit a column page's lines in true reading order. Full-width lines (paper
 * titles, section banners) cut the page into horizontal bands; within a band
 * each column is read top-to-bottom and columns left-to-right, so
 * "title → left column → right column" comes out the way a human reads it.
 * Each line's x is normalised to its column's left edge so the downstream
 * paragraph logic sees indents, not column offsets.
 */
function orderByColumns(split: ColumnSplit): Line[] {
  const sepLines = groupIntoLines(split.spanning);
  const bandOf = (y: number) => {
    let b = 0;
    for (const s of sepLines) if (y < s.y - 1) b++;
    return b;
  };

  const colLines = split.columns.map((c) => groupIntoLines(c));
  const out: Line[] = [];
  for (let band = 0; band <= sepLines.length; band++) {
    for (let c = 0; c < colLines.length; c++) {
      for (const line of colLines[c]) {
        if (bandOf(line.y) !== band) continue;
        out.push({
          str: line.str,
          x: line.x - split.columnLeft[c],
          y: line.y,
          size: line.size,
          bold: line.bold,
        });
      }
    }
    if (band < sepLines.length) {
      const s = sepLines[band];
      out.push({ str: s.str, x: s.x - split.bodyLeft, y: s.y, size: s.size, bold: s.bold });
    }
  }
  return out;
}

interface GroupedLine {
  str: string;
  x: number;
  y: number;
  size: number;
  bold: boolean;
}

/** Group loose items into physical lines (top-to-bottom, left-to-right). */
function groupIntoLines(items: PlacedItem[]): GroupedLine[] {
  if (!items.length) return [];
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Array<{ items: PlacedItem[]; y: number }> = [];
  for (const it of sorted) {
    const cur = lines[lines.length - 1];
    if (cur && Math.abs(it.y - cur.y) <= 2) cur.items.push(it);
    else lines.push({ items: [it], y: it.y });
  }
  return lines
    .map((l) => {
      const inOrder = l.items.sort((a, b) => a.x - b.x);
      return {
        str: joinLineItems(inOrder).replace(/\s+/g, " ").trim(),
        x: inOrder[0].x,
        y: l.y,
        size: lineSize(inOrder),
        bold: lineBold(inOrder),
      };
    })
    .filter((l) => l.str);
}

/**
 * Concatenate one line's items left-to-right, inserting a space only when the
 * horizontal gap between two items is word-sized — kerning splits words across
 * items, and gluing those back without a space is what keeps "fi" + "nger"
 * from becoming "fi nger".
 */
function joinLineItems(items: PlacedItem[]): string {
  let s = items[0].str;
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const it = items[i];
    const gap = it.x - (prev.x + prev.w);
    const em = Math.max(prev.h, it.h, 6);
    if (gap > em * 0.12 && !s.endsWith(" ") && !it.str.startsWith(" ")) s += " ";
    s += it.str;
  }
  return s;
}

// ---------------------------------------------------------------------------
// Running header/footer removal
// ---------------------------------------------------------------------------

const normalizeLineKey = (s: string) =>
  s.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();

/** Indices of the lines that can be a running head/foot: the page's edges. */
function edgeIndices(lines: Line[]): number[] {
  const idx = new Set<number>();
  for (const i of [0, 1, lines.length - 2, lines.length - 1]) {
    if (i >= 0 && i < lines.length) idx.add(i);
  }
  return [...idx];
}

/**
 * Find lines that repeat at the top/bottom of many pages — running heads,
 * journal banners, "Author Name" verso headers, bare folios. Numbers are
 * wildcarded so "Page 12" and "Page 13" count as the same head. Only edge
 * lines are tallied (and later stripped), so a phrase repeated mid-body is
 * never touched.
 */
function findRepeatedEdgeLines(pageLines: Line[][]): Set<string> {
  const pageCount = pageLines.filter((l) => l.length > 0).length;
  if (pageCount < 8) return new Set(); // too few pages to be confident
  const freq = new Map<string, number>();
  for (const lines of pageLines) {
    const keys = new Set<string>();
    for (const i of edgeIndices(lines)) {
      const k = normalizeLineKey(lines[i].str);
      if (k && k.length <= 80) keys.add(k);
    }
    for (const k of keys) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  // 35% catches alternating recto/verso heads (each on ~half the pages) while
  // staying clear of chapter headings, which repeat far less often.
  const threshold = Math.max(4, Math.ceil(pageCount * 0.35));
  const out = new Set<string>();
  for (const [k, n] of freq) if (n >= threshold) out.add(k);
  return out;
}

function stripRepeatedEdges(lines: Line[], repeated: Set<string>): Line[] {
  if (!repeated.size || lines.length <= 2) return lines;
  const drop = new Set<number>();
  for (const i of edgeIndices(lines)) {
    if (repeated.has(normalizeLineKey(lines[i].str))) drop.add(i);
  }
  return drop.size ? lines.filter((_, i) => !drop.has(i)) : lines;
}

// ---------------------------------------------------------------------------
// OCR fallback for scanned pages
// ---------------------------------------------------------------------------

const alnumCount = (s: string) => s.match(/[\p{L}\p{N}]/gu)?.length ?? 0;

/** Fewer alphanumeric characters than this means "no real text layer". */
const OCR_TEXT_THRESHOLD = 16;

/**
 * Render each text-less page to a canvas and OCR it with Tesseract (WASM,
 * fully client-side — the PDF never leaves the device). Tesseract and its
 * language data are dynamically imported so the ~few-MB download only ever
 * happens when a scanned PDF actually shows up. Best-effort: if OCR fails
 * (e.g. offline before the model is cached), extraction continues with
 * whatever text the PDF did carry.
 */
async function ocrTextlessPages(
  pdf: PdfJsType.PDFDocumentProxy,
  pages: ExtractedPage[],
  onProgress?: (loaded: number, total: number, phase?: ExtractPhase) => void,
): Promise<void> {
  if (typeof document === "undefined") return; // needs a DOM canvas
  const targets = pages.filter((p) => alnumCount(p.text) < OCR_TEXT_THRESHOLD);
  if (!targets.length) return;

  let worker: Awaited<ReturnType<typeof import("tesseract.js").createWorker>> | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker("eng");
    let done = 0;
    onProgress?.(0, targets.length, "ocr");
    for (const p of targets) {
      // Best-effort per page: one corrupt page must not abort OCR for the rest.
      let canvas: HTMLCanvasElement | null = null;
      try {
        canvas = await renderPageToCanvas(pdf, p.pageNumber);
        if (canvas) {
          const { data } = await worker.recognize(canvas);
          const text = cleanOcrText(data.text ?? "");
          if (alnumCount(text) >= OCR_TEXT_THRESHOLD) p.text = text;
        }
      } catch {
        /* leave this page textless and move on */
      } finally {
        if (canvas) canvas.width = canvas.height = 0; // release the bitmap eagerly
        onProgress?.(++done, targets.length, "ocr");
      }
    }
  } catch {
    /* worker/setup failure — the no-text check after extraction reports it */
  } finally {
    await worker?.terminate().catch(() => {});
  }
}

async function renderPageToCanvas(
  pdf: PdfJsType.PDFDocumentProxy,
  pageNumber: number,
): Promise<HTMLCanvasElement | null> {
  try {
    const page = await pdf.getPage(pageNumber);
    const base = page.getViewport({ scale: 1 });
    // ~2× scale ≈ 150–200 DPI: plenty for OCR without ballooning the canvas.
    const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height, 1));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({ canvas, viewport }).promise;
    return canvas;
  } catch {
    return null;
  }
}

/** Normalise raw OCR output: stitch hyphenated line-wraps, keep block breaks. */
function cleanOcrText(raw: string): string {
  const dehyphenated = raw.replace(/(\p{L})-\n(\p{L})/gu, "$1$2");
  return dehyphenated
    .split(/\n{2,}/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Chapter detection
// ---------------------------------------------------------------------------

// Headings that announce themselves by keyword, e.g. "Chapter 1", "PART II",
// "Prologue", "Appendix B". The keyword may stand alone or be followed by a
// number / title on the same line.
const KEYWORD_HEADING =
  /^(chapter|part|book|section|prologue|epilogue|introduction|foreword|preface|conclusion|appendix|interlude|act|canto)\b[\s.:—-]*([0-9]{1,3}|[ivxlcdm]{1,7}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)?\b.*$/i;

const STANDALONE_HEADING =
  /^(prologue|epilogue|introduction|foreword|preface|conclusion|afterword|acknowledg(e)?ments?|contents|index|glossary|bibliography)\b/i;

/**
 * Infer a table of contents from page text when the PDF carries no outline.
 *
 * Chapters almost always start at the top of a page, so we only look at the
 * first few lines of each page. We accept two kinds of headings: explicit
 * keyword headings ("Chapter 7"), and short ALL-CAPS / Title-Case lines that
 * sit alone like a title. The heuristics stay conservative on purpose — a few
 * missed chapters beat a contents list full of false positives.
 */
function detectChapters(pages: ExtractedPage[]): Array<{ title: string; pageNumber: number }> {
  const out: Array<{ title: string; pageNumber: number }> = [];
  const seen = new Set<string>();

  // Pre-pass: a line that appears at the top of many pages is a running header
  // or footer, not a chapter title. Tally the top lines so we can ignore them.
  const topLine = (p: ExtractedPage) =>
    p.text
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 4);
  const freq = new Map<string, number>();
  for (const page of pages) {
    for (const line of topLine(page)) {
      const k = line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
      freq.set(k, (freq.get(k) ?? 0) + 1);
    }
  }
  const repeatedThreshold = Math.max(4, pages.length * 0.25);

  for (const page of pages) {
    const lines = topLine(page); // headings live at the very top of a chapter page

    for (const line of lines) {
      const freqKey = line.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ");
      if ((freq.get(freqKey) ?? 0) >= repeatedThreshold) continue; // running header/footer
      if (line.length < 2 || line.length > 64) continue;
      const words = line.split(/\s+/);
      if (words.length > 9) continue; // real headings are short

      const letters = line.replace(/[^a-z]/gi, "");
      if (letters.length < 2) continue;

      const isKeyword = KEYWORD_HEADING.test(line) || STANDALONE_HEADING.test(line);
      const upperRatio = letters.replace(/[^A-Z]/g, "").length / letters.length;
      // An all-caps line that isn't a full sentence reads as a title.
      const isAllCaps = upperRatio > 0.7 && !/[.!?]$/.test(line) && words.length <= 7;

      if (!isKeyword && !isAllCaps) continue;

      const title = line.replace(/\s+/g, " ").trim();
      const norm = title.toLowerCase();
      if (seen.has(norm)) continue; // skip running headers repeated on every page
      seen.add(norm);
      out.push({ title, pageNumber: page.pageNumber });
      break; // one heading per page is plenty
    }

    if (out.length >= 80) break; // keep the contents panel manageable
  }

  return out;
}

// ---------------------------------------------------------------------------
// Paragraph reflow
// ---------------------------------------------------------------------------

const median = (arr: number[]) =>
  arr.length ? [...arr].sort((a, b) => a - b)[Math.floor(arr.length / 2)] : 0;

/**
 * Reconstruct paragraphs from a page's physical lines.
 *
 * PDFs have no notion of a paragraph — they only place lines. Treating every
 * line break as a paragraph (the old behaviour) made each wrapped line its own
 * block, which reads as a cold, ragged list on a phone. Instead we join lines
 * into flowing paragraphs and only start a new one when the layout actually
 * signals it: a noticeably larger vertical gap, or a first-line indent. Words
 * hyphenated across a soft wrap ("fin-" + "gers") are stitched back together.
 *
 * Column pages arrive with per-column-normalised x and sawtooth y (each new
 * column jumps back up the page); both paragraph signals are computed from
 * forward (positive) deltas only, so a column boundary never fakes a break.
 */
function reflowParagraphs(lines: Line[]): string {
  if (lines.length <= 1) return lines[0]?.str ?? "";

  // Typical line-to-line spacing, and the body's left margin (a low percentile
  // so the occasional indented first line doesn't drag the margin rightward).
  const gaps: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const g = lines[i - 1].y - lines[i].y;
    if (g > 0) gaps.push(g);
  }
  const lineGap = median(gaps);

  // Drop a page-number "folio" BEFORE the join loop, so a footer/header number
  // can never be glued onto the body line (the "5 the vermin..." bug). A folio
  // is the very top-most or bottom-most line of the page AND purely numeric, so
  // we only ever consider those two extreme lines — a number anywhere inside the
  // text is untouched, and "Chapter 5" isn't numeric-only. This caps removal at
  // one header + one footer and is immune to short/sparse pages.
  if (lines.length > 2) {
    const isFolio = (s: string) => /^\d{1,4}$/.test(s.trim());
    const topIdx = lines.reduce((hi, l, i) => (l.y > lines[hi].y ? i : hi), 0);
    const botIdx = lines.reduce((lo, l, i) => (l.y < lines[lo].y ? i : lo), 0);
    const drop = new Set<number>();
    if (isFolio(lines[topIdx].str)) drop.add(topIdx);
    if (isFolio(lines[botIdx].str)) drop.add(botIdx);
    if (drop.size) lines = lines.filter((_, i) => !drop.has(i));
  }

  const sortedX = lines.map((l) => l.x).sort((a, b) => a - b);
  const bodyLeft = sortedX[Math.floor(sortedX.length * 0.1)];

  const gapBreak = lineGap > 0 ? lineGap * 1.6 : Infinity;
  const indentBreak = Math.max(6, lineGap * 0.5);

  const paragraphs: string[] = [];
  let buf = lines[0].str;
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const line = lines[i];
    const newParagraph = prev.y - line.y > gapBreak || line.x - bodyLeft > indentBreak;

    if (newParagraph) {
      paragraphs.push(buf);
      buf = line.str;
    } else if (/[-\u2010\u00ad]$/.test(buf) && /^[a-z]/.test(line.str)) {
      // Soft-wrap hyphenation: drop the hyphen and glue the word back together.
      // Restricted to plain/soft hyphens so real em/en dashes are preserved.
      buf = buf.replace(/[-\u2010\u00ad]$/, "") + line.str;
    } else {
      buf = `${buf} ${line.str}`;
    }
  }
  paragraphs.push(buf);

  return paragraphs
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

async function flattenOutline(
  pdf: PdfJsType.PDFDocumentProxy,
  items: Array<{ title: string; dest?: unknown; items?: unknown[] }>,
  depth = 0,
): Promise<Array<{ title: string; pageNumber: number }>> {
  const out: Array<{ title: string; pageNumber: number }> = [];
  for (const item of items) {
    try {
      let dest = item.dest;
      if (typeof dest === "string") dest = await pdf.getDestination(dest);
      if (Array.isArray(dest) && dest[0]) {
        const idx = await pdf.getPageIndex(dest[0] as never);
        out.push({ title: "  ".repeat(depth) + item.title, pageNumber: idx + 1 });
      }
    } catch {
      /* skip */
    }
    if (item.items && Array.isArray(item.items) && depth < 2) {
      const child = await flattenOutline(pdf, item.items as never, depth + 1);
      out.push(...child);
    }
  }
  return out;
}

/**
 * Read the tagged structure tree (`/StructTreeRoot`) page by page and lift out
 * its H1–H6/Title headings. Gated on page 1 actually having a tree, so an
 * untagged PDF pays only one cheap probe; tagged docs get a second text read
 * with marked-content markers, which is how each tag is tied back to its
 * glyphs.
 */
async function extractTaggedStructure(
  pdf: PdfJsType.PDFDocumentProxy,
): Promise<{ headings: HeadingCandidate[]; title?: string }> {
  let firstTree: StructTreeNode | null = null;
  try {
    const p1 = await pdf.getPage(1);
    firstTree = (await p1.getStructTree()) as unknown as StructTreeNode | null;
  } catch {
    firstTree = null;
  }
  if (!firstTree) return { headings: [] };

  const raw: Array<{ level: number; title: string; page: number }> = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    try {
      const page = await pdf.getPage(i);
      const [tree, content] = await Promise.all([
        page.getStructTree(),
        page.getTextContent({ includeMarkedContent: true }),
      ]);
      const heads = extractStructHeadings(
        tree as unknown as StructTreeNode | null,
        content.items as unknown as MarkedItem[],
      );
      for (const h of heads) raw.push({ ...h, page: i });
    } catch {
      /* skip a page that won't parse */
    }
  }
  return finalizeStructHeadings(raw);
}
