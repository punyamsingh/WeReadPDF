import { Fragment, type ReactNode } from "react";
import type { PlacedRange } from "@/lib/annotations";

/**
 * Unified body-text renderer: composes reader highlights (annotation marks),
 * live search hits (search marks), and the sentence being read aloud (tts
 * mark) over a block's paragraphs.
 *
 * All mark kinds are background-only (no padding/borders), so injecting them
 * never reflows the page — critical for the paginated view, whose screen
 * mapping must not shift when a search starts, a highlight is added, or the
 * narrator moves on. Overlaps nest (tts ⊃ annotation ⊃ search) so every layer
 * stays visible.
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

/** The sentence currently being spoken, located within this block. */
export interface BlockTts {
  paraIdx: number;
  start: number;
  end: number;
}

export function renderBlock(
  paras: string[],
  search: BlockSearch | null,
  ranges: Map<number, PlacedRange[]> | undefined,
  tts?: BlockTts | null,
): ReactNode[] {
  let searchOrdinal = 0;
  return paras.map((para, pi) => {
    const { nodes, searchCount } = renderPara(
      para,
      search,
      searchOrdinal,
      ranges?.get(pi),
      tts && tts.paraIdx === pi ? tts : null,
    );
    searchOrdinal += searchCount;
    return nodes;
  });
}

function renderPara(
  para: string,
  search: BlockSearch | null,
  startOrdinal: number,
  ranges: PlacedRange[] | undefined,
  tts: BlockTts | null,
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

  if (!hits.length && !ranges?.length && !tts) return { nodes: para, searchCount: 0 };

  // Cut the paragraph at every mark boundary; each elementary segment is then
  // wrapped by whichever marks cover it.
  const clampTo = (n: number) => Math.max(0, Math.min(n, para.length));
  const cuts = new Set<number>([0, para.length]);
  for (const h of hits) {
    cuts.add(h);
    cuts.add(h + term.length);
  }
  for (const r of ranges ?? []) {
    cuts.add(clampTo(r.start));
    cuts.add(clampTo(r.end));
  }
  if (tts) {
    cuts.add(clampTo(tts.start));
    cuts.add(clampTo(tts.end));
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
    const inTts = !!tts && a >= tts.start && b <= tts.end;

    let node: ReactNode = text;
    if (hitIdx !== -1) {
      const active =
        search!.activeOrdinal !== null && startOrdinal + hitIdx === search!.activeOrdinal;
      node = (
        <mark data-search="true" data-active={active ? "true" : undefined}>
          {node}
        </mark>
      );
    }
    if (range) {
      node = (
        <mark
          data-annotation-id={range.id}
          data-color={range.color}
          data-note={range.hasNote ? "true" : undefined}
        >
          {node}
        </mark>
      );
    }
    if (inTts) {
      node = <mark data-tts="true">{node}</mark>;
    }
    nodes.push(typeof node === "string" ? node : <Fragment key={a}>{node}</Fragment>);
  }
  return { nodes, searchCount: hits.length };
}
