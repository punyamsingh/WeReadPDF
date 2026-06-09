import * as pdfjs from "pdfjs-dist";
// @ts-ignore - vite worker import
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker";

if (typeof window !== "undefined") {
  pdfjs.GlobalWorkerOptions.workerPort = new PdfWorker();
}

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
}

export async function extractPdf(
  file: File,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ExtractedDoc> {
  const buf = await file.arrayBuffer();
  const loadingTask = pdfjs.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  const pages: ExtractedPage[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    let lastY: number | null = null;
    let text = "";
    for (const item of content.items as Array<{
      str: string;
      transform: number[];
      hasEOL?: boolean;
    }>) {
      const y = item.transform?.[5];
      if (lastY !== null && y !== undefined && Math.abs(y - lastY) > 2) {
        text += "\n";
      }
      text += item.str;
      if (item.hasEOL) text += "\n";
      else text += " ";
      lastY = y ?? lastY;
    }
    pages.push({ pageNumber: i, text: cleanText(text) });
    onProgress?.(i, pdf.numPages);
  }

  let outline: Array<{ title: string; pageNumber: number }> = [];
  try {
    const raw = await pdf.getOutline();
    if (raw && raw.length) {
      outline = await flattenOutline(pdf, raw);
    }
  } catch {
    /* ignore */
  }

  // Many PDFs (especially scanned or exported-from-Word books) ship no embedded
  // outline at all. Rather than fall back to meaningless "Page N" markers, sniff
  // the text for real chapter headings.
  if (outline.length < 2) {
    const detected = detectChapters(pages);
    if (detected.length >= 2) outline = detected;
  }

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
  const metaTitle =
    (typeof info.Title === "string" ? info.Title.trim() : "") || file.name.replace(/\.pdf$/i, "");
  const author = typeof info.Author === "string" ? info.Author.trim() : "";

  return { title: metaTitle, author, pages, fullText, wordCount, outline };
}

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

function cleanText(t: string): string {
  return t
    .replace(/[ \t]+/g, " ")
    .replace(/ ?\n ?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function flattenOutline(
  pdf: pdfjs.PDFDocumentProxy,
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
