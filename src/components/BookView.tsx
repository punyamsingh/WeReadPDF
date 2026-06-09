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

/** Imperative handle the surrounding chrome (footer, keyboard, TOC) drives. */
export interface BookApi {
  next: () => void;
  prev: () => void;
  goToSourcePage: (sourcePage: number) => void;
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
}

interface Block {
  srcPage: number;
  paras: string[];
}

// Breathing room inside each screen. The horizontal value is a baseline; the
// reader's "side margin" setting adds to it, and on wide screens it grows to
// keep the line length near the chosen measure.
const BASE_X = 22;
const PAD_TOP = 40;
const PAD_BOTTOM = 52;

function buildBlocks(doc: CachedDoc): Block[] {
  return doc.pages.map((p) => ({
    srcPage: p.pageNumber,
    paras: p.text
      .split(/\n{2,}/)
      .map((s) => s.replace(/\s+/g, " ").trim())
      .filter(Boolean),
  }));
}

/**
 * The continuous book text — every page's paragraphs in order, each preceded by
 * an invisible anchor carrying its source page number so we can map a rendered
 * position back to the PDF page (for progress, resume and TOC jumps). Shared
 * layout: the parent decides whether to lay this out in columns (paged).
 */
function FlowContent({
  blocks,
  settings,
  chapterStarts,
}: {
  blocks: Block[];
  settings: ReaderSettings;
  /** Source pages where a chapter/section begins — each forces a fresh page. */
  chapterStarts: Set<number>;
}) {
  const indented = settings.paragraphStyle === "indented";
  const firstPage = blocks[0]?.srcPage;
  return (
    <>
      {blocks.map((b) => (
        <Fragment key={b.srcPage}>
          <span
            data-src={b.srcPage}
            aria-hidden="true"
            style={{
              display: "block",
              height: 0,
              // A chapter starts on its own page: force a column break before its
              // anchor (but never before the very first page of the book).
              breakBefore:
                chapterStarts.has(b.srcPage) && b.srcPage !== firstPage ? "column" : undefined,
            }}
          />
          {b.paras.map((para, i) => (
            <p
              key={i}
              style={{
                marginTop: 0,
                marginBottom: indented ? "0.2em" : `${settings.paragraphSpacing}em`,
                // First-line indent on every paragraph but the very first.
                textIndent: indented && !(b.srcPage === firstPage && i === 0) ? "1.4em" : 0,
                textAlign: settings.justify ? "justify" : "left",
                hyphens: settings.hyphens ? "auto" : "manual",
              }}
            >
              {para}
            </p>
          ))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Kindle-style page-turn reader.
 *
 * The whole book is reflowed into CSS multi-columns the width of the viewport,
 * so each column is exactly one screen ("page"). Turning a page slides the
 * column strip horizontally by one viewport width — no scrolling. Tap the left
 * or right third to turn, the center to toggle the chrome; swipe and the
 * keyboard work too. Because screen pages depend on font size and viewport, we
 * never store a screen index: we resolve everything through the source-page
 * anchors, which keeps the reading position stable across reflows.
 */
export const BookView = forwardRef<BookApi, Props>(function BookView(
  { doc, settings, initialSourcePage, onChange, onCenterTap },
  ref,
) {
  const blocks = useMemo(() => buildBlocks(doc), [doc]);
  // Source pages that begin a chapter/section (from the outline) — each one
  // starts on a fresh page via a forced column break.
  const chapterStarts = useMemo(
    () => new Set(doc.outline.map((o) => o.pageNumber)),
    [doc],
  );

  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [page, setPage] = useState(0); // current screen, 0-based
  const [total, setTotal] = useState(1);
  const [stride, setStride] = useState(0); // px the strip shifts per screen (= viewport width)

  const totalRef = useRef(1);
  const pageStartsRef = useRef<Array<{ srcPage: number; screen: number }>>([]);
  // The source page we want to keep the reader anchored to across reflows.
  const anchorRef = useRef(initialSourcePage);
  // Forces the next move to be instant (no slide): used on first layout,
  // re-pagination, and TOC jumps. Normal one-step turns animate.
  const jumpRef = useRef(true);

  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fontsReady, setFontsReady] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    totalRef.current = total;
  }, [total]);

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

  const screenForSource = useCallback((srcPage: number, totalScreens: number) => {
    let best = 0;
    for (const s of pageStartsRef.current) {
      if (s.srcPage <= srcPage) best = s.screen;
      else break;
    }
    return Math.min(Math.max(0, best), Math.max(0, totalScreens - 1));
  }, []);

  const sourceForScreen = useCallback(
    (screen: number) => {
      let src = blocks[0]?.srcPage ?? 1;
      for (const s of pageStartsRef.current) {
        if (s.screen <= screen) src = s.srcPage;
        else break;
      }
      return src;
    },
    [blocks],
  );

  // Lay the book out into screen-sized columns and measure how many there are.
  useLayoutEffect(() => {
    const vp = viewportRef.current;
    const content = contentRef.current;
    if (!vp || !content) return;
    const W = vp.clientWidth;
    if (W <= 0) return;

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
    const totalScreens = Math.max(1, Math.round(content.scrollWidth / W));
    pageStartsRef.current = Array.from(content.querySelectorAll<HTMLElement>("[data-src]")).map(
      (el) => ({
        srcPage: Number(el.dataset.src),
        screen: Math.min(Math.floor(el.offsetLeft / W), totalScreens - 1),
      }),
    );

    totalRef.current = totalScreens;
    setTotal(totalScreens);
    setStride(W);

    const restored = screenForSource(anchorRef.current, totalScreens);
    jumpRef.current = true; // snap into the restored spot, don't slide
    setPage(restored);
    // Re-run whenever anything that affects layout changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    blocks,
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

  // Report position (and remember the anchor) whenever the page changes.
  useEffect(() => {
    const sourcePage = sourceForScreen(page);
    anchorRef.current = sourcePage;
    const fraction = total > 0 ? (page + 1) / total : 0;
    onChange({ sourcePage, fraction, page: page + 1, total });
  }, [page, total, sourceForScreen, onChange]);

  const turn = useCallback((delta: number) => {
    setPage((p) => Math.min(Math.max(0, p + delta), totalRef.current - 1));
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      next: () => turn(1),
      prev: () => turn(-1),
      goToSourcePage: (sp) => {
        anchorRef.current = sp;
        jumpRef.current = true; // TOC jumps snap, they don't slide page-by-page
        setPage(screenForSource(sp, totalRef.current));
      },
    }),
    [turn, screenForSource],
  );

  // Tap zones + swipe, without stealing text selection.
  const gesture = useRef<{ x: number; y: number; t: number } | null>(null);
  const onPointerDown = (e: React.PointerEvent) => {
    gesture.current = { x: e.clientX, y: e.clientY, t: Date.now() };
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    gesture.current = null;
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
  }, [page]);

  return (
    <div
      ref={viewportRef}
      className="relative flex-1 overflow-hidden"
      style={{ touchAction: "manipulation" }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (gesture.current = null)}
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
          transform: `translateX(${-page * stride}px)`,
          transition: instant ? "none" : "transform 280ms cubic-bezier(0.22, 0.61, 0.36, 1)",
          willChange: "transform",
        }}
      >
        <FlowContent blocks={blocks} settings={settings} chapterStarts={chapterStarts} />
      </div>
    </div>
  );
});
