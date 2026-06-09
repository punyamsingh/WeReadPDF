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
