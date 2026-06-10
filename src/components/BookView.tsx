import {
  Fragment,
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FONT_VARS, type CachedDoc, type ReaderSettings } from "@/lib/reader-store";
import { type Block, buildBlocks, deriveTitles } from "@/lib/book-content";
import type { PlacedRange } from "@/lib/annotations";
import { usePinchZoom } from "@/lib/use-pinch-zoom";
import { renderBlock } from "./highlight";

/** Resolved highlight ranges: source page → paragraph index → ranges. */
export type HighlightsByPage = Map<number, Map<number, PlacedRange[]>>;

/** Imperative handle the surrounding chrome (footer, keyboard, TOC) drives. */
export interface BookApi {
  next: () => void;
  prev: () => void;
  goToSourcePage: (sourcePage: number) => void;
}

/** The sentence currently being read aloud, for highlighting + page-following. */
export interface TtsHighlight {
  srcPage: number;
  paraIdx: number;
  start: number;
  end: number;
}

/** Live in-book search state the reader chrome feeds the views. */
export interface SearchState {
  /** Lowercased needle; every occurrence in the body gets a `<mark>`. */
  term: string;
  /** The match currently stepped to (page + per-page ordinal), if any. */
  active: { srcPage: number; ordinal: number } | null;
  /** Bumped on every explicit jump (result tap / next / prev) — views only
   *  navigate on a token change, never on mere re-renders or typing. */
  navToken: number;
}

export interface ReadingPosition {
  /** The PDF page the current screen begins on — the stable anchor for resume. */
  sourcePage: number;
  /** 0–1 progress through the whole book. */
  fraction: number;
  /** Current screen page (1-based) and the total number of screens. */
  page: number;
  total: number;
}

interface Props {
  doc: CachedDoc;
  settings: ReaderSettings;
  /** PDF page to open on (restored from saved progress). */
  initialSourcePage: number;
  onChange: (pos: ReadingPosition) => void;
  /** Fired on a center tap — used to toggle the chrome. */
  onCenterTap: () => void;
  /** In-book search: highlights every hit and navigates on navToken bumps. */
  search?: SearchState;
  /** Reader highlights to paint into the body text. */
  highlights?: HighlightsByPage;
  /** Fired when a highlight mark is tapped (open its editor). */
  onAnnotationTap?: (id: string) => void;
  /** Sentence being read aloud — highlighted and kept in view. */
  tts?: TtsHighlight | null;
  /** Pinch-to-resize text: the new body font size (px) a two-finger pinch lands on. */
  onFontSize?: (size: number) => void;
}

// Breathing room inside each screen. The horizontal value is a baseline; the
// reader's "side margin" setting adds to it, and on wide screens it grows to
// keep the line length near the chosen measure.
//
// The top/bottom values must clear the reader's chrome, which overlays the page
// as absolute bars (~59px header, ~57px footer) rather than taking flow space —
// otherwise the first and last lines of a column render behind them. We keep the
// padding constant whether the chrome is shown or hidden so toggling it never
// reflows the text.
const BASE_X = 22;
const PAD_TOP = 72;
const PAD_BOTTOM = 64;

// The book is laid out a chunk at a time rather than all at once. A chunk is a
// run of PDF pages large enough to be worth its own layout pass but small enough
// that paginating it is instant. Chunks prefer to break at chapter boundaries
// (which already start a fresh page), but never go below MIN — short chapters are
// merged forward — and never above MAX, so a chapterless book is still cut into
// fast, bounded pieces.
const MIN_CHUNK_PAGES = 30;
const MAX_CHUNK_PAGES = 60;

// Fallback reading density (words per screen) used to estimate the length of
// chunks we haven't laid out yet. Refined from real measurements as the reader
// moves, so the estimate sharpens the further they read.
const DEFAULT_WORDS_PER_SCREEN = 200;

interface Chunk {
  index: number;
  blocks: Block[];
  /** Total words in the chunk. */
  words: number;
  /** Words in every chunk before this one — the base for word-based progress. */
  wordsBefore: number;
  /** First PDF page in the chunk; the anchor a chunk break must not break before. */
  firstSrcPage: number;
}

/**
 * Slice the book into chunks for windowed layout. We only ever lay out and keep
 * in the DOM the chunk the reader is on, so the browser never has to paginate
 * the whole book — the cause of the open-book freeze and the settings-slider lag.
 *
 * A break is taken at a chapter start once the current chunk has reached MIN
 * pages, or unconditionally at MAX pages so a book with no chapters is still
 * carved into bounded pieces.
 */
