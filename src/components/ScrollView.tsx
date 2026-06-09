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
import { type Block, buildBlocks, countWords, deriveTitles } from "@/lib/book-content";
import type { BookApi, HighlightsByPage, ReadingPosition, SearchState } from "./BookView";
import { renderBlock } from "./highlight";

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
}

// Horizontal breathing room (the "side margin" setting adds to it) and the
// vertical insets that clear the reader's overlay chrome (~59px header,
// ~57px footer) so the first/last lines never hide behind the bars.
const BASE_X = 22;
const PAD_TOP = 72;
const PAD_BOTTOM = 80;
// When a tap or key turns the "page" in scroll mode we advance by a viewport,
// minus a sliver so the last line of the old screen carries over for continuity.
const TURN_OVERLAP = 64;

/**
 * Estimate a source page's rendered height (px) from its word count and the
 * current typography. This only seeds `contain-intrinsic-size` so the browser
 * can reserve space for off-screen pages it hasn't laid out yet — once a page
 * scrolls into view its real measured height takes over (the `auto` keyword
 * remembers it), so a rough estimate is plenty.
 */
function estimateHeight(b: Block, settings: ReaderSettings, isChapter: boolean): number {
  const lineH = settings.fontSize * settings.lineHeight;
  const wordsPerLine = Math.max(4, settings.measure / 6);
  let lines = 0;
  for (const p of b.paras) lines += Math.max(1, Math.ceil(countWords(p) / wordsPerLine));
  const gaps =
    settings.paragraphStyle === "spaced"
      ? b.paras.length * settings.paragraphSpacing * settings.fontSize
      : 0;
  const heading = isChapter ? settings.fontSize * 4 : 0;
  return Math.round(Math.max(lineH, lines * lineH + gaps + heading));
}

/**
 * Continuous ("scroll") reader.
 *
 * The whole book reflows into one column you scroll, like a long article —
 * decoupled from PDF page breaks just like the paginated view. Off-screen pages
 * are virtualized with CSS `content-visibility`, so even a 300+ page book stays
 * smooth: the browser skips laying out and painting pages outside the viewport
 * while still reserving their (estimated) height, keeping the scrollbar honest.
 *
 * Position still resolves through the per-page `data-src` anchors, so progress,
 * "minutes left," resume and TOC jumps map back to the source PDF page and
 * survive reflows when typography changes — the same contract as `BookView`.
 */
