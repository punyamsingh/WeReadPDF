import type { CachedDoc } from "@/lib/reader-store";

/**
 * Shared text model for the reader views (paginated `BookView` and continuous
 * `ScrollView`). Both reflow the same reconstructed paragraph stream and map
 * positions back to source PDF pages through `data-src` anchors, so the
 * building blocks live here to keep the two views from drifting apart.
 */

/** One source PDF page's reconstructed prose. */
export interface Block {
  srcPage: number;
  paras: string[];
  /** Word count, precomputed so progress never needs to re-scan the text. */
  words: number;
}

export const countWords = (s: string) => s.match(/\S+/g)?.length ?? 0;

/** Reconstruct each PDF page into clean paragraphs (one Block per source page). */
export function buildBlocks(doc: CachedDoc): Block[] {
  return doc.pages.map((p) => {
    const paras = p.text
      .split(/\n{2,}/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean)
      // Safety net for docs cached before the extraction-time folio filter:
      // drop a paragraph that is JUST a page number. We deliberately do NOT
      // strip a number glued to the start of real prose here — that can't be
      // told apart from legitimate number-initial text ("1984 was…") and would
      // silently corrupt it; the extraction-time filter handles the glue at the
      // source for any re-imported PDF.
      .filter((s) => !/^\d{1,4}$/.test(s));
    return {
      srcPage: p.pageNumber,
      paras,
      words: paras.reduce((n, para) => n + countWords(para), 0),
    };
  });
}

/** Normalize an outline title for a chapter title page: de-indent and collapse
 *  whitespace, and strip a baked-in leading folio ONLY when it equals this
 *  entry's page number (a TOC line like "367 END OF BOOK ONE"). A genuine
 *  number-initial title ("12 Angry Men") is left untouched. */
export function cleanTitle(raw: string, pageNumber: number): string {
  const t = raw.replace(/\s+/g, " ").trim();
  const m = t.match(/^(\d{1,4})\s+(?=\p{L})/u);
  if (m && Number(m[1]) === pageNumber) return t.slice(m[0].length).trim();
  return t;
}

/**
 * Build the chapter model from the document outline:
 * - `titleForSrc`: source page → display title (first entry per page wins;
 *   de-indented, leading folio stripped). Synthetic "Page N" markers are skipped.
 * - `chapterStarts`: the set of source pages that begin a chapter/section. Each
 *   gets its own title page (a forced break in the paginated view, a heading in
 *   the scroll view) and is a preferred chunk boundary.
 */
export function deriveTitles(doc: CachedDoc): {
  titleForSrc: Map<number, string>;
  chapterStarts: Set<number>;
} {
  const titleForSrc = new Map<number, string>();
  for (const o of doc.outline) {
    if (/^page \d+$/i.test(o.title.trim())) continue;
    const t = cleanTitle(o.title, o.pageNumber);
    if (t && !titleForSrc.has(o.pageNumber)) titleForSrc.set(o.pageNumber, t);
  }
  return { titleForSrc, chapterStarts: new Set(titleForSrc.keys()) };
}