function buildChunks(blocks: Block[], chapterStarts: Set<number>): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: Block[] = [];

  const flush = () => {
    if (!cur.length) return;
    chunks.push({
      index: chunks.length,
      blocks: cur,
      words: cur.reduce((n, b) => n + b.words, 0),
      wordsBefore: 0,
      firstSrcPage: cur[0].srcPage,
    });
    cur = [];
  };

  for (const b of blocks) {
    const atChapter = chapterStarts.has(b.srcPage);
    if (cur.length >= MIN_CHUNK_PAGES && (atChapter || cur.length >= MAX_CHUNK_PAGES)) flush();
    cur.push(b);
  }
  flush();

  let acc = 0;
  for (const c of chunks) {
    c.wordsBefore = acc;
    acc += c.words;
  }
  return chunks.length
    ? chunks
    : [{ index: 0, blocks: [], words: 0, wordsBefore: 0, firstSrcPage: 1 }];
}

/**
 * One chunk's paragraphs, each preceded by an invisible anchor carrying its
 * source page number so a rendered position maps back to the PDF page (for
 * progress, resume and TOC jumps). A chapter with a real title gets its own
 * centered title page instead of a bare anchor. The parent lays this out in
 * screen-wide columns.
 */
function FlowContent({
  blocks,
  settings,
  chapterStarts,
  titleForSrc,
  colContentH,
  chunkFirstSrcPage,
  globalFirstSrcPage,
  search,
  highlights,
  tts,
}: {
  blocks: Block[];
  settings: ReaderSettings;
  /** Source pages where a chapter/section begins — each forces a fresh page. */
  chapterStarts: Set<number>;
  /** Source page → chapter title, for the centered title pages. */
  titleForSrc: Map<number, string>;
  /** One column's content-box height (px), for full-page title cards. */
  colContentH: number;
  /** First page of this chunk; never force a column break before it. */
  chunkFirstSrcPage: number;
  /** First page of the whole book; gets no title card and no opening indent. */
  globalFirstSrcPage: number;
  /** Active in-book search to mark up in the body text. */
  search?: SearchState;
  /** Reader highlights to paint into the body text. */
  highlights?: HighlightsByPage;
  /** Sentence being read aloud. */
  tts?: TtsHighlight | null;
}) {
  const indented = settings.paragraphStyle === "indented";
  return (
    <>
      {blocks.map((b) => {
        const title = titleForSrc.get(b.srcPage);
        const isChapter = chapterStarts.has(b.srcPage);
        // Paint search hits, reader highlights and the spoken sentence into the
        // paragraphs; the ordinal threading keeps the page's Nth mark aligned
        // with the Nth match.
        const pageRanges = highlights?.get(b.srcPage);
        const blockTts = tts?.srcPage === b.srcPage ? tts : null;
        const paraNodes =
          search?.term || pageRanges || blockTts
            ? renderBlock(
                b.paras,
                search?.term
                  ? {
                      term: search.term,
                      activeOrdinal:
                        search.active?.srcPage === b.srcPage ? search.active.ordinal : null,
                    }
                  : null,
                pageRanges,
                blockTts,
              )
            : b.paras;
        // A chapter gets its own centered title page when it has a usable title,
        // isn't the book's first page, and we've measured the column height.
        const showCard =
          isChapter && b.srcPage !== globalFirstSrcPage && colContentH > 0 && !!title;
        // Break to a fresh column for a chapter — but never before the chunk's
        // own first page (there's no preceding column, so a forced break there
        // can spawn a phantom blank one).
        const breakHere = isChapter && b.srcPage !== chunkFirstSrcPage;
        return (
          <Fragment key={b.srcPage}>
            {showCard ? (
              // The SOLE [data-src] anchor for this page rides the card div — the
              // box that owns the break — so its offsetLeft is exactly the title
              // column's left edge (a preceding span could fragment onto the
              // previous column and mis-map the page). One anchor per srcPage.
              <div
                data-src={b.srcPage}
                style={{
                  height: `${colContentH}px`,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                  alignItems: "center",
                  textAlign: "center",
                  overflow: "hidden",
                  breakBefore: breakHere ? "column" : undefined,
                  // The card already fills the column (minus a 2px epsilon), so
                  // the body naturally starts on the next column. Only force a
                  // break-after when there IS a body — a forced break with no
                  // following content can spawn a phantom blank column.
                  breakAfter: b.paras.length ? "column" : undefined,
                  breakInside: "avoid",
                }}
              >
                <div style={{ maxWidth: "84%" }}>
                  <span
                    style={{
                      display: "block",
                      width: "2.5rem",
                      height: 2,
                      margin: "0 auto 1.4em",
                      background: "currentColor",
                      opacity: 0.3,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "1.9em",
                      lineHeight: 1.25,
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                      textWrap: "balance",
                    }}
                  >
                    {title}
                  </div>
                  <span
                    style={{
                      display: "block",
                      width: "2.5rem",
                      height: 2,
                      margin: "1.4em auto 0",
                      background: "currentColor",
                      opacity: 0.3,
                    }}
                  />
                </div>
              </div>
            ) : (
              <span
                data-src={b.srcPage}
                aria-hidden="true"
                style={{
                  display: "block",
                  height: 0,
                  // A title-less chapter (e.g. before the column height is known)
                  // still breaks to a fresh page.
                  breakBefore: breakHere ? "column" : undefined,
                }}
              />
            )}
            {paraNodes.map((para, i) => (
              <p
                key={i}
                data-para-idx={i}
                style={{
                  marginTop: 0,
                  marginBottom: indented ? "0.2em" : `${settings.paragraphSpacing}em`,
                  // First-line indent on every paragraph but the book's very first.
                  textIndent:
                    indented && !(b.srcPage === globalFirstSrcPage && i === 0) ? "1.4em" : 0,
                  textAlign: settings.justify ? "justify" : "left",
                  hyphens: settings.hyphens ? "auto" : "manual",
                }}
              >
                {para}
              </p>
            ))}
          </Fragment>
        );
      })}
    </>
  );
}

