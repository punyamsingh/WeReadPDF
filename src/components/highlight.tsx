import type { ReactNode } from "react";

/**
 * Wrap every occurrence of `term` (lowercased) in a paragraph with a
 * `<mark data-search>` so search hits glow in the body text. The active match
 * (the one the reader is stepping through) additionally gets
 * `data-active="true"`, which the views use both for stronger styling and to
 * scroll/page the match into view.
 *
 * Marks carry no padding/borders, so injecting them never reflows the page —
 * critical for the paginated view, whose screen mapping must not shift when a
 * search starts.
 */
function highlightPara(
  para: string,
  term: string,
  startOrdinal: number,
  activeOrdinal: number | null,
): { nodes: ReactNode; count: number } {
  const lower = para.toLowerCase();
  let idx = lower.indexOf(term);
  if (idx === -1) return { nodes: para, count: 0 };

  const parts: ReactNode[] = [];
  let pos = 0;
  let count = 0;
  while (idx !== -1) {
    if (idx > pos) parts.push(para.slice(pos, idx));
    const active = activeOrdinal !== null && startOrdinal + count === activeOrdinal;
    parts.push(
      <mark key={idx} data-search="true" data-active={active ? "true" : undefined}>
        {para.slice(idx, idx + term.length)}
      </mark>,
    );
    pos = idx + term.length;
    count++;
    idx = lower.indexOf(term, pos);
  }
  parts.push(para.slice(pos));
  return { nodes: parts, count };
}

/**
 * Highlight a whole block's paragraphs, threading the per-page match ordinal
 * through so the Nth hit on the page lines up with the Nth `SearchMatch`.
 * Returns one ReactNode per paragraph (the paragraph's children).
 */
export function highlightBlock(
  paras: string[],
  term: string,
  activeOrdinal: number | null,
): ReactNode[] {
  let ordinal = 0;
  return paras.map((para) => {
    const { nodes, count } = highlightPara(para, term, ordinal, activeOrdinal);
    ordinal += count;
    return nodes;
  });
}