export const ScrollView = forwardRef<BookApi, Props>(function ScrollView(
  { doc, settings, initialSourcePage, onChange, onCenterTap, search, highlights, onAnnotationTap },
  ref,
) {
  const blocks = useMemo(() => buildBlocks(doc), [doc]);
  const { titleForSrc, chapterStarts } = useMemo(() => deriveTitles(doc), [doc]);
  const totalWords = useMemo(() => blocks.reduce((n, b) => n + b.words, 0), [blocks]);
  // Running word count before each source page, so a scroll position maps to a
  // word-based reading fraction consistent with the paginated view.
  const wordsBefore = useMemo(() => {
    const m = new Map<number, number>();
    let acc = 0;
    for (const b of blocks) {
      m.set(b.srcPage, acc);
      acc += b.words;
    }
    return m;
  }, [blocks]);

  const scrollRef = useRef<HTMLDivElement>(null);
  // Source pages in document order, with their DOM nodes — the anchors a scroll
  // position is resolved against. Rebuilt whenever the book changes.
  const sectionsRef = useRef<Array<{ srcPage: number; el: HTMLElement }>>([]);
  // The source page currently at the top of the viewport — preserved across
  // reflows when a typography setting changes.
  const anchorRef = useRef(initialSourcePage);
  const globalFirstSrcPage = blocks[0]?.srcPage ?? 0;

  const [reduceMotion, setReduceMotion] = useState(false);
  const [fontsReady, setFontsReady] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduceMotion(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);

  // Re-measure once web fonts load — their metrics shift every page's height.
  useEffect(() => {
    let alive = true;
    document.fonts?.ready?.then(() => alive && setFontsReady(true));
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the source page sitting at the top of the viewport via binary search
  // over the anchors' live positions (monotonic in document order).
  const topSourcePage = useCallback((): number => {
    const cont = scrollRef.current;
    const els = sectionsRef.current;
    if (!cont || !els.length) return anchorRef.current;
    const cutoff = cont.getBoundingClientRect().top + PAD_TOP + 1;
    let lo = 0;
    let hi = els.length - 1;
    let ans = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (els[mid].el.getBoundingClientRect().top <= cutoff) {
        ans = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    return els[ans].srcPage;
  }, []);

  // Publish the current reading position from the live scroll offset.
  const report = useCallback(() => {
    const cont = scrollRef.current;
    if (!cont) return;
    const { scrollTop, scrollHeight, clientHeight } = cont;
    const denom = scrollHeight - clientHeight;
    const scrolledFrac = denom > 0 ? Math.min(1, Math.max(0, scrollTop / denom)) : 0;

    const sourcePage = topSourcePage();
    anchorRef.current = sourcePage;

    // Word-based fraction (stable across typography, matching the paginated
    // view), snapped to 100% once the scroll bottoms out so the bar completes.
    const before = wordsBefore.get(sourcePage) ?? 0;
    const block = blocks.find((b) => b.srcPage === sourcePage);
    const wordFrac = totalWords > 0 ? (before + (block?.words ?? 0) * 0.5) / totalWords : 0;
    const fraction = scrolledFrac >= 0.999 ? 1 : Math.min(1, Math.max(0, wordFrac));

    const total = Math.max(1, Math.ceil(scrollHeight / Math.max(1, clientHeight)));
    const page = Math.min(total, Math.floor(scrollTop / Math.max(1, clientHeight)) + 1);

    onChange({ sourcePage, fraction, page, total });
  }, [blocks, wordsBefore, totalWords, topSourcePage, onChange]);

  // Scroll the given source page to the top of the reading area.
  const scrollToSource = useCallback((srcPage: number, smooth: boolean) => {
    const cont = scrollRef.current;
    if (!cont) return;
    const els = sectionsRef.current;
    let target = els.find((s) => s.srcPage === srcPage);
    // Anchors only exist for pages with content; fall back to the nearest
    // preceding page so a jump never silently no-ops.
    if (!target) {
      for (const s of els) {
        if (s.srcPage <= srcPage) target = s;
        else break;
      }
    }
    if (!target) return;
    const top =
      target.el.getBoundingClientRect().top -
      cont.getBoundingClientRect().top +
      cont.scrollTop -
      PAD_TOP;
    cont.scrollTo({ top: Math.max(0, top), behavior: smooth ? "smooth" : "auto" });
  }, []);

  // Build the anchor list and restore the reading position when the book opens.
  useLayoutEffect(() => {
    const cont = scrollRef.current;
    if (!cont) return;
    sectionsRef.current = Array.from(cont.querySelectorAll<HTMLElement>("[data-src]")).map(
      (el) => ({
        srcPage: Number(el.dataset.src),
        el,
      }),
    );
    anchorRef.current = initialSourcePage;
    scrollToSource(initialSourcePage, false);
    report();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blocks]);

  // Keep the reader anchored to the same page when typography reflows the column
  // (font, size, spacing, measure, margins…), or once fonts settle.
  const firstReflow = useRef(true);
  useLayoutEffect(() => {
    if (firstReflow.current) {
      firstReflow.current = false;
      return; // the open-book effect already positioned us
    }
    scrollToSource(anchorRef.current, false);
    report();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
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

  // rAF-throttled scroll reporting.
  const ticking = useRef(false);
  const onScroll = useCallback(() => {
    if (ticking.current) return;
    ticking.current = true;
    requestAnimationFrame(() => {
      ticking.current = false;
      report();
    });
  }, [report]);

  const turnBy = useCallback(
    (dir: 1 | -1) => {
      const cont = scrollRef.current;
      if (!cont) return;
      const step = Math.max(1, cont.clientHeight - TURN_OVERLAP);
      cont.scrollBy({ top: dir * step, behavior: reduceMotion ? "auto" : "smooth" });
    },
    [reduceMotion],
  );

  useImperativeHandle(
    ref,
    () => ({
      next: () => turnBy(1),
      prev: () => turnBy(-1),
      goToSourcePage: (sp: number) => scrollToSource(sp, !reduceMotion),
    }),
    [turnBy, scrollToSource, reduceMotion],
  );

  // An explicit search jump centers the active <mark>; if it isn't in the DOM
  // yet (or the page had no mark), fall back to the top of its source page.
  useEffect(() => {
    if (!search?.navToken || !search.active) return;
    const target = search.active;
    const id = requestAnimationFrame(() => {
      const el = scrollRef.current?.querySelector<HTMLElement>(
        'mark[data-search][data-active="true"]',
      );
      if (el) {
        el.scrollIntoView({ block: "center", behavior: reduceMotion ? "auto" : "smooth" });
      } else {
        scrollToSource(target.srcPage, !reduceMotion);
      }
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search?.navToken]);

  // Tap zones: edges page a screen, center toggles the chrome. A real scroll or
  // a text selection is never mistaken for a tap.
  const gesture = useRef<{ x: number; y: number; t: number; top: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    gesture.current = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      top: scrollRef.current?.scrollTop ?? 0,
    };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const sel = window.getSelection?.();
    if (sel && !sel.isCollapsed && sel.toString().length > 0) return; // selecting text
    const moved = Math.abs(e.clientX - g.x) > 12 || Math.abs(e.clientY - g.y) > 12;
    const scrolled = Math.abs((scrollRef.current?.scrollTop ?? 0) - g.top) > 4;
    if (moved || scrolled || Date.now() - g.t > 500) return; // a drag/scroll, not a tap
    // A tap on a highlight opens its editor instead of paging.
    const mark = (e.target as HTMLElement).closest?.("mark[data-annotation-id]");
    if (mark instanceof HTMLElement && mark.dataset.annotationId) {
      onAnnotationTap?.(mark.dataset.annotationId);
      return;
    }
    const rect = scrollRef.current?.getBoundingClientRect();
    const W = rect?.width ?? 0;
    const x = e.clientX - (rect?.left ?? 0);
    if (x < W * 0.3) turnBy(-1);
    else if (x > W * 0.7) turnBy(1);
    else onCenterTap();
  };

  const indented = settings.paragraphStyle === "indented";
  const maxTextW = settings.measure * settings.fontSize * 0.5;
  const padX = BASE_X + settings.margin;

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (gesture.current = null)}
      className="relative flex-1 overflow-y-auto overflow-x-hidden overscroll-contain"
      style={{
        paddingTop: PAD_TOP,
        paddingBottom: PAD_BOTTOM,
        paddingLeft: padX,
        paddingRight: padX,
        fontFamily: FONT_VARS[settings.fontFamily],
        fontSize: `${settings.fontSize}px`,
        lineHeight: settings.lineHeight,
        letterSpacing: `${settings.letterSpacing}em`,
      }}
    >
      <div style={{ maxWidth: `${maxTextW}px`, margin: "0 auto" }}>
        {blocks.map((b) => {
          const isChapter = chapterStarts.has(b.srcPage);
          const title = titleForSrc.get(b.srcPage);
          const showHeading = isChapter && b.srcPage !== globalFirstSrcPage && !!title;
          const pageRanges = highlights?.get(b.srcPage);
          const paraNodes =
            search?.term || pageRanges
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
                )
              : b.paras;
          return (
            <section
              key={b.srcPage}
              data-src={b.srcPage}
              style={{
                contentVisibility: "auto",
                containIntrinsicSize: `auto ${estimateHeight(b, settings, showHeading)}px`,
              }}
            >
              {showHeading && (
                <div
                  style={{
                    textAlign: "center",
                    margin: "2.6em 0 1.6em",
                  }}
                >
                  <span
                    style={{
                      display: "block",
                      width: "2.5rem",
                      height: 2,
                      margin: "0 auto 0.9em",
                      background: "currentColor",
                      opacity: 0.3,
                    }}
                  />
                  <div
                    style={{
                      fontFamily: "var(--font-display)",
                      fontSize: "1.55em",
                      lineHeight: 1.25,
                      fontWeight: 600,
                      letterSpacing: "0.01em",
                      textWrap: "balance",
                    }}
                  >
                    {title}
                  </div>
                </div>
              )}
              {paraNodes.map((para, i) => (
                <Fragment key={i}>
                  <p
                    style={{
                      marginTop: 0,
                      marginBottom: indented ? "0.2em" : `${settings.paragraphSpacing}em`,
                      textIndent:
                        indented && !(b.srcPage === globalFirstSrcPage && i === 0) ? "1.4em" : 0,
                      textAlign: settings.justify ? "justify" : "left",
                      hyphens: settings.hyphens ? "auto" : "manual",
                    }}
                  >
                    {para}
                  </p>
                </Fragment>
              ))}
            </section>
          );
        })}
      </div>
    </div>
  );
});