/** How a chunk should be entered after it lays out. */
type Entry = "start" | "end" | "anchor";

/**
 * Kindle-style page-turn reader.
 *
 * Each chunk of the book is reflowed into CSS multi-columns the width of the
 * viewport, so a column is exactly one screen ("page"). Only the current chunk
 * is rendered, so the browser never paginates more than ~60 pages at once.
 * Turning within a chunk slides the column strip by one viewport width; crossing
 * a chunk boundary swaps in the neighbouring chunk and snaps to its edge.
 *
 * We never store a screen index — screens depend on font size and viewport — so
 * everything resolves through the source-page anchors, keeping the reading
 * position stable across reflows. Total length and progress are estimated from
 * word counts (instant, no full-book layout) and sharpen as real chunks are
 * measured.
 */
export const BookView = forwardRef<BookApi, Props>(function BookView(
  {
    doc,
    settings,
    initialSourcePage,
    onChange,
    onCenterTap,
    search,
    highlights,
    onAnnotationTap,
    tts,
    onFontSize,
  },
  ref,
) {
  const blocks = useMemo(() => buildBlocks(doc), [doc]);
  // Map each chapter/section's source page → its display title, and the set of
  // pages that begin a chapter (each gets its own centered title page — a forced
  // column break — and is a preferred chunk boundary).
  const { titleForSrc, chapterStarts } = useMemo(() => deriveTitles(doc), [doc]);
  const chunks = useMemo(() => buildChunks(blocks, chapterStarts), [blocks, chapterStarts]);
  const totalWords = useMemo(() => chunks.reduce((n, c) => n + c.words, 0), [chunks]);
  const chunksRef = useRef(chunks);
  chunksRef.current = chunks;

  const indexForSource = useCallback((sp: number) => {
    const cs = chunksRef.current;
    let idx = 0;
    for (let i = 0; i < cs.length; i++) {
      if (cs[i].firstSrcPage <= sp) idx = i;
      else break;
    }
    return idx;
  }, []);

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [currentChunk, setCurrentChunk] = useState(() => {
    let idx = 0;
    for (let i = 0; i < chunks.length; i++) {
      if (chunks[i].firstSrcPage <= initialSourcePage) idx = i;
      else break;
    }
    return idx;
  });
  const [localPage, setLocalPage] = useState(0); // current screen within the chunk, 0-based
  const [localTotal, setLocalTotal] = useState(1); // screens in the current chunk
  const [stride, setStride] = useState(0); // px the strip shifts per screen (= viewport width)

  // Mirrors so the imperative nav callbacks read the latest values without
  // re-binding (and without stale closures).
  const currentChunkRef = useRef(currentChunk);
  const localPageRef = useRef(localPage);
  const localTotalRef = useRef(localTotal);
  useEffect(() => void (currentChunkRef.current = currentChunk), [currentChunk]);
  useEffect(() => void (localPageRef.current = localPage), [localPage]);
  useEffect(() => void (localTotalRef.current = localTotal), [localTotal]);

  // Per-chunk screen mapping for the CURRENT chunk: each anchor's local screen.
  const pageStartsRef = useRef<Array<{ srcPage: number; screen: number }>>([]);
  // Measured screen counts per chunk, for sharpening the total. Cleared whenever
  // a layout-affecting setting or the viewport changes (tracked by sigRef).
  const measuredRef = useRef(new Map<number, number>());
  const sigRef = useRef("");
  // Reading density learned from the latest measured chunk; seeds the estimate
  // for chunks not yet laid out.
  const wpsRef = useRef(DEFAULT_WORDS_PER_SCREEN);

  // The source page to keep the reader anchored to across reflows.
  const anchorRef = useRef(initialSourcePage);
  // How to land after the next chunk layout (chunk switches set this; a plain
  // reflow defaults to preserving the anchor).
  const pendingEntryRef = useRef<Entry | null>(null);
  // Forces the next move to be instant (no slide): first layout, re-pagination,
  // chunk switches and TOC jumps. Normal one-step turns animate.
  const jumpRef = useRef(true);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  // Honor reduced-motion: no slide animation.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Re-paginate once web fonts load — their metrics change the line count.
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Track the viewport size (resize / orientation change).
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const ro = new ResizeObserver(() => setSize({ w: vp.clientWidth, h: vp.clientHeight }));
    ro.observe(vp);
    setSize({ w: vp.clientWidth, h: vp.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Open a different book: reset to its restored page.
  useEffect(() => {
    anchorRef.current = initialSourcePage;
    pendingEntryRef.current = "anchor";
    measuredRef.current.clear();
    setCurrentChunk(indexForSource(initialSourcePage));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.key]);

  const screenForSource = useCallback((srcPage: number, totalScreens: number) => {
    let best = 0;
    for (const s of pageStartsRef.current) {
      if (s.srcPage <= srcPage) best = s.screen;
      else break;
    }
    return Math.min(Math.max(0, best), Math.max(0, totalScreens - 1));
  }, []);

  const sourceForScreen = useCallback((screen: number) => {
    let src =
      pageStartsRef.current[0]?.srcPage ??
      chunksRef.current[currentChunkRef.current]?.firstSrcPage ??
      1;
    for (const s of pageStartsRef.current) {
      if (s.screen <= screen) src = s.srcPage;
      else break;
    }
    return src;
  }, []);

  // One column's content-box height — the title cards fill exactly one page.
  // The -2px epsilon keeps sub-pixel rounding from spilling a blank extra column.
  const colContentH = Math.max(0, size.h - PAD_TOP - PAD_BOTTOM - 2);

  // Lay the current chunk out into screen-sized columns and measure it.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const W = vp.clientWidth;
    if (W <= 0) return;

    // Any change to a layout-affecting setting or the viewport invalidates every
    // chunk's cached measurement.
    const sig = `${W}x${vp.clientHeight}|${fontsReady}|${settings.fontSize}|${settings.lineHeight}|${settings.measure}|${settings.margin}|${settings.fontFamily}|${settings.letterSpacing}|${settings.justify}|${settings.hyphens}|${settings.paragraphStyle}|${settings.paragraphSpacing}`;
    if (sigRef.current !== sig) {
      measuredRef.current.clear();
      sigRef.current = sig;
    }

    // Keep the line length near the chosen measure even on wide screens by
    // widening the side padding instead of stretching the text.
    const maxTextW = settings.measure * settings.fontSize * 0.5;
    let px = BASE_X + settings.margin;
    let colW = W - 2 * px;
    if (colW > maxTextW) {
      px = (W - maxTextW) / 2;
      colW = W - 2 * px;
    }

    content.style.columnWidth = `${colW}px`;
    content.style.columnGap = `${2 * px}px`;
    content.style.paddingLeft = `${px}px`;
    content.style.paddingRight = `${px}px`;

    // With column-gap = 2·px and padding = px, the strip advances exactly one
    // viewport width per column, so scrollWidth / W is the screen count.
    const local = Math.max(1, Math.round(content.scrollWidth / W));
    measuredRef.current.set(currentChunk, local);
    const chunkWords = chunksRef.current[currentChunk]?.words ?? 0;
    if (chunkWords > 0) wpsRef.current = Math.min(600, Math.max(60, chunkWords / local));

    pageStartsRef.current = Array.from(content.querySelectorAll<HTMLElement>("[data-src]")).map(
      (el) => ({
        srcPage: Number(el.dataset.src),
        screen: Math.min(Math.floor(el.offsetLeft / W), local - 1),
      }),
    );

    setLocalTotal(local);
    setStride(W);

    // Resolve where to land. A chunk switch supplies an explicit entry; a plain
    // reflow (settings/resize/first layout) preserves the anchored source page.
    const entry = pendingEntryRef.current;
    pendingEntryRef.current = null;
    let landing: number;
    if (entry === "start") landing = 0;
    else if (entry === "end") landing = local - 1;
    else landing = screenForSource(anchorRef.current, local);

    jumpRef.current = true; // snap into the resolved spot, don't slide
    setLocalPage(landing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    currentChunk,
    chunks,
    size.w,
    size.h,
    fontsReady,
    settings.fontSize,
    settings.lineHeight,
    settings.measure,
    settings.margin,
    settings.fontFamily,
    settings.letterSpacing,
    settings.justify,
    settings.hyphens,
    settings.paragraphStyle,
    settings.paragraphSpacing,
  ]);

  // Report position (and remember the anchor) whenever the screen changes.
  useEffect(() => {
    const cs = chunks;
    if (!cs.length) return;
    const chunk = cs[currentChunk] ?? cs[0];
    const est = (i: number) =>
      measuredRef.current.get(i) ?? Math.max(1, Math.round(cs[i].words / wpsRef.current));

    let before = 0;
    for (let i = 0; i < currentChunk; i++) before += est(i);
    let total = before;
    for (let i = currentChunk; i < cs.length; i++) total += est(i);

    const page = Math.min(before + localPage + 1, total);
    const within = localTotal > 0 ? localPage / localTotal : 0;
    const wordsPos = chunk.wordsBefore + within * chunk.words;
    const fraction = totalWords > 0 ? Math.min(1, Math.max(0, wordsPos / totalWords)) : 0;

    const sourcePage = sourceForScreen(localPage);
    anchorRef.current = sourcePage;
    onChange({ sourcePage, fraction, page, total });
  }, [currentChunk, localPage, localTotal, chunks, totalWords, sourceForScreen, onChange]);

  const next = useCallback(() => {
    if (localPageRef.current < localTotalRef.current - 1) {
      setLocalPage((p) => Math.min(p + 1, localTotalRef.current - 1));
    } else if (currentChunkRef.current < chunksRef.current.length - 1) {
      pendingEntryRef.current = "start";
      setCurrentChunk((c) => c + 1);
    }
  }, []);

  const prev = useCallback(() => {
    if (localPageRef.current > 0) {
      setLocalPage((p) => Math.max(0, p - 1));
    } else if (currentChunkRef.current > 0) {
      pendingEntryRef.current = "end";
      setCurrentChunk((c) => c - 1);
    }
  }, []);

  const goToSourcePage = useCallback(
    (sp: number) => {
      const target = indexForSource(sp);
      anchorRef.current = sp;
      jumpRef.current = true;
      if (target === currentChunkRef.current) {
        setLocalPage(screenForSource(sp, localTotalRef.current));
      } else {
        pendingEntryRef.current = "anchor";
        setCurrentChunk(target);
      }
    },
    [indexForSource, screenForSource],
  );

  useImperativeHandle(ref, () => ({ next, prev, goToSourcePage }), [next, prev, goToSourcePage]);

  // An explicit search jump (result tap / next / prev) lands on the match's
  // page; the layout pass below then narrows to the exact screen of the mark.
  useEffect(() => {
    if (!search?.navToken || !search.active) return;
    goToSourcePage(search.active.srcPage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.navToken]);

  // After the chunk holding the active match is laid out, page precisely to the
  // screen its <mark> sits on (a long source page can span several screens).
  useLayoutEffect(() => {
    if (!search?.navToken || !search.active) return;
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const W = vp.clientWidth;
    if (W <= 0) return;
    const el = content.querySelector<HTMLElement>('mark[data-search][data-active="true"]');
    if (!el) return;
    const screen = Math.max(0, Math.min(Math.floor(el.offsetLeft / W), localTotalRef.current - 1));
    jumpRef.current = true;
    setLocalPage(screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.navToken, currentChunk, localTotal]);

  // Read-aloud follows the narrator: keep the screen holding the spoken
  // sentence in view, turning pages (and crossing chunks) as speech advances.
  useEffect(() => {
    if (!tts) return;
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const el = content.querySelector<HTMLElement>("mark[data-tts]");
    if (!el) {
      // The sentence lives in another chunk — jump there; the re-run after
      // layout finds the mark and settles on the exact screen.
      goToSourcePage(tts.srcPage);
      return;
    }
    const W = vp.clientWidth;
    if (W <= 0) return;
    const screen = Math.max(0, Math.min(Math.floor(el.offsetLeft / W), localTotalRef.current - 1));
    if (screen !== localPageRef.current) setLocalPage(screen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tts, currentChunk, localTotal]);

  const turn = useCallback((delta: number) => (delta > 0 ? next() : prev()), [next, prev]);

  // Pinch-to-resize text (Kindle-style) — drives the font-size setting.
  const pinch = usePinchZoom(settings.fontSize, (size) => onFontSize?.(size));

  // Tap zones + swipe, without stealing text selection. A two-finger pinch
  // cancels any in-flight single-finger gesture so it never also turns the page.
  const gesture = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    pinch.onPointerDown(e);
    if (pinch.isPinching()) {
      gesture.current = null;
      return;
    }
    gesture.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    pinch.onPointerMove(e);
    if (pinch.isPinching()) gesture.current = null;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pinch.onPointerUp(e);
    const g = gesture.current;
    gesture.current = null;
    if (pinch.isPinching()) return; // a pinch just ended — don't treat the lift as a tap
    if (!g) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return; // user is selecting text
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    const dt = Date.now() - g.t;
    const rect = viewportRef.current?.getBoundingClientRect();
    const W = rect?.width ?? 0;

    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.4) {
      turn(dx < 0 ? 1 : -1); // swipe
      return;
    }
    if (Math.abs(dx) < 12 && Math.abs(dy) < 12 && dt < 500) {
      // A tap on a highlight opens its editor instead of turning the page.
      const mark = (e.target as HTMLElement).closest?.("mark[data-annotation-id]");
      if (mark instanceof HTMLElement && mark.dataset.annotationId) {
        onAnnotationTap?.(mark.dataset.annotationId);
        return;
      }
      const x = e.clientX - (rect?.left ?? 0);
      if (x < W * 0.3) turn(-1);
      else if (x > W * 0.7) turn(1);
      else onCenterTap();
    }
  };

  const instant = reduceMotion || jumpRef.current;
  // Clear the instant flag once a move has settled, so the next one-step turn
  // animates again.
  useEffect(() => {
    jumpRef.current = false;
  }, [localPage, currentChunk]);

  const chunk = chunks[currentChunk] ?? chunks[0];

  return (
    <div
      ref={viewportRef}
      className="relative flex-1 overflow-hidden"
      // `none` hands every touch to us: single-finger taps/swipes turn pages and
      // two-finger pinches resize the text, with no browser scroll/zoom fighting
      // for the gesture.
      style={{ touchAction: "none" }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={(e) => {
        pinch.onPointerUp(e);
        gesture.current = null;
      }}
    >
      <div
        ref={contentRef}
        style={{
          boxSizing: "border-box",
          height: "100%",
          position: "relative",
          paddingTop: PAD_TOP,
          paddingBottom: PAD_BOTTOM,
          columnFill: "auto",
          fontFamily: FONT_VARS[settings.fontFamily],
          fontSize: `${settings.fontSize}px`,
          lineHeight: settings.lineHeight,
          letterSpacing: `${settings.letterSpacing}em`,
          transform: `translateX(${-localPage * stride}px)`,
          transition: instant ? "none" : "transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          willChange: "transform",
        }}
      >
        <FlowContent
          blocks={chunk?.blocks ?? []}
          settings={settings}
          chapterStarts={chapterStarts}
          titleForSrc={titleForSrc}
          colContentH={colContentH}
          chunkFirstSrcPage={chunk?.firstSrcPage ?? 0}
          globalFirstSrcPage={blocks[0]?.srcPage ?? 0}
          search={search}
          highlights={highlights}
          tts={tts}
        />
      </div>
    </div>
  );
});
