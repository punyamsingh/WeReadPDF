import type { Block } from "./book-content";

/**
 * Full-text search over the reconstructed paragraph stream. Matching runs on
 * the same `Block` model the reader views render, so a match's page + ordinal
 * always lines up with a `<mark>` the views can draw and scroll to.
 */
export interface SearchMatch {
  /** Source PDF page the match sits on. */
  srcPage: number;
  /** Which occurrence on its page (0-based, in paragraph order). */
  ordinal: number;
  /** Snippet context around the matched text. */
  before: string;
  match: string;
  after: string;
}

/** Characters of context shown on each side of a match in the results list. */
const CONTEXT = 38;

/** Hard cap so a one-letter-ish query on a 300-page book stays instant. */
export const SEARCH_LIMIT = 300;

/** Queries shorter than this return nothing (too noisy to be useful). */
export const MIN_QUERY = 2;

export function searchBook(blocks: Block[], rawQuery: string, limit = SEARCH_LIMIT): SearchMatch[] {
  const term = rawQuery.trim().toLowerCase();
  if (term.length < MIN_QUERY) return [];

  const out: SearchMatch[] = [];
  for (const b of blocks) {
    let ordinal = 0;
    for (const para of b.paras) {
      const lower = para.toLowerCase();
      let idx = lower.indexOf(term);
      while (idx !== -1) {
        const end = idx + term.length;
        out.push({
          srcPage: b.srcPage,
          ordinal,
          before: (idx > CONTEXT ? "…" : "") + para.slice(Math.max(0, idx - CONTEXT), idx),
          match: para.slice(idx, end),
          after: para.slice(end, end + CONTEXT) + (end + CONTEXT < para.length ? "…" : ""),
        });
        ordinal++;
        if (out.length >= limit) return out;
        idx = lower.indexOf(term, end);
      }
    }
  }
  return out;
}
