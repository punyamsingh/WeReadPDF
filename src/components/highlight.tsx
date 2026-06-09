import type { ReactNode } from "react";
import type { PlacedRange } from "@/lib/annotations";

/**
 * Unified body-text renderer: composes reader highlights (annotation marks)
 * and live search hits (search marks) over a block's paragraphs.
 *
 * Both mark kinds are background-only (no padding/borders), so injecting them
 * never reflows the page — critical for the paginated view, whose screen
 * mapping must not shift when a search starts or a highlight is added. Where a
 * search hit falls inside a highlight, the search mark nests inside the
 * annotation mark so both stay visible.
 *
 * Search-ordinal threading mirrors `searchBook` exactly (per page, paragraph
 * order, stepping past each match), so the page's Nth `<mark data-search>`
 * always corresponds to the Nth `SearchMatch` — that's what lets the views
 * scroll/page precisely to the active match.
 */

export interface BlockSearch {
  /** Lowercased needle. */
  term: string;
  /** Active match's per-page ordinal when it sits on this page, else null. */
  activeOrdinal: number | null;
}

export function renderBlock(
  paras: string[],
  search: BlockSearch | null,
  ranges: Map<number, PlacedRange[]> | undefined,
): ReactNode[] {
  let searchOrdinal = 0;
  return paras.map((para, pi) => {
    const { nodes, searchCount } = renderPara(para, search, searchOrdinal, ranges?.get(pi));
    searchOrdinal += searchCount;
    return nodes;
  });
}

function renderPara(
  para: string,
  search: BlockSearch | null,
  startOrdinal: number,
  ranges: PlacedRange[] | undefined,
): { nodes: ReactNode; searchCount: number } {
  // Locate search hits (non-overlapping, same stepping as searchBook).
  const term = search?.term ?? "";
  const hits: number[] = [];
  if (term) {
    const lower = para.toLowerCase();
    let i = lower.indexOf(term);
    while (i !== -1) {
      hits.push(i);
      i = lower.indexOf(term, i + term.length);
    }
  }

  if (!hits.length && !ranges?.length) return { nodes: para, searchCount: 0 };

  // Cut the paragraph at every mark boundary; each elementary segment is then
  // wrapped by whichever marks cover it (annotation outside, search inside).
  const cuts = new Set<number>([0, para.length]);
  for (const h of hits) {
    cuts.add(h);
    cuts.add(h + term.length);
  }
  for (const r of ranges ?? []) {
    cuts.add(Math.max(0, Math.min(r.start, para.length)));
    cuts.add(Math.max(0, Math.min(r.end, para.length)));
  }
  const pts = [...cuts].sort((a, b) => a - b);

  const nodes: ReactNode[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    if (a >= b) continue;
    const text = para.slice(a, b);

    const hitIdx = term ? hits.findIndex((h) => a >= h && b <= h + term.length) : -1;
    const range = ranges?.find((r) => a >= r.start && b <= r.end);
    const active =
      hitIdx !== -1 &&
      search!.activeOrdinal !== null &&
      startOrdinal + hitIdx === search!.activeOrdinal;
    const searchMark =
      hitIdx !== -1 ? (
        <mark
          key={range ? undefined : a}
          data-search="true"
          data-active={active ? "true" : undefined}
        >
          {text}
        </mark>
      ) : null;

    if (range) {
      nodes.push(
        <mark
          key={a}
          data-annotation-id={range.id}
          data-color={range.color}
          data-note={range.hasNote ? "true" : undefined}
        >
          {searchMark ?? text}
        </mark>,
      );
    } else {
      nodes.push(searchMark ?? text);
    }
  }
  return { nodes, searchCount: hits.length };
}
