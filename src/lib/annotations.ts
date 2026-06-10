import { ANNOTATION_STORE, openDB, tx } from "./reader-store";

/**
 * Bookmarks, highlights and notes — persisted locally in IndexedDB, keyed per
 * book (`docKey`), so a reader's marks survive reloads without anything ever
 * leaving the device.
 *
 * A highlight anchors to text, not pixels: `(srcPage, text, ordinal)` names the
 * ordinal-th occurrence of the exact selected string on its source page. That
 * anchor is independent of font, theme, viewport and reading mode, so the
 * highlight re-renders at the right words after any reflow.
 */

export type AnnotationKind = "bookmark" | "highlight";

/** Ember-friendly highlight palette (see styles.css for the actual colors). */
export type AnnotationColor = "gold" | "ember" | "moss" | "sky";

export const ANNOTATION_COLORS: AnnotationColor[] = ["gold", "ember", "moss", "sky"];

export interface Annotation {
  id: string;
  docKey: string;
  kind: AnnotationKind;
  /** Source PDF page the annotation anchors to. */
  srcPage: number;
  /** Highlighted text (highlights) or a short context snippet (bookmarks). */
  text: string;
  /** Which occurrence of `text` on the page a highlight marks (0-based). */
  ordinal?: number;
  color?: AnnotationColor;
  note?: string;
  createdAt: number;
}

export function createAnnotationId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `ann-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Count occurrences of `needle` in `hay`, stepping one char at a time — the
 *  single counting convention shared by anchoring (save) and placement (render). */
export function countOccurrences(hay: string, needle: string): number {
  if (!needle) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n++;
    i = hay.indexOf(needle, i + 1);
  }
  return n;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listAnnotations(docKey: string): Promise<Annotation[]> {
  const db = await openDB();
  try {
    const store = db.transaction(ANNOTATION_STORE, "readonly").objectStore(ANNOTATION_STORE);
    const all = (await tx(
      store,
      store.index("docKey").getAll(IDBKeyRange.only(docKey)),
    )) as Annotation[];
    return all.sort(
      (a, b) =>
        a.srcPage - b.srcPage || (a.ordinal ?? 0) - (b.ordinal ?? 0) || a.createdAt - b.createdAt,
    );
  } finally {
    db.close();
  }
}

export async function saveAnnotation(a: Annotation): Promise<void> {
  const db = await openDB();
  try {
    const store = db.transaction(ANNOTATION_STORE, "readwrite").objectStore(ANNOTATION_STORE);
    await tx(store, store.put(a));
  } finally {
    db.close();
  }
}

export async function deleteAnnotation(id: string): Promise<void> {
  const db = await openDB();
  try {
    const store = db.transaction(ANNOTATION_STORE, "readwrite").objectStore(ANNOTATION_STORE);
    await tx(store, store.delete(id));
  } finally {
    db.close();
  }
}

/** Per-doc annotation counts for the Library shelf badges. */
export async function countAnnotationsByDoc(): Promise<Map<string, number>> {
  const db = await openDB();
  try {
    const store = db.transaction(ANNOTATION_STORE, "readonly").objectStore(ANNOTATION_STORE);
    const all = (await tx(store, store.getAll())) as Annotation[];
    const counts = new Map<string, number>();
    for (const a of all) counts.set(a.docKey, (counts.get(a.docKey) ?? 0) + 1);
    return counts;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// Placement: resolve text anchors into per-paragraph character ranges
// ---------------------------------------------------------------------------

/** A highlight resolved to a concrete character range within one paragraph. */
export interface PlacedRange {
  id: string;
  start: number;
  end: number;
  color: AnnotationColor;
  hasNote: boolean;
}

/**
 * Resolve a page's highlights into per-paragraph ranges by walking the page's
 * occurrence count of each highlight's text (same one-char stepping as
 * `countOccurrences`). Overlapping ranges keep the earlier-created highlight.
 * Anchors whose text no longer exists on the page are skipped silently.
 */
export function placeAnnotations(paras: string[], anns: Annotation[]): Map<number, PlacedRange[]> {
  const out = new Map<number, PlacedRange[]>();
  const sorted = [...anns].sort((a, b) => a.createdAt - b.createdAt);
  for (const a of sorted) {
    if (a.kind !== "highlight" || !a.text) continue;
    let remaining = a.ordinal ?? 0;
    let placed = false;
    for (let pi = 0; pi < paras.length && !placed; pi++) {
      const para = paras[pi];
      let idx = para.indexOf(a.text);
      while (idx !== -1) {
        if (remaining === 0) {
          const ranges = out.get(pi) ?? [];
          const range = {
            id: a.id,
            start: idx,
            end: idx + a.text.length,
            color: a.color ?? "gold",
            hasNote: !!a.note,
          };
          if (!ranges.some((r) => range.start < r.end && r.start < range.end)) {
            ranges.push(range);
            out.set(pi, ranges);
          }
          placed = true;
          break;
        }
        remaining--;
        idx = para.indexOf(a.text, idx + 1);
      }
    }
  }
  for (const ranges of out.values()) ranges.sort((a, b) => a.start - b.start);
  return out;
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------

export function annotationsToMarkdown(title: string, anns: Annotation[]): string {
  const bookmarks = anns.filter((a) => a.kind === "bookmark");
  const highlights = anns.filter((a) => a.kind === "highlight");
  const lines: string[] = [`# Annotations — ${title}`, ""];
  if (bookmarks.length) {
    lines.push("## Bookmarks", "");
    for (const b of bookmarks) {
      lines.push(`- **p. ${b.srcPage}** — ${b.text ? `“${b.text}”` : "(no snippet)"}`);
      if (b.note) lines.push(`  - ${b.note}`);
    }
    lines.push("");
  }
  if (highlights.length) {
    lines.push("## Highlights", "");
    for (const h of highlights) {
      lines.push(`- **p. ${h.srcPage}** (${h.color ?? "gold"}) — “${h.text}”`);
      if (h.note) lines.push(`  - ${h.note}`);
    }
    lines.push("");
  }
  if (!bookmarks.length && !highlights.length) lines.push("_No annotations yet._", "");
  return lines.join("\n");
}
